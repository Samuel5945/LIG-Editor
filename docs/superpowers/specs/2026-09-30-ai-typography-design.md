# AI 排版视觉层放开（B）设计规格

- 日期：2026-09-30
- 状态：**已实现**（§4 数据层 + §5 AI 侧 + §6 对话框打包 + §8 测试全部落地，实现实况差异见文末）
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

## 9. 实现实况（落地记录，与规格的差异都在这节）

**口径单源**：覆盖白名单落为 `THEME_OVERRIDE_KEYS`（30 键，`categoryThemes.ts` 导出），`sanitizeThemePatch` 与确认卡中文名 `THEME_FIELD_LABELS`（`layoutOutput.ts`）都按它对齐，并各有一条「逐键可写 / 逐键有中文名」的测试——新增字段只改一处会在测试里红，不再靠人记「三处同改」。

**改了一处规格没写但必须改的判定**：`resolveArticleTheme` 的数值覆盖原先按真值短路（`meta?.pGap && isFinite(...)`），于是 **0 被当成「未覆盖」**——段距 0、图片方角（imgRadius 0）这两个合法诉求会静默回落主题默认。已统一改成 `!== undefined` 判定，`pGap: 0 / imgRadius: 0 / bodyRadius: 0` 有用例钉住。

**§8.4 的落点变更**：`capabilityCore` 引 `./ipc`（electron）与图渲染链，不进 vitest 环境，所以 set_theme 的校验面改在两处等价覆盖——`resolveArticleTheme` 合并矩阵（工具原样写入可选字段，回落/夹取就发生在这一层）+ `sanitizeThemePatch`（save_theme_preset 与对话框打包的共用校验面）。null 清除语义在 `projectMetaVisualPassthrough.test.ts` 里按盘上实际形态断言（写 `undefined` → JSON 里键消失）。

**规格外补强**：`polishLayoutMessages` 接收当前生效主题并写进提示词作基线（否则模型无从判断「视觉层要不要动」，只能瞎猜），并明确「宁缺勿滥：不需要就不输出 `<theme>`」；`PolishDialog` 确认区在有视觉参数时多一个「只应用排版」退路。工具卡中文名表顺带补齐 `save_theme_preset` 与 `export_pdf`（后者此前漏在表外，界面上只露英文工具名）。

**尚未验证的部分**：§8.5 三条手工验收需要真实模型 Key 与真实 IME，代码侧只做到 typecheck + 463 例全绿 + 运行中 dev server 已服务新模块（`/src/components/ChatPanel.tsx`、`/src/components/PolishDialog.tsx`、`/@fs/.../layoutOutput.ts` 均 200 且无 transform 错误）。

## 10. 实跑取证：「行距没生效」三层原因（2026-09-30 事后）

用户报「Agnes 与 neohorse 两个模型设行距都没生效」，会话 `toolTrace` + `project.json` 对账后拆成三层，**只有后两层是代码问题**：

1. **运行中的 app 用的是旧主进程构建**（第一因，运维性）。`out/main/index.js` mtime 09:07:53，而「白名单 10→30」提交 10:53、「set_theme 全字段 + save_theme_preset」提交 10:57；在该产物里数 `save_theme_preset` 得 0 次。即活着的 `set_theme` 只认老的 10 个字段，`lineHeight` 无从写入——**两个模型同时失败本身就是「与环境无关的共性」信号**。渲染层被 vite 热更新过多次，主进程一直是旧的（dev 不热重建主进程）。教训：动过 shared 里被主进程消费的字段口径，判据是**对账 `out/main` 的 mtime 与新符号是否存在**，不能拿「模型没表现」当结论。
2. **蛇形参数名被静默丢弃**（已修）。留痕里实测到 `line_height: 3`：能力核按 `inputSchema` 的驼峰名取值，蛇形写法既不报错也不写入。新增 `shared/toolArgs.normalizeToolArgs`，在原生与文本协议共同入口 `roundCalls` 处按各工具声明的合法键归一（蛇形→驼峰、JSON 字符串数组→结构、非法 JSON 原样交给工具报错）。
3. **协议宽容度不足**（未修，列为复验后的下一步）。另一次留痕 `argsSummary` 为空并报「缺少参数 project」，可见消息里模型输出的是**裸 function 标签、缺外层 `tool_call` 包裹**，而解析器只认带包裹的形式，于是标签连同参数被当正文剥掉。本轮没动 `llmText.ts`（chat-tools 回归高发区，且旧 registry 本身就会诱发模型自由发挥），等主进程重建后复验，若该写法仍出现再补宽容匹配。

**口径决策（作者定）**：行距下限**保持 1.5 不放宽**，但越界不得静默——`set_theme` 夹取后把「行高只支持 1.5-3，你给的 1.4 已抬到 1.5」写进返回 `hint`（区间单源 `THEME_NUM_RANGES`），让模型照实转述，不再出现「设了没反应」这种比报错更难查的形态。

**重启后复验清单**：① 「行距调到 2.4」→ `project.json` 出现 `lineHeight: 2.4` 且编辑器/导出预览同步；② 「行距调到 1.4」→ 工具卡与模型回答都明说抬到 1.5；③ 故意用蛇形说法（或让模型用 `line_height`）→ 归一后照常生效；④ 若再现裸 function 标签丢参数 → 按第 3 条补解析器。

## 11. 第二轮排查（同日，用户实跑 6 轮会话留痕取证）

**「AI 生成整套主题」这条路径此前是坏的，且以假成功形态坏着。** 14:20 那轮 `save_theme_preset` 返回 `{ok:true, hint:"已入库"}`，盘上主题实际只有 `{"accent":"#7c3aed"}` 一个字段，模型随后把根本不存在的「浅紫圆角引用卡片 / 紫色渐变分隔线 / 行距 1.8」描述给了作者。两层根因：

1. `theme` 参数的 schema 只写了 `type:'object'`，**没有 properties** → `normalizeToolArgs` 拿不到合法键集，蛇形与自造键无从归一；
2. `sanitizeThemePatch` 对白名单外的键**静默剔除**，且不告诉调用方剔了什么。

另外发现一个口径 bug：**`ArticleTheme.fontSize` 与 `ProjectMeta.bodyFontSize` 不同名**，用 meta 白名单清洗 ArticleTheme 会丢掉字号、又把 `bodyFontSize` 存进主题库（主题消费者不认），所以即便模型写对也不会生效。

修的内容：`THEME_KEY_ALIASES`（35 项，含实测出现的 `text_color`/`font_family`/`paragraph_spacing`/`h2_color` 等）、`normalizeThemeKeys`（映射不了进 `unknown`）、`metaPatchToThemeKeys`（存主题前换回主题口径）、`themeNumber`（"1.85"/"16px" 这类字符串数值读出来）、`sanitizeThemePatchDetailed`（额外返回 `unknown`/`invalid`）；`save_theme_preset` 返回 `appliedFields`/`unknownKeys`/`droppedKeys` 与一句「未写入的部分不得声称已生效」，`name`↔`category` 互为别名（实测连续两轮只给 category）；`set_theme` 摊平被包一层的 `theme`/`overrides`/`patch`/`params` 并回报未知键与非数值；`expandWrapperCalls` 展开 `tool_call`/`invoke` 壳（实测报过「未知工具：tool_call」）；工具守则要求模型照实转述 hint。

**活实例实测**（重启后走 bridge，用模型当时那份原始坏载荷）：入库字段 1 → **6**（`accent/fontFamily/lineHeight 1.85/bodyText/headingColor/fontSize 16`，字号口径正确），`unknownKeys:["quote_bg"]`、`droppedKeys:["pGap"]`（值写的是 `1.4em`）如实报出；`{"project":"test","theme":{"lineHeight":2.1}}` 落盘成功；探针写入的 `customThemes.json` 与 `test/project.json` 均已按原字节还原。

**未做**：`project`↔`name` 的全局参数名别名（14:09 那轮 `get_project` 传 `name` 报「缺少参数 project」，属同类但影响面是所有工具，需单独决定口径）；对话消息气泡此前无 `break-words`，模型吐长 JSON/URL 会撑出横向滚动条（已改为气泡断行 + 消息区只允许纵向滚动）。

## 12. 补全支持（同日第二轮，按实跑诉求扩到 34 字段）

会话普查给出模型真正要过的键全集，其中大部分已被 §11 的别名表覆盖，**产品里真的没有形态的只有四个**，本轮补成字段：`quoteBg` 引用底色、`quoteText` 引用文字色、`hrColor` 分隔线颜色、`h2Border` H2 竖条/下划线色。每个都走完整链路：ArticleTheme + ProjectMeta + `THEME_OVERRIDE_KEYS`（30→34）+ sanitize 色值校验 + resolve 合并 + `readMeta` 透传 + set_theme / save_theme_preset schema 与描述 + 中文名表 + 编辑器 CSS 变量（`--article-quote-bg/-color`、`--article-h2-left/-border`、`--article-hr-border`）+ 导出内联样式，共 19 处消费点；未设置时保持原派生（accent 淡底 / 中性灰 / 跟随强调色），不改变既有主题的观感。

`link_color`、`secondary_color`、`hover_shadow` 这类**刻意不补**：正文 markdown 子集禁链接、次级文字色没有消费方、卡片阴影不进公众号——按「没有消费方就是死字段」的既有原则，工具改为如实报 `unknownKeys` 而不是加个不生效的字段。

顺带两处真实缺陷（都由测试/实测暴露）：
- `isHexColor` 收到非字符串（模型写 `h2Border: 123`）会 `s.trim()` 抛异常，把整篇导出/编辑器渲染带崩；改为 `unknown` 入参并类型守卫，实测崩溃路径消失。
- `set_theme` 旧实现把非法值原样写进 meta 再靠 resolve 静默回落，等于「报成功却没生效」；改成**校验后写入**（不合法不动盘上现值）并回报 `droppedKeys`；同时修掉反向误报——`lineHeight: null` 是显式恢复默认，曾被错报成「值不合法未写入」（把成功说成失败）。
- 工程定位新增 `name` ↔ `project` 别名（14:09 实测 `get_project` 传 name 报缺参），并让被消费的 `name`/`dir` 不再被算进「不认识的参数」。

活实例实测（16:16 构建，走 bridge，`test` 工程现场按原字节还原）：四色值落盘 ✓；`quote_bg`/`divider_color`/`h2_border_color` 等自造键经别名映射后 `appliedFields` 由 6 升到 9，只有产品真没有的 `hover_shadow` 进 `unknownKeys` ✓；`"2.4"`/`"28px"` 字符串数值救回 ✓；`9` → 夹到 3 并带说明 ✓；枚举外值 `bubble` 报 `droppedKeys` 且不动盘 ✓；`null` 清除干净且不再误报 ✓。
