# 对话副驾驶工具调用（chat-tools v1）设计规格

- 日期：2026-09-29
- 状态：已实现（v1.1）；当日实测推翻了 §2/§3.5 的若干假设，修订见 §6
- 对应 PRD：§10.2 MCP 能力核（内部对话已接入工具调用）

## 1. 背景与目标

应用存在内外双轨鸿沟：外部 Agent 经 MCP/HTTP bridge 可用 **25 个工具**（建工程/改正文/配图/排期/导出/推送全流程），而内置对话副驾驶只有 **3 条手写围栏指令**（article-update/cards-accent/skill-install）、零工具调用——用户在对话里说「帮我配图/导出/排期」，模型只能文字指引去别的面板。

目标：把 capabilityCore 的工具以 **function calling** 暴露给内部对话模型，让工程动作一句话直达；同时保留现有围栏协议作为不支持工具调用供应商的降级路径。

## 2. 已确认决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 工具范围 | **全量 20 个**：排除 5 个提示词返回类（brainstorm/outline/article/review/titles_prompt——专为无头外部 Agent 设计，内部对话有自己的界面流） |
| 2 | 确认分层 | 读类 3 个静默自动执行；写类 15 个直接执行 + 结果卡；外发 2 个（push_draft/push_cards）**确认卡**，用户点了才执行 |
| 3 | 机制 | function calling（OpenAI tools 协议），供应商不支持时自动降级为现有纯文本/围栏模式 |
| 4 | 优先级 | A（工具调用）先行，B（AI 排版视觉层放开）后续独立规格 |

## 3. 架构与数据流

### 3.1 工具暴露（main → renderer）

- 新增 IPC `agent:listTools()`：返回 20 个工具的 `{ name, description, parameters }`（capabilityCore `TOOLS` 过滤提示词类后导出）。
- 新增 IPC `agent:callTool(name, args)`：渲染层执行入口，复用 `callTool` 现有实现（文件通道写广播、凭据边界等保障原样继承）。

### 3.2 执行循环（renderer/copilot/llm.ts 新增 `chatWithTools`）

1. `llm:chatStart` 扩展可选 options：`{ tools?: ToolSchema[] }`；main/llm.ts 的请求体带 `tools`，流式文本增量照常经 `llm:stream` 上屏。
2. 响应含 tool_calls 时：主进程**累积碎片**（id/name/arguments 逐段拼接），随 `llm:done` 事件交付 `{ requestId, toolCalls? }`（纯文本回复时该字段缺省）。
3. 渲染层收到 toolCalls：逐个弹卡（按确认分层）→ 执行 `agent:callTool` → 结果序列化为 tool 角色消息回填 → 携带完整消息序列发下一轮 `chatStart`。
4. 循环终止：模型给出纯文本回复，或达到**轮次上限 6**（到达后要求模型文本总结现状）。

### 3.3 确认分层与 UI

- **读类（3，静默）**：list_projects / get_project / read_article——自动执行，工具卡一行摘要（可展开看完整结果）。
- **写类（16，执行 + 结果卡）**：create_project / set_project_category / write_article / patch_article / save_ideas / save_review / set_titles / set_theme / render_figure / generate_image / import_image / set_cover / schedule_set / export_html / export_docx / export_pdf——执行后结果卡显示动作 + 关键结果（导出给文件路径，配图给缩略）。
- **外发（2，确认卡）**：push_draft / push_cards——模型发起后卡片展示目标账号与内容摘要，用户点「推送」才执行；点「取消」把「用户拒绝了推送」作为 tool 结果回传。
- 工具卡状态：进行中（转圈）/ 完成 ✓ / 失败 ✗；失败信息作为 tool 结果回传，模型自行解释或换路。

### 3.4 系统提示词

freeChatSystemPrompt 追加「工具守则」段：当前工程名（默认操作对象）；改正文优先 `patch_article` 精准补丁、全量覆写仅限重写；一次只调一个工具；回答前先看工具结果再下结论。

### 3.5 降级（v1.1 修订：判据不能是「有没有报错」）

原设想「供应商对 `tools` 报错 → 去 tools 重试 → 会话内记住不支持」，实测发现更常见的是**静默失败**：聚合供应商照单收下 `tools` 参数、不报错、也从不返回 `tool_calls`，模型转而自发用文本格式发起调用。若把「没报错」当成原生通路可用，工具清单就不再进入系统提示，模型于是完全不知道自己有什么工具（实测表现为回答「立格编辑器不支持导出 Word」并臆造 `mcp__workspace__list_projects` 这类训练数据里的名字）。

现行判据与通路（全自动，界面上不再暴露状态）：

- **原生通路证实**＝该模型（`baseUrl|textModel`）**实际返回过一次 `tool_calls`**；证实后停止注入工具清单（省约 480 token/请求）。
- 未证实（含拒收与静默无视）一律把清单写进系统提示，调用走文本协议，由渲染层解析执行——功能等价。
- 请求真的因 `tools` 报错时：本轮**静默去掉 tools 重试一次**，不打断用户；拒收记忆每 10 分钟自动过期重探，供应商后续支持就自动升回原生。

## 4. 明确不做（v1）

对话内多工具并行调用；轮次上限调整 UI；非当前工程的隐式切换确认（模型指定其他工程名时直接执行，读类无害、写类有结果卡）；对话内 MCP 透传给外部服务。

## 5. 测试

- shared：工具过滤（25→20 名单）、消息序列组装（assistant+tool 消息拼接）纯函数单测。
- main：tool_calls 碎片累积函数单测（模拟分段 delta）。
- 手工验收：读类静默、写类结果卡、推送确认卡、降级路径（配一个不支持 tools 的供应商）、轮次上限、失败回传。

## 6. 实现后同日修订（2026-09-29 实测驱动）

| 修订 | 触发问题 | 落点 |
|---|---|---|
| 工具清单注入系统提示 | 静默无视 `tools` 的供应商让模型看不见工具存在 | `llmText.toolsInventory` + `inventoryFor` |
| 文本协议三格式统一解析 | 模型自发写 tool-call 围栏、tool_call 标签式、标签名即工具名（含 `mcp__server__` 前缀、属性式与整段 JSON 参数、零参数调用） | `llmText.parseTextToolCalls` / `parseXmlToolCalls` |
| 数组入参归一 | 文本协议下 `patches`/`ideas`/`titles` 必为 JSON 字符串，被 Array 判定拒掉（「patches 不能为空」） | `llmText.coerceArrayArg`，`patch_article` 另认顶层 `old`/`new` |
| 缺参报错带形状与候选 | 「不能为空」这类报错让模型反复瞎猜，连续失败只能停下来问用户 | `capabilityCore.str` / `projectArg` |
| 工程名标点归一 + `dir` 一等入参 | 全角 `“ ” ：` 被模型写成半角或 `「」` → 报「非法工程名」/ ENOENT，模型据此让用户改名 | `projectStore.matchProjectName` / `matchProjectByDir`，带 `project` 的工具自动多收 `dir` |
| 补 `export_pdf` 工具 | 菜单有 PDF 导出但注册表没有，对话只能退化成导 HTML 让用户自己打印 | `capabilityCore`，三个导出出口统一 `stampExported` |
| 局部改动走 `patch_article`、整篇重写走 article-update 围栏 | 两条规则同时存在时模型每次都重贴全文 | `freeChatSystemPrompt(toolsAvailable)` + 工具守则分派 |
| 失败与假完成的收尾标注 | 模型两次声称「已落到编辑器」而 `article.md` 只有一行标题 | `ChatPanel` 按本轮各工具最后一次结果记账，零写入却声称完成时标注不可信 |
| 通路状态不再显示 | 「文本协议」标记画成告警色，被当成故障 | 移除标记，改静默重试 + 定时重探 |

实测验收：`代码生成翻倍…` 工程对话内 `导出word`/`导出pdf` 均产出 `交付/*-交稿.docx|pdf`；`月省千元不是梦：TokenRhythm如何用“自动选模”砍掉`（名字带全角标点）在标点变体写法下也能命中同一工程。
