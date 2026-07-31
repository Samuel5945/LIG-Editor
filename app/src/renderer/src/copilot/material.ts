/** 素材投喂：从文件抽取纯文本（txt/md 直读；pdf 用 pdfjs-dist） */

import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_CHARS = 20000 // 提示词体积保护：超长素材截断

export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  let text: string
  if (name.endsWith('.pdf')) {
    text = await extractPdfText(await file.arrayBuffer())
  } else {
    // txt / md / 其他文本类
    text = await file.text()
  }
  text = text.trim()
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n…（素材过长已截断）'
  return text
}

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const task = pdfjs.getDocument({ data: buf })
  const doc = await task.promise
  const pages: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
    )
  }
  await task.destroy()
  return pages.join('\n\n')
}
