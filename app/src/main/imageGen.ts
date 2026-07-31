import { net } from 'electron'
import type { ImageGenOptions, ProviderConfig } from '@shared/types'
import { getImageProvider } from './settingsStore'

/**
 * AI 生图（M6 管线一）：返回 PNG/JPEG 的 base64（不落盘，预览确认后经 project:saveAsset 入 assets/）
 * 两种协议（provider.imageApi）：
 * - openai-images：标准 POST /images/generations，response_format 顶层，取 b64_json 或 url
 * - agnes-images：Agnes 变体（官方文档：size 档位+ratio，return_base64 代替顶层 response_format）
 */

export async function generateImage(prompt: string, opts: ImageGenOptions = {}): Promise<string> {
  const provider = getImageProvider()
  if (!provider) throw new Error('未配置图像供应商，请先在「模型接入」中设置')
  if (!provider.imageModel) throw new Error(`供应商「${provider.name}」未填图像模型`)
  if (provider.imageApi === 'agnes-images') return generateViaAgnesImages(provider, prompt, opts)
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
  const resp = await net.fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!resp.ok) throw new Error(`下载生成图失败 HTTP ${resp.status}`)
  return Buffer.from(await resp.arrayBuffer()).toString('base64')
}
