# 对话副驾驶工具调用（chat-tools v1）设计规格

- 日期：2026-09-29
- 状态：设计定稿，待实现
- 对应 PRD：§10.2 MCP 能力核（实现后补记「内部对话已接入工具调用」）

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
- **写类（15，执行 + 结果卡）**：create_project / set_project_category / write_article / patch_article / save_ideas / save_review / set_titles / set_theme / render_figure / generate_image / import_image / set_cover / schedule_set / export_html / export_docx——执行后结果卡显示动作 + 关键结果（导出给文件路径，配图给缩略）。
- **外发（2，确认卡）**：push_draft / push_cards——模型发起后卡片展示目标账号与内容摘要，用户点「推送」才执行；点「取消」把「用户拒绝了推送」作为 tool 结果回传。
- 工具卡状态：进行中（转圈）/ 完成 ✓ / 失败 ✗；失败信息作为 tool 结果回传，模型自行解释或换路。

### 3.4 系统提示词

freeChatSystemPrompt 追加「工具守则」段：当前工程名（默认操作对象）；改正文优先 `patch_article` 精准补丁、全量覆写仅限重写；一次只调一个工具；回答前先看工具结果再下结论。

### 3.5 降级

供应商对 `tools` 参数报错（400/不支持）：本轮自动去 tools 重试 + 会话内记住「该供应商不支持」，后续请求不再带 tools → 回到现有围栏协议模式。围栏协议（article-update 等）保留不删。

## 4. 明确不做（v1）

对话内多工具并行调用；轮次上限调整 UI；非当前工程的隐式切换确认（模型指定其他工程名时直接执行，读类无害、写类有结果卡）；对话内 MCP 透传给外部服务。

## 5. 测试

- shared：工具过滤（25→20 名单）、消息序列组装（assistant+tool 消息拼接）纯函数单测。
- main：tool_calls 碎片累积函数单测（模拟分段 delta）。
- 手工验收：读类静默、写类结果卡、推送确认卡、降级路径（配一个不支持 tools 的供应商）、轮次上限、失败回传。
