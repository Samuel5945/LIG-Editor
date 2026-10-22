import { net } from 'electron'
import type { ImageGenOptions, ProviderConfig } from '@shared/types'
import { isSenseNovaProvider } from '@shared/providerSites'
import { ratioToSenseNovaSize } from '@shared/imageRatio'
import { mergeAbortSignals } from '@shared/abort'
import { getImageProvider } from './settingsStore'
import { apiUserAgent } from './apiUa'

/**
 * AI 生图（M6 管线一）：返回 PNG/JPEG 的 base64（不落盘，预览确认后经 project:saveAsset 入 assets/）
 * 三种协议（provider.imageApi）：
 * - openai-images：标准 POST /images/generations，response_format 顶层，取 b64_json 或 url
 * - agnes-images：Agnes 变体（官方文档：size 档位+ratio，return_base64 代替顶层 response_format）
 * - apimart-images：APIMart 异步任务制（gpt-image-2 / nano-banana）——POST 提交拿 task_id，
 *   轮询 GET /v1/tasks/{id} 至终态，取 result.images[0].url[0] 下载转 base64；
 *   size 传比例（16:9 等）、resolution 传清晰度档位（1k/2k/4k，nano-banana/imagen-4 不带
 *   resolution、seedream-5.0-pro 仅 1K/2K），不支持 response_format
 * 商汤（images 端点）：档位不认，但支持任意 32 倍数像素尺寸——ratio 意图（3:4 等）
 *   由 imageRatio.ts 换算成精确像素，竖版构图不再退化成方图
 */

export async function generateImage(
  prompt: string,
  opts: ImageGenOptions = {},
  /** 界面「停止」传入的取消信号（ipc 层按 reqId 建 controller）：与内部超时合并，取消即中断请求 */
  external?: AbortSignal
): Promise<string> {
  const provider = getImageProvider()
  if (!provider) throw new Error('未配置图像供应商，请先在「模型接入」中设置')
  if (!provider.imageModel) throw new Error(`供应商「${provider.name}」未填图像模型`)
  if (opts.reference?.trim()) {
    // 图生图按供应商走各自契约：商汤走 /images/edits（images[].image_url），
    // APIMart 走 /images/generations 的 image_urls（qwen-image / nano-banana 等）。
    // 没接的供应商给出可执行的提示——静默忽略会让人以为「参考了」其实没参考。
    if (isSenseNovaProvider(provider)) return generateViaSenseNovaEdits(provider, prompt, opts, external)
    if (provider.imageApi === 'apimart-images') return generateViaApimartImages(provider, prompt, opts, external)
    throw new Error(
      `供应商「${provider.name}」没有接图生图；换一个支持参考图的生图模型再试` +
        '（商汤 U1.5 Lite、APIMart 的 qwen-image / nano-banana 等）'
    )
  }
  if (provider.imageApi === 'agnes-images') return generateViaAgnesImages(provider, prompt, opts, external)
  if (provider.imageApi === 'apimart-images') return generateViaApimartImages(provider, prompt, opts, external)
  return generateViaImagesApi(provider, prompt, opts, external)
}

/** UA 覆盖为纯 ASCII：中文 UA 会被商汤 gRPC 网关 500（见 apiUa.ts） */
function headers(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': apiUserAgent() }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

async function generateViaImagesApi(provider: ProviderConfig, prompt: string, opts: ImageGenOptions, external?: AbortSignal): Promise<string> {
  const url = provider.baseUrl.replace(/\/+$/, '') + '/images/generations'
  // 精确像素尺寸（1024x1024 这类）直接用；档位式（1K/2K）标准端点不认。
  // 商汤例外：支持任意 32 倍数像素尺寸，把比例意图（3:4 等）换算成精确像素，
  // 否则贴图卡片的竖版意图会退化成方图再被裁切（见 imageRatio.ts）
  const exact = /^\d+x\d+$/.test(opts.size ?? '') ? opts.size : null
  const senseNovaSize = isSenseNovaProvider(provider)
    ? ratioToSenseNovaSize(opts.ratio, { longEdge: opts.longEdge })
    : null
  const size = exact ?? senseNovaSize ?? '1024x1024'
  const resp = await net.fetch(url, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.imageModel,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
      // 商汤 images 端点的扩展参数：关闭右下角水印（其他 OpenAI 兼容网关会忽略未知字段）
      ...(isSenseNovaProvider(provider) ? { watermark: false } : {})
    }),
    signal: mergeAbortSignals(180_000, external)
  })
  if (!resp.ok) throw new Error(`生图失败 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  return extractImagesResult((await resp.json()) as ImagesResponse, external)
}

/** Agnes images 变体：size 用 1K/2K 档位 + ratio；禁止顶层 response_format，用 return_base64 */
async function generateViaAgnesImages(provider: ProviderConfig, prompt: string, opts: ImageGenOptions, external?: AbortSignal): Promise<string> {
  const url = provider.baseUrl.replace(/\/+$/, '') + '/images/generations'
  const resp = await net.fetch(url, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.imageModel,
      prompt,
      size: opts.size ?? '1K',
      ratio: opts.ratio ?? '4:3',
      return_base64: true
    }),
    signal: mergeAbortSignals(180_000, external)
  })
  if (!resp.ok) throw new Error(`生图失败 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  return extractImagesResult((await resp.json()) as ImagesResponse, external)
}

/** 商汤图生图请求体（单源、可单测）：images[].image_url 只收公网 URL 或 data:image/...;base64, 前缀的 data URI */
export function senseNovaEditsBody(
  provider: ProviderConfig,
  prompt: string,
  reference: string
): Record<string, unknown> {
  const ref = /^data:image\//i.test(reference) ? reference : `data:image/png;base64,${reference}`
  return {
    model: provider.imageModel,
    images: [{ image_url: ref }],
    prompt,
    n: 1,
    // auto 跟着参考图走：比例换算会把「保留原构图」这件事再压一次，编辑场景不该如此
    size: 'auto',
    response_format: 'b64_json',
    watermark: false,
    prompt_extend: false
  }
}

/**
 * 把参考图规整成商汤 edits 能收的样子：PNG/JPEG/WebP、≤10MB、宽高 256–4096、比例 ≤2:1。
 * 我们的封面底图是 2.35:1，直接发会被 400 打回（invalid images[0].image_url）——
 * 所以先在本地居中裁到 2:1（多出来的宽度裁掉），再按上下限缩放。
 */
async function fitSenseNovaReference(reference: string): Promise<string> {
  const { default: sharp } = await import('sharp')
  const buf = Buffer.from(reference.replace(/^data:[^;]+;base64,/, ''), 'base64')
  const meta = await sharp(buf).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (!W || !H) throw new Error('参考图解码失败（只收 PNG/JPEG/WebP）')
  const ratio = W / H
  let cw = W
  let ch = H
  if (ratio > 2) cw = Math.round(H * 2)
  else if (ratio < 0.5) ch = Math.round(W * 2)
  const left = Math.max(0, Math.round((W - cw) / 2))
  const top = Math.max(0, Math.round((H - ch) / 2))
  let img = sharp(buf).extract({ left, top, width: cw, height: ch })
  const long = Math.max(cw, ch)
  if (long > 4096) img = img.resize(Math.round((cw * 4096) / long), Math.round((ch * 4096) / long))
  const short = Math.min(cw, ch)
  if (short < 256) {
    const k = 256 / short
    img = img.resize(Math.round(cw * k), Math.round(ch * k))
  }
  const out = await img.png().toBuffer()
  if (out.length > 10 * 1024 * 1024) throw new Error(`参考图过大（${(out.length / 1048576).toFixed(1)}MB），商汤上限 10MB`)
  return `data:image/png;base64,${out.toString('base64')}`
}

/** 商汤参考图编辑：图生图/风格迁移走这里，不传参考图时一律走 generations */
async function generateViaSenseNovaEdits(
  provider: ProviderConfig,
  prompt: string,
  opts: ImageGenOptions,
  external?: AbortSignal
): Promise<string> {
  const url = provider.baseUrl.replace(/\/+$/, '') + '/images/edits'
  const reference = await fitSenseNovaReference(opts.reference ?? '')
  const resp = await net.fetch(url, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify(senseNovaEditsBody(provider, prompt, reference)),
    signal: mergeAbortSignals(240_000, external)
  })
  if (!resp.ok) throw new Error(`图生图失败 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  return extractImagesResult((await resp.json()) as ImagesResponse, external)
}

// ---- APIMart 异步任务制（gpt-image-2 / nano-banana 等）----
// 契约对齐 Nomi 已验证实现（tests/transport-spike/apimart.mjs 真 key 端到端核验）：
//   创建  POST {base}/v1/images/generations   body { model, prompt, size?, resolution?, image_urls? }
//         → { code:200, data:[{ status:"submitted", task_id }] }（task_id 在 data[0].task_id）
//   轮询  GET  {base}/v1/tasks/{task_id}（task_id 走路径参数，非 query）
//         → { code, data:{ status, result:{ images:[{ url:[...] }] }, error:{ message } } }
//   status 动词：submitted|pending|processing|completed|succeeded|failed|cancelled|error
// 模型差异（apimartImages.js 对账）：
//   - nano-banana（gemini-2.5-flash-image-preview）：仅 size，resolution 固定 1K → 省略走默认
//   - imagen-4：仅 size，无 resolution 字段
//   - seedream-5.0-pro：resolution 仅 1K/2K（3K/4K 会 400）
//   - gpt-image-2 / seedream-4.5 / qwen-image / z-image-turbo：size + resolution（1k/2k/4k）

interface ApimartSubmitResponse {
  code?: number
  data?: { status?: string; task_id?: string }[]
  error?: { code?: number; message?: string }
}

interface ApimartTaskResponse {
  code?: number
  data?: {
    status?: string // submitted | pending | processing | completed | failed | cancelled | error
    error?: { message?: string }
    result?: { images?: { url?: string[] }[] }
  }
  error?: { code?: number; message?: string }
}

/** 不带 resolution 字段的模型（nano-banana 固定 1K；imagen-4 无此参数）——兼容别名、大小写不敏感 */
function apimartNoResolution(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('nano-banana') || m.includes('gemini-2.5-flash-image') || m.includes('imagen')
}
/** resolution 仅支持 1K/2K 的模型（seedream-5.0-pro：3K/4K 会 400） */
function apimartMax2k(model: string): boolean {
  return model.toLowerCase().includes('seedream-5')
}

/** UI 的档位（1K/2K/3K/4K）→ APIMart resolution；APIMart 无 3k 档，3K 就近取 2k */
function apimartResolution(model: string, size?: string): string {
  const tier = (size ?? '1K').toUpperCase()
  if (apimartMax2k(model) && tier === '4K') return '2k'
  switch (tier) {
    case '2K':
      return '2k'
    case '4K':
      return '4k'
    case '3K':
      return '2k'
    default:
      return '1k'
  }
}

function sleep(ms: number, external?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    if (external?.aborted) return r()
    const t = setTimeout(r, ms)
    external?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
  })
}

/** APIMart 基址归一：裸域（api.apimart.ai）自动补 /v1；已带 /v1 的不重复拼接 */
function apimartBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

async function generateViaApimartImages(provider: ProviderConfig, prompt: string, opts: ImageGenOptions, external?: AbortSignal): Promise<string> {
  const base = apimartBase(provider.baseUrl)
  const model = provider.imageModel
  // 提交生图任务：size 传比例（16:9 等），resolution 传清晰度档位（仅支持的模型）；不支持 response_format
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: opts.ratio ?? '1:1'
  }
  // 参考图：APIMart 的 generations 端收 image_urls（数组，元素可为 URL 或 data URI）
  if (opts.reference?.trim()) body.image_urls = [opts.reference]
  if (!apimartNoResolution(model)) body.resolution = apimartResolution(model, opts.size)
  const submitResp = await net.fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify(body),
    signal: mergeAbortSignals(60_000, external)
  })
  const submit = (await submitResp.json()) as ApimartSubmitResponse
  if (!submitResp.ok || submit.error || (submit.code !== undefined && submit.code !== 200)) {
    throw new Error(`生图提交失败：${submit.error?.message ?? `HTTP ${submitResp.status}`}`)
  }
  const taskId = submit.data?.[0]?.task_id
  if (!taskId) throw new Error('生图提交失败：响应缺少 task_id')

  // 轮询任务结果：gpt-image-2 单张可达 200s+，留 300s 窗口、每 3s 查一次；
  // 等待与每轮请求都挂合并信号：用户「停止」时不必空转到本轮结束
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    await sleep(3000, external)
    const taskResp = await net.fetch(`${base}/tasks/${taskId}`, {
      method: 'GET',
      headers: headers(provider.apiKey),
      signal: mergeAbortSignals(30_000, external)
    })
    const task = (await taskResp.json()) as ApimartTaskResponse
    const status = task.data?.status
    // 终态归一：completed/succeeded/success 取图；failed/cancelled/error 报错
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const imgUrl = task.data?.result?.images?.[0]?.url?.[0]
      if (!imgUrl) throw new Error('生图完成但响应中没有图片 URL')
      return downloadToBase64(imgUrl, external)
    }
    if (status === 'failed' || status === 'cancelled' || status === 'error') {
      throw new Error(`生图失败：${task.data?.error?.message ?? `任务状态 ${status}`}`)
    }
    // 用户停止：立刻退出轮询，不等下一轮
    if (external?.aborted) throw new DOMException('已取消', 'AbortError')
    // submitted / pending / processing → 继续轮询
  }
  throw new Error('生图超时（300 秒未完成），可到 APIMart 后台按任务 ID 查看')
}

interface ImagesResponse {
  data?: { b64_json?: string | null; url?: string | null }[]
}

async function extractImagesResult(data: ImagesResponse, external?: AbortSignal): Promise<string> {
  const item = data.data?.[0]
  if (item?.b64_json) return item.b64_json
  if (item?.url) return downloadToBase64(item.url, external)
  throw new Error('生图响应中没有图片数据')
}

async function downloadToBase64(url: string, external?: AbortSignal): Promise<string> {
  // 国内版 Agnes 常无视 return_base64 返国际图床 URL（agnes-ai.space），直连很慢，超时要留足
  const resp = await net.fetch(url, { signal: mergeAbortSignals(180_000, external) })
  if (!resp.ok) throw new Error(`下载生成图失败 HTTP ${resp.status}`)
  return Buffer.from(await resp.arrayBuffer()).toString('base64')
}
