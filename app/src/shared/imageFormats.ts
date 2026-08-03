import type { ProviderConfig } from './types'

/**
 * 生图尺寸/比例格式规格（按图像协议区分，单一事实源）
 * - UI（FigureDialog 等）按当前图像供应商的 imageApi 渲染对应下拉选项
 * - 主进程 imageGen.ts 按 imageApi 分发到对应请求构造
 * 三种协议互不影响：Agnes 保持档位+比例原格式；APIMart 用官方 15 比例+分辨率档位；
 * 标准 OpenAI 用精确像素尺寸（无比例概念）。
 */

export type ImageApi = ProviderConfig['imageApi']

export interface ImageFormatOption {
  value: string
  label: string
}

export interface ImageFormatSpec {
  /** 「尺寸」下拉的语义标签（清晰度档位 / 像素尺寸） */
  sizeLabel: string
  sizes: ImageFormatOption[]
  /** 空数组 = 不显示比例下拉（标准 OpenAI 只有精确像素） */
  ratios: ImageFormatOption[]
  defaultSize: string
  defaultRatio: string
  /** 生成等待提示（按钮文案） */
  waitHint: string
  /** 格式说明（控件下方一行小字） */
  hint: string
}

/** APIMart 官方文档 gpt-image-2 支持的 15 种比例（docs.apimart.ai，2026-07 核对） */
export const APIMART_RATIOS: ImageFormatOption[] = [
  { value: '1:1', label: '1:1 方形' },
  { value: '3:2', label: '3:2 横图' },
  { value: '2:3', label: '2:3 竖图' },
  { value: '4:3', label: '4:3 横图' },
  { value: '3:4', label: '3:4 竖图' },
  { value: '5:4', label: '5:4 横图' },
  { value: '4:5', label: '4:5 竖图' },
  { value: '16:9', label: '16:9 横图' },
  { value: '9:16', label: '9:16 竖图' },
  { value: '2:1', label: '2:1 宽幅' },
  { value: '1:2', label: '1:2 长幅' },
  { value: '3:1', label: '3:1 横幅' },
  { value: '1:3', label: '1:3 长横幅' },
  { value: '21:9', label: '21:9 电影' },
  { value: '9:21', label: '9:21 长电影' }
]

export const IMAGE_FORMATS: Record<ImageApi, ImageFormatSpec> = {
  'openai-images': {
    sizeLabel: '尺寸',
    sizes: [
      { value: '1024x1024', label: '1024×1024 方形' },
      { value: '1536x1024', label: '1536×1024 横图' },
      { value: '1024x1536', label: '1024×1536 竖图' },
      { value: '1792x1024', label: '1792×1024 宽幅' },
      { value: '1024x1792', label: '1024×1792 长幅' }
    ],
    ratios: [],
    defaultSize: '1024x1024',
    defaultRatio: '',
    waitHint: '约 10-60 秒',
    hint: '标准 OpenAI 格式：直接传精确像素尺寸'
  },
  'agnes-images': {
    sizeLabel: '尺寸',
    sizes: [
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '3K', label: '3K' },
      { value: '4K', label: '4K' }
    ],
    ratios: [
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '3:2', label: '3:2' },
      { value: '2:3', label: '2:3' },
      { value: '21:9', label: '21:9' }
    ],
    defaultSize: '1K',
    defaultRatio: '4:3',
    waitHint: '约 10-60 秒',
    hint: 'Agnes 格式：尺寸档位 + 宽高比'
  },
  'apimart-images': {
    sizeLabel: '清晰度',
    sizes: [
      { value: '1K', label: '1K 标清' },
      { value: '2K', label: '2K 高清' },
      { value: '4K', label: '4K 超清' }
    ],
    ratios: APIMART_RATIOS,
    defaultSize: '1K',
    defaultRatio: '4:3',
    waitHint: '约 1-4 分钟（异步任务）',
    hint: 'APIMart 异步生图：比例 + 清晰度档位（无 3K）；gpt-image-2 出图较慢请耐心等待'
  }
}

/** 取协议格式；未知/未配置回退 Agnes（保持历史默认行为） */
export function imageFormatFor(api: ImageApi | null | undefined): ImageFormatSpec {
  return (api && IMAGE_FORMATS[api]) || IMAGE_FORMATS['agnes-images']
}
