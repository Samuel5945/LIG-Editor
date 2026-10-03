/**
 * 排版覆盖字段的元数据表（面板、校验、工具描述、导出预览共用一份事实源）
 *
 * 为什么要单独一张表：能力核白名单有 34 个字段，而编辑器面板只有 6 个控件——
 * 差的 28 项作者既看不见也改不动，只能靠对话。面板要按分组渲染、按字段形态选控件、
 * 按同一套范围做滑杆限位，这些不能再各写一遍，否则又是一处「三处同改」的回归点。
 *
 * 约定：
 * - 中文名一律取 `THEME_FIELD_LABELS`（本表不重复写名字）
 * - 数值范围取 `THEME_NUM_RANGES`（本表只写 step 与单位，不写 min/max）
 * - `null` 在所有字段都表示「跟随分类主题」；`sentinel` 是另一回事，它是该字段的显式关闭值（写进 meta）
 */
import { THEME_NUM_RANGES, type ThemeOverrideKey } from './categoryThemes'

/** 工程 meta 上的排版覆盖集合：值覆盖、null = 恢复跟随主题 */
export type ThemeOverrides = Partial<Record<ThemeOverrideKey, string | number | null>>
export type ThemeFieldKind = 'color' | 'enum' | 'number' | 'text'

export interface ThemeFieldSpec {
  key: ThemeOverrideKey
  group: ThemeGroupId
  kind: ThemeFieldKind
  /** 枚举候选（value 用能力核认识的写法，label 给作者看中文） */
  options?: { value: string; label: string }[]
  /** 显式关闭的哨兵值（bodyBg 'none' 去卡片 / h2Num 'none' 关序号），与「跟随主题」并列但不同 */
  sentinel?: { value: string; label: string }
  step?: number
  unit?: string
  /** number 字段是否允许小数（整数滑杆步进 1） */
  integer?: boolean
  placeholder?: string
  /** 一行提示：面板与工具描述共用 */
  hint?: string
}

export type ThemeGroupId = 'type' | 'color' | 'heading' | 'quote' | 'divider' | 'strong' | 'card' | 'table'

export const THEME_GROUPS: { id: ThemeGroupId; label: string }[] = [
  { id: 'type', label: '字体与节奏' },
  { id: 'color', label: '配色' },
  { id: 'heading', label: '标题' },
  { id: 'quote', label: '引用' },
  { id: 'divider', label: '分隔线' },
  { id: 'strong', label: '加粗' },
  { id: 'card', label: '卡片与图片' },
  { id: 'table', label: '表格' }
]

export const THEME_FIELD_SPECS: ThemeFieldSpec[] = [
  // ---- 字体与节奏 ----
  { key: 'fontFamily', group: 'type', kind: 'text', placeholder: '"Microsoft YaHei", sans-serif', hint: '字体栈按名字生效，导出与编辑器同一份' },
  { key: 'bodyFontSize', group: 'type', kind: 'number', unit: 'px', integer: true, step: 1 },
  { key: 'headingFontSize', group: 'type', kind: 'number', unit: 'px', integer: true, step: 1, hint: 'H1=+6 / H2=+0 / H3=-3' },
  { key: 'lineHeight', group: 'type', kind: 'number', unit: '', step: 0.05, hint: '正文行高，公众号常见 1.75–2.2' },
  { key: 'letterSpacing', group: 'type', kind: 'text', placeholder: '0.02em', hint: '字距带单位；给裸数字按 px 处理' },
  { key: 'pGap', group: 'type', kind: 'number', unit: 'px', integer: true, step: 2 },
  {
    key: 'bodyAlign',
    group: 'type',
    kind: 'enum',
    options: [
      { value: 'flush', label: '顶格两端对齐' },
      { value: 'indent', label: '首行缩进 2em' },
      { value: 'center', label: '居中' }
    ]
  },
  // ---- 配色 ----
  { key: 'accent', group: 'color', kind: 'color', hint: '标题装饰线、引用边线、加粗词跟随（除非点名覆盖）' },
  { key: 'bodyText', group: 'color', kind: 'color' },
  { key: 'headingColor', group: 'color', kind: 'color', hint: '显式设置后不再跟随强调色重链' },
  { key: 'h2Bg', group: 'color', kind: 'color', hint: '配「二级标题版式 = 色块标签」使用' },
  // ---- 标题 ----
  {
    key: 'h1Style',
    group: 'heading',
    kind: 'enum',
    options: [
      { value: 'bar', label: '短横' },
      { value: 'pill', label: '胶囊色块' },
      { value: 'underline', label: '下划线' },
      { value: 'banner', label: '报头横幅' }
    ]
  },
  { key: 'h1Bg', group: 'heading', kind: 'color', hint: '配「报头横幅」使用；横幅字色按底色自动对比' },
  {
    key: 'h2Style',
    group: 'heading',
    kind: 'enum',
    options: [
      { value: 'leftbar', label: '左竖条' },
      { value: 'block', label: '色块标签' },
      { value: 'underline', label: '下划线' },
      { value: 'plain', label: '纯文字' }
    ]
  },
  {
    key: 'h2Num',
    group: 'heading',
    kind: 'enum',
    options: [
      { value: '01', label: '01' },
      { value: '1.', label: '1.' },
      { value: '1、', label: '1、' },
      { value: '一、', label: '一、' },
      { value: '壹、', label: '壹、' },
      { value: '①', label: '①' }
    ],
    sentinel: { value: 'none', label: '关闭序号' }
  },
  {
    key: 'h3Mark',
    group: 'heading',
    kind: 'enum',
    options: [
      { value: 'diamond', label: '菱形' },
      { value: 'dot', label: '圆点' },
      { value: 'none', label: '无标记' }
    ]
  },
  {
    key: 'headingAlign',
    group: 'heading',
    kind: 'enum',
    options: [
      { value: 'center', label: '居中' },
      { value: 'left', label: '左对齐' }
    ]
  },
  { key: 'h2Border', group: 'heading', kind: 'color', hint: 'H2 左竖条/下划线色；不设=跟随强调色' },
  // ---- 引用 ----
  {
    key: 'quoteStyle',
    group: 'quote',
    kind: 'enum',
    options: [
      { value: 'leftbar', label: '左条浅底' },
      { value: 'card', label: '圆角卡片' },
      { value: 'quotes', label: '引号' },
      { value: 'dashcard', label: '虚线卡' }
    ]
  },
  { key: 'quoteBg', group: 'quote', kind: 'color', hint: '不设=按强调色派生浅底' },
  { key: 'quoteText', group: 'quote', kind: 'color', hint: '不设=按背景亮度自适应' },
  { key: 'quoteBorder', group: 'quote', kind: 'color', hint: '配「虚线卡」形态' },
  // ---- 分隔线 ----
  {
    key: 'hrStyle',
    group: 'divider',
    kind: 'enum',
    options: [
      { value: 'line', label: '居中短横' },
      { value: 'dot', label: '圆点列' },
      { value: 'long', label: '通栏细线' }
    ]
  },
  { key: 'hrColor', group: 'divider', kind: 'color', hint: '三种形态共用一个线色；不设=中性灰/强调色' },
  // ---- 加粗 ----
  {
    key: 'strongStyle',
    group: 'strong',
    kind: 'enum',
    options: [
      { value: 'color', label: '着色' },
      { value: 'highlight', label: '底色高亮' },
      { value: 'plain', label: '纯加粗' }
    ]
  },
  { key: 'strongColor', group: 'strong', kind: 'color', hint: '显式设置后不再跟随强调色重链' },
  { key: 'strongBg', group: 'strong', kind: 'color', hint: '配「底色高亮」' },
  // ---- 卡片与图片 ----
  {
    key: 'bodyBg',
    group: 'card',
    kind: 'color',
    sentinel: { value: 'none', label: '去卡片（纯白底）' },
    hint: '正文卡片底色；夜间由公众号逻辑自动变深'
  },
  { key: 'pageBg', group: 'card', kind: 'color', hint: '页面纸底（正文卡之下的纸色外壳）；夜间由公众号逻辑自动变深' },
  { key: 'bodyRadius', group: 'card', kind: 'number', unit: 'px', integer: true, step: 2 },
  { key: 'bodyPadding', group: 'card', kind: 'text', placeholder: '20px 22px', hint: 'CSS 内边距写法；给裸数字按 px 处理' },
  { key: 'imgRadius', group: 'card', kind: 'number', unit: 'px', integer: true, step: 2 },
  // ---- 表格 ----
  {
    key: 'tableStyle',
    group: 'table',
    kind: 'enum',
    options: [
      { value: 'bordered', label: '全边框' },
      { value: 'striped', label: '斑马纹' },
      { value: 'plain', label: '极简' }
    ]
  },
  { key: 'tableHeaderBg', group: 'table', kind: 'color' },
  { key: 'tableHeaderText', group: 'table', kind: 'color', hint: '不设=按表头底色亮度自适应' },
  { key: 'tableBorder', group: 'table', kind: 'color' }
]

/** number 字段的限位取自 THEME_NUM_RANGES（唯一口径），本表不重复写数字 */
export function themeFieldRange(key: ThemeOverrideKey): [number, number] | undefined {
  return THEME_NUM_RANGES[key]
}
