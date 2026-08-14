import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactElement } from 'react'

/**
 * 表格节点（GFM pipe 语法 ↔ TipTap 单节点）。
 * attrs.rows 为二维字符串数组（首行为表头）；NodeView 渲染可编辑 <table>，
 * 单元格失焦写回 rows，md 往返无损。
 */

export interface TableAttrs {
  rows: string[][]
}

/** TipTap 节点定义（article.md 子集内唯一表格形态） */
export const ArticleTable = Node.create({
  name: 'table',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      rows: {
        default: [['']],
        parseHTML: (el) => {
          const table = el as HTMLTableElement
          const rows: string[][] = []
          table.querySelectorAll('tr').forEach((tr) => {
            const cells: string[] = []
            tr.querySelectorAll('th,td').forEach((c) => cells.push(c.textContent ?? ''))
            rows.push(cells)
          })
          return rows
        },
        renderHTML: (attrs) => ({ 'data-rows': JSON.stringify(attrs.rows) })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'table' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const rows = (node.attrs.rows as string[][]) ?? []
    const [header, ...body] = rows
    const head = header?.length
      ? `<thead><tr>${header.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`
      : ''
    const tbody = body.length
      ? `<tbody>${body
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`
          )
          .join('')}</tbody>`
      : ''
    return ['table', mergeAttributes(HTMLAttributes), head + tbody]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableNodeView)
  }
})

function TableNodeView(props: NodeViewProps): ReactElement {
  const { node, updateAttributes, deleteNode } = props
  const rows: string[][] = node.attrs.rows ?? [['']]
  const cols = Math.max(1, ...rows.map((r) => r.length))

  const setCell = (ri: number, ci: number, value: string): void => {
    const next = rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r))
    updateAttributes({ rows: next })
  }

  const addRow = (): void => {
    updateAttributes({ rows: [...rows, Array(cols).fill('')] })
  }
  const addCol = (): void => {
    updateAttributes({ rows: rows.map((r) => [...r, '']) })
  }
  const delRow = (ri: number): void => {
    const next = rows.filter((_, i) => i !== ri)
    updateAttributes({ rows: next.length ? next : [Array(cols).fill('')] })
  }
  const delCol = (ci: number): void => {
    const next = rows.map((r) => r.filter((_, j) => j !== ci))
    updateAttributes({ rows: next.map((r) => (r.length ? r : [''])) })
  }

  return (
    <div className="group/table my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px] leading-relaxed">
        <thead>
          <tr>
            {rows[0]?.map((c, ci) => (
              <th key={ci} className="relative border border-panel-3 bg-panel-3/60 px-2 py-1.5 text-left font-bold">
                <input
                  value={c}
                  onChange={(e) => setCell(0, ci, e.target.value)}
                  className="w-full min-w-[3rem] bg-transparent outline-none"
                  placeholder={`列 ${ci + 1}`}
                />
                <button
                  type="button"
                  title="删除此列"
                  onClick={() => delCol(ci)}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-400 group-hover/table:flex"
                >
                  ×
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, ri) => (
            <tr key={ri}>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} className="relative border border-panel-3 px-2 py-1.5">
                  <input
                    value={r[ci] ?? ''}
                    onChange={(e) => setCell(ri + 1, ci, e.target.value)}
                    className="w-full min-w-[3rem] bg-transparent outline-none"
                  />
                  {ri === rows.slice(1).length - 1 && ci === cols - 1 && (
                    <button
                      type="button"
                      title="删除此行"
                      onClick={() => delRow(ri + 1)}
                      className="absolute -bottom-1.5 -right-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-400 group-hover/table:flex"
                    >
                      ×
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex gap-1 text-[10px]">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-panel-3 px-1.5 py-0.5 text-ink-dim hover:border-sky-600 hover:text-sky-400"
        >
          + 行
        </button>
        <button
          type="button"
          onClick={addCol}
          className="rounded border border-panel-3 px-1.5 py-0.5 text-ink-dim hover:border-sky-600 hover:text-sky-400"
        >
          + 列
        </button>
        <button
          type="button"
          onClick={() => deleteNode()}
          className="ml-auto rounded border border-panel-3 px-1.5 py-0.5 text-ink-dim hover:border-red-500 hover:text-red-400"
        >
          删除表格
        </button>
      </div>
    </div>
  )
}

export default ArticleTable
