import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// 应用图标：圆角矩形（radius ≈ 22%），四角透明；蓝紫渐变底 + 「图 + 文」白色符号
// 输出 build/icon.png（512px），electron-builder 打包时自动转多尺寸 ico

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0ea5e9"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
    <clipPath id="pic"><rect x="120" y="122" width="272" height="158" rx="24"/></clipPath>
  </defs>
  <rect x="20" y="20" width="472" height="472" rx="104" fill="url(#bg)"/>
  <!-- 图：白底相框 + 山峰 + 太阳 -->
  <rect x="120" y="122" width="272" height="158" rx="24" fill="#ffffff"/>
  <g clip-path="url(#pic)">
    <circle cx="330" cy="176" r="26" fill="#fbbf24"/>
    <path d="M104 280 L196 186 L258 248 L306 208 L408 280 Z" fill="#0284c7"/>
    <path d="M104 280 L196 186 L258 248 L216 280 Z" fill="#0369a1"/>
  </g>
  <!-- 文：两行文字条 -->
  <rect x="120" y="316" width="272" height="34" rx="17" fill="#ffffff" opacity="0.95"/>
  <rect x="120" y="368" width="188" height="34" rx="17" fill="#ffffff" opacity="0.7"/>
</svg>`

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(outDir, { recursive: true })
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(join(outDir, 'icon.png'))
console.log('icon.png written to', outDir)
