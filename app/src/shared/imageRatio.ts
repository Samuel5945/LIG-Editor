/**
 * 商汤生图尺寸换算。
 *
 * 商汤 images 端点接受任意像素尺寸，约束为：宽高均为 32 的倍数、落在 512-4096、宽高比 ≤3:1；
 * 但不认 '1K' 这类档位，也没有独立 ratio 字段。此前贴图卡片传 { size: '1K', ratio: '3:4' }
 * 走商汤时，档位不匹配回退 1024x1024 方图，再被模板 object-fit: cover 裁成 3:4——构图被切。
 * 这里把比例意图换算成合规的精确像素尺寸（长边对齐 1024）。
 */

/** 比例字符串（"3:4" / "9:16"，容忍斜杠与空格）→ 商汤合规 "宽x高"；无法解析或超 3:1 返回 null */
export function ratioToSenseNovaSize(ratio: string | undefined): string | null {
  const m = /^(\d{1,3})\s*[:/]\s*(\d{1,3})$/.exec(ratio?.trim() ?? '')
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!w || !h || w / h > 3 || h / w > 3) return null
  const scale = 1024 / Math.max(w, h)
  const px = (v: number): number => Math.min(4096, Math.max(512, Math.round((v * scale) / 32) * 32))
  return `${px(w)}x${px(h)}`
}
