import { net } from 'electron'
import type { ImageGenOptions, ProviderConfig } from '@shared/types'
import { getImageProvider } from './settingsStore'

/**
 * AI 生图（M6 管线一）：返回 PNG/JPEG 的 base64（不落盘，预览确认后经 project:saveAsset 入 assets/）
 * 三种协议（provider.imageApi）：
 * - openai-images：标准 POST /images/generations，response_format 顶层，取 b64_json 或 url
 * - agnes-images：Agnes 变体（官方文档：size 档位+ratio，return_base64 代替顶层 response_format）
 * - apimart-images：APIMart 异步任务制（gpt-image-2 / nano-banana）——POST 提交拿 task_id，
 *   轮询 GET /tasks/{id} 至 completed，取 result.images[0].url[0] 下载转 base64；
 *   size 传比例（16:9 等）、resolution 传清晰度档位（1k/2k/4k），不支持 response_format
 */

export async function generateImage(prompt: string, opts: ImageGenOptions = {}): Promise<string> {
  const provider = getImageProvider()
  if (!provider) throw new Error('未配置图像供应商，请先在「模型接入」中设置')
  if (!provider.imageModel) throw new Error(`供应商「${provider.name}」未填图像模型`)
  if (provider.imageApi === 'agnes-images') return generateViaAgnesImages(provider, prompt, opts)
  if (provider.imageApi === 'apimart-images') return generateViaApimartImages(provider, prompt, opts)
  return generateViaImagesApi(provider, prompt, opts)
}

function headers(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

async function generateViaImagesApi(provider: ProviderConfig, prompt: string, opts: ImageGenOptions): Promise<string> {
  const url = provider.baseUrl.replace(/\/+$/, '') + '/images/generations'
  // 标准 OpenAI 只认 1024x1024 这类精确尺寸，档位式（1K/2K）回退默认值
  const size = /^\d+x\d+$/.test(opts.size ?? '') ? opts.size : '1024x1024'
  const resp = await net.fetch(url, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.imageModel,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json'
    }),
    signal: AbortSignal.timeout(180_000)
  })
  if (!resp.ok) throw new Error(`生图失败 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  return extractImagesResult((await resp.json()) as ImagesResponse)
}

/** Agnes images 变体：size 用 1K/2K 档位 + ratio；禁止顶层 response_format，用 return_base64 */
async function generateViaAgnesImages(provider: ProviderConfig, prompt: string, opts: ImageGenOptions): Promise<string> {
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
    signal: AbortSignal.timeout(180_000)
  })
  if (!resp.ok) throw new Error(`生图失败 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  return extractImagesResult((await resp.json()) as ImagesResponse)
}

// ---- APIMart 异步任务制（gpt-image-2 / nano-banana）----

interface ApimartSubmitResponse {
  code?: number
  data?: { status?: string; task_id?: string }[]
  error?: { code?: number; message?: string }
}

interface ApimartTaskResponse {
  code?: number
  data?: {
    status?: string // submitted | processing | completed | failed
    error?: { message?: string }
    result?: { images?: { url?: string[] }[] }
  }
  error?: { code?: number; message?: string }
}

/** UI 的档位（1K/2K/3K/4K）→ APIMart resolution；APIMart 无 3k 档，3K 就近取 2k */
function apimartResolution(size?: string): string {
  switch ((size ?? '1K').toUpperCase()) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function generateViaApimartImages(provider: ProviderConfig, prompt: string, opts: ImageGenOptions): Promise<string> {
  const base = provider.baseUrl.replace(/\/+$/, '')
  // 提交生图任务：size 传比例（16:9 等），resolution 传清晰度档位；不支持 response_format
  const submitResp = await net.fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.imageModel,
      prompt,
      n: 1,
      size: opts.ratio ?? '1:1',
      resolution: apimartResolution(opts.size)
    }),
    signal: AbortSignal.timeout(60_000)
  })
  const submit = (await submitResp.json()) as ApimartSubmitResponse
  if (!submitResp.ok || submit.error || (submit.code !== undefined && submit.code !== 200)) {
    throw new Error(`生图提交失败：${submit.error?.message ?? `HTTP ${submitResp.status}`}`)
  }
  const taskId = submit.data?.[0]?.task_id
  if (!taskId) throw new Error('生图提交失败：响应缺少 task_id')

  // 轮询任务结果：gpt-image-2 单张可达 200s+，留 300s 窗口、每 3s 查一次
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    await sleep(3000)
    const taskResp = await net.fetch(`${base}/tasks/${taskId}`, {
      method: 'GET',
      headers: headers(provider.apiKey),
      signal: AbortSignal.timeout(30_000)
    })
    const task = (await taskResp.json()) as ApimartTaskResponse
    const status = task.data?.status
    if (status === 'completed') {
      const imgUrl = task.data?.result?.images?.[0]?.url?.[0]
      if (!imgUrl) throw new Error('生图完成但响应中没有图片 URL')
      return downloadToBase64(imgUrl)
    }
    if (status === 'failed') {
      throw new Error(`生图失败：${task.data?.error?.message ?? '任务失败'}`)
    }
    // submitted / processing → 继续轮询
  }
  throw new Error('生图超时（300 秒未完成），可到 APIMart 后台按任务 ID 查看')
}

interface ImagesResponse {
  data?: { b64_json?: string | null; url?: string | null }[]
}

async function extractImagesResult(data: ImagesResponse): Promise<string> {
  const item = data.data?.[0]
  if (item?.b64_json) return item.b64_json
  if (item?.url) return downloadToBase64(item.url)
  throw new Error('生图响应中没有图片数据')
}

async function downloadToBase64(url: string): Promise<string> {
  // 国内版 Agnes 常无视 return_base64 返国际图床 URL（agnes-ai.space），直连很慢，超时要留足
  const resp = await net.fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!resp.ok) throw new Error(`下载生成图失败 HTTP ${resp.status}`)
  return Buffer.from(await resp.arrayBuffer()).toString('base64')
}
