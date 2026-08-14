import { Mark, mergeAttributes, type CommandProps } from '@tiptap/core'

/**
 * 手动样式 mark：选中片段自定义字体色 / 背景高亮 / 字号。
 * 单一 mark 三属性（color / bg / fontSize），md 序列化为内联 span style，
 * 与 exportHtml 导出的公众号 HTML 同源。
 */

export interface TextStyleAttrs {
  color?: string
  bg?: string
  fontSize?: number
}

/** setTextStyle 入参：值为 null 表示清除该属性（其他属性保持）；undefined 保持原值 */
export type TextStylePatch = {
  [K in keyof TextStyleAttrs]?: TextStyleAttrs[K] | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textStyle: {
      /** 合并设置选中文本的手动样式（多次调用各属性累积，不改动的保持；null 清除该属性） */
      setTextStyle: (attrs: TextStylePatch) => ReturnType
      /** 清除选中文本的手动样式（color/bg/fontSize 全清） */
      unsetTextStyle: () => ReturnType
    }
  }
}

/** 从 DOM style 字符串解析 textStyle 属性 */
function parseStyleToAttrs(style: string): Partial<TextStyleAttrs> {
  const out: Partial<TextStyleAttrs> = {}
  for (const seg of style.split(';')) {
    const i = seg.indexOf(':')
    if (i < 0) continue
    const k = seg.slice(0, i).trim().toLowerCase()
    const v = seg.slice(i + 1).trim()
    if (!v) continue
    if (k === 'color') out.color = v
    else if (k === 'background-color' || k === 'background') out.bg = v
    else if (k === 'font-size') {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(v)
      if (px) out.fontSize = Math.round(Number(px[1]))
    }
  }
  return out
}

/** 把 attrs 序列化为 span style 片段 */
export function textStyleToCss(attrs: Partial<TextStyleAttrs>): string {
  const parts: string[] = []
  if (attrs.color) parts.push(`color:${attrs.color}`)
  if (attrs.bg) parts.push(`background-color:${attrs.bg}`)
  if (attrs.fontSize) parts.push(`font-size:${attrs.fontSize}px`)
  return parts.join(';')
}

export const TextStyleMark = Mark.create<Record<string, never>, TextStyleAttrs>({
  name: 'textStyle',

  inclusive: true,
  // 与 bold 共存，不与任何其它 mark 互斥
  excludes: '',

  addAttributes() {
    return {
      color: { default: null, parseHTML: (el) => parseStyleToAttrs((el as HTMLElement).style.cssText ?? '').color ?? null },
      bg: { default: null, parseHTML: (el) => parseStyleToAttrs((el as HTMLElement).style.cssText ?? '').bg ?? null },
      fontSize: {
        default: null,
        parseHTML: (el) => parseStyleToAttrs((el as HTMLElement).style.cssText ?? '').fontSize ?? null
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[style]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as Partial<TextStyleAttrs>
    const css = textStyleToCss(attrs)
    if (!css) return ['span', mergeAttributes(HTMLAttributes)]
    return ['span', mergeAttributes(HTMLAttributes, { style: css })]
  },

  addCommands() {
    return {
      setTextStyle:
        (patch: TextStylePatch) =>
        ({ editor, tr, state }: CommandProps) => {
          const { from, to } = state.selection
          if (from === to) return false
          // 取选区已有 textStyle attrs 做底，合并新值（多属性累积）
          const existing: Partial<TextStyleAttrs> = {}
          state.doc.nodesBetween(from, to, (node) => {
            if (node.isText) {
              for (const mk of node.marks) {
                if (mk.type.name === 'textStyle') {
                  const a = mk.attrs as Partial<TextStyleAttrs>
                  if (a.color) existing.color = a.color
                  if (a.bg) existing.bg = a.bg
                  if (a.fontSize) existing.fontSize = a.fontSize
                }
              }
            }
            return true
          })
          // patch 语义：有值覆盖 / null 清除 / undefined 保持
          const merged: TextStyleAttrs = {}
          if (patch.color !== null && (patch.color || existing.color)) merged.color = patch.color ?? existing.color
          if (patch.bg !== null && (patch.bg || existing.bg)) merged.bg = patch.bg ?? existing.bg
          if (patch.fontSize !== null && (patch.fontSize || existing.fontSize))
            merged.fontSize = patch.fontSize ?? existing.fontSize
          if (!merged.color && !merged.bg && !merged.fontSize) {
            // 全部清空 → 移除 mark
            tr.removeMark(from, to, state.schema.marks.textStyle)
          } else {
            const mark = state.schema.marks.textStyle.create(merged)
            tr.removeMark(from, to, state.schema.marks.textStyle)
            tr.addMark(from, to, mark)
          }
          editor.view.dispatch(tr)
          return true
        },
      unsetTextStyle:
        () =>
        ({ editor, tr, state }: CommandProps) => {
          const { from, to } = state.selection
          tr.removeMark(from, to, state.schema.marks.textStyle)
          editor.view.dispatch(tr)
          return true
        }
    }
  }
})
