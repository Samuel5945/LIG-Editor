# AI 排版视觉层放开（B）设计规格

- 日期：2026-09-30
- 状态：设计定稿，待实现
- 前置：chat-tools v1 已上线（对话可调 set_theme，当前仅 10 字段）
- 对应 PRD：§7.6 排版调性、§10.2 工具面（实现后滚动补记）

## 1. 背景与目标

排版主题（ArticleTheme）共有 25+ 视觉字段，导出内联样式与编辑器 CSS 变量已完整消费；但 meta 级覆盖白名单只有 10 个字段（accent/两字号/两排列/三种标题装饰/bodyBg），行距、字距、字体、段距、字色、引用形态、分隔线形态、加粗形态、圆角、表格样式等十余个维度 AI 与用户都无法触达——AI 排版被困在文本层。

目标：**meta 覆盖白名单扩至全量视觉字段**（数据源汇入既有合并出口，编辑器与导出零消费端改动自动生效）；AI 三条触达路径全通（对话 set_theme 连招 / 排版优化对话框打包输出 / AI 生成整套主题入库）。

## 2. 已确认决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 覆盖口径 | 全量约 20 个新字段（见 §3），机制与现有 10 字段一致（逐字段覆盖/null 恢复默认） |
| 2 | AI 入口 | 双轨：对话连招（patch_article + set_theme）+ 排版优化对话框打包输出（文本 diff + 视觉参数预览） |
| 3 | AI 主题生成 | 本期做：新工具 `save_theme_preset`，对话一句话生成整套主题入库 |

## 3. 新增 meta 覆盖字段（20 个，全部可选）

| 字段 | 类型 | 校验/范围 |
|---|---|---|
| fontFamily | string | 非空字符串（字体栈） |
| lineHeight | number | 夹取 1.5–3 |
| letterSpacing | string | 非空（如 '0.02em'） |
| pGap | number | 夹取 0–48 |
| bodyText | hex | isHexColor |
| headingColor | hex | isHexColor |
| quoteStyle | 枚举 | 'leftbar'\|'card'\|'quotes'\|'dashcard' |
| quoteBorder | hex | isHexColor |
| hrStyle | 枚举 | 'line'\|'dot'\|'long' |
| strongStyle | 枚举 | 'color'\|'highlight'\|'plain' |
| strongBg | hex | isHexColor |
| strongColor | hex | isHexColor |
| imgRadius | number | 夹取 0–40 |
| bodyRadius | number | 夹取 0–40 |
| bodyPadding | string | 非空（如 '20px 22px'） |
| tableStyle | 枚举 | 'bordered'\|'striped'\|'plain' |
| tableHeaderBg | hex | isHexColor |
| tableBorder | hex | isHexColor |
| tableHeaderText | hex | isHexColor |
| h2Bg | hex | isHexColor |

校验原则：hex 非法、枚举外值 → **回落主题默认**（不写覆盖）；数值 → **夹取**；与现有 bodyBg 的 'none' 哨兵语义互不干扰（本期不新增哨兵）。

## 4. 数据层改动

1. `shared/types.ts` ProjectMeta：+20 可选字段（带注释）。
2. `shared/categoryThemes.ts` resolveArticleTheme：Pick 白名单 10→30；逐字段校验合并（校验函数集中本文件导出，供复用与单测）。**accent 重链特例**保留：仅当 meta 未显式覆盖 headingColor/strongColor 时，这两色跟随最终 accent 重链；显式覆盖优先。
3. **`main/projectStore.ts` readMeta 白名单同步透传 20 字段**（PRD §14 回归高发点，实现清单显式列项）。
4. 导出（exportHtml）与编辑器（CSS 变量）**零改动**——字段已在 ArticleTheme 且被完整消费，覆盖值汇入合并出口即自动生效。
5. App `handleApplyTypography`：patch 类型扩展至全字段（if-in 写入 / null 清除语义保持）。

## 5. AI 侧

### 5.1 set_theme 扩展（capabilityCore）
schema properties 与 handler 扩至 §3 全部字段；语义与现有一致：有值覆盖（数值夹取/非法回落发生在 resolve 层，工具层原样写入可选字段）、null 恢复默认、未传不动。工具描述补全字段说明。

### 5.2 对话连招（ChatPanel 守则）
工具守则追加：「排版类请求：patch_article 调整文本结构 + set_theme 调整视觉参数（行距/字距/字体/引用形态等全字段），两工具连用」。

### 5.3 新工具 save_theme_preset
- 入参 `{ name, theme: 完整 ArticleTheme }`；校验：accent 必填且 hex，数值夹取，枚举守卫，非法键剔除。
- 执行：`saveCustomTheme(name, theme)`（复用 themeStore，自动建同名分类目录）。
- 渲染层联动：工具名命中 save_theme_preset 且成功 → ChatPanel 调新 prop `onCustomThemesChanged`（App 传刷新 customTheme:list 的回调），主题库即时生效。
- 守则追加：「用户要为新分类设计主题 → 输出完整主题 JSON 调 save_theme_preset」。

## 6. 排版优化对话框打包输出

- `polishLayoutMessages` 协议升级：输出**排版后全文 markdown**，末尾可附 `<theme>{视觉参数 JSON}</theme>` 围栏（仅当模型判断视觉层需要调整；字段=§3 子集）。提示词写明：内容不动时 article 输出原文亦可，单独调视觉。
- shared 新纯函数 `parseLayoutOutput(text)` → `{ article, themePatch? }`（围栏缺省/坏 JSON → themePatch undefined，**行为与现状完全一致**，向后兼容）。单测覆盖。
- PolishDialog：diff 展示用 article；themePatch 存在时确认区追加「视觉参数」预览块（字段中文名+值列表）；onConfirm 签名扩展为 `(article, themePatch?)` → App：setArticle + themePatch 非空时 handleApplyTypography(themePatch)。
- handleApplyArticleAccent 类似的即时预览：不做（编辑器实时渲染已由 meta 写入后重算覆盖）。

## 7. 范围外（后续）

编辑器排版设置面板不加新字段控件（新字段本期由对话/AI 调整）；自定义主题管理页增强；AI 主题效果缩略预览。

## 8. 测试

1. `categoryThemes.test.ts` 扩：§3 每字段的 合法覆盖/非法回落/数值夹取 矩阵；accent 重链与 meta.headingColor 显式覆盖的优先级。
2. `readMeta` 往返测试：20 新字段写入→读出不丢失。
3. `parseLayoutOutput`：有 theme 围栏 / 无围栏 / 坏 JSON / 围栏内非对象 四态。
4. capabilityCore set_theme：新字段写入与 null 清除（既有测试文件扩展）。
5. 手工验收：对话「行距调 2.4、引用改卡片式」→ 编辑器+导出预览实时变化；「按本文内容给生活常识分类设计一套主题」→ 入库+建分类+即时生效；排版优化对话框输出含视觉参数 → 打包应用。
