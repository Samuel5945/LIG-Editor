# 给基元律动（TokenRhythm）的问题反馈：neohorse 的 function calling 没有回传，导致下游「导出 Word」整条链路失效

反馈方：立格编辑器（LIG-Editor，Electron 桌面应用；对话副驾驶通过 OpenAI 兼容的 tools 参数调用本地 20 个工具）
接入方式：baseUrl = https://tokenrhythm.studio/v1 ，POST /v1/chat/completions ，Authorization: Bearer [key]
涉及模型：neohorse（文本模型，在贵方网关列表中选择）
日期：2026-09-30

---

## 1. 一句话结论

neohorse 走贵方 `/v1/chat/completions` 时，请求里的 `tools` / `tool_choice` 被照单收下、HTTP 200 正常返回文本，但响应流里**从头到尾没有出现 `choices[].delta.tool_calls`**。对客户端来说这不是「报错」，而是「静默无视」——模型以为自己在调用工具，实际什么都没发生。于是「导出 Word」退化成三种坏结果：把全文贴回对话让用户自己复制、直接回答「编辑器不支持导出 Word」、以及臆造训练数据里的工具名（例如 <mcp__workspace__list_projects/>）。

导出能力本身在本地是好的（同一工程、同一句用户指令，换用能返回 tool_calls 的通路就正常产出 .docx），所以问题定位在**网关/模型侧的 tool 调用透传**，不在客户端。

---

## 2. 我们实际观察到什么

请求体（每个对话轮都带，工具循环最多 6 轮）：

```json
{
  "model": "neohorse",
  "messages": [
    { "role": "system", "content": "对话副驾驶系统提示 + 工具守则" },
    { "role": "user", "content": "导出word" }
  ],
  "stream": true,
  "tools": [
    { "type": "function", "function": {
        "name": "export_docx",
        "description": "把工程导出为可编辑的 Word 交稿稿（标题/正文/表格/图片进 Word 原生结构），落到工程「交付/」目录，返回绝对路径",
        "parameters": { "type": "object", "properties": { "project": { "type": "string" } }, "required": ["project"] } } },
    { "type": "function", "function": { "name": "write_article", "...": "共 20 个 function" } }
  ],
  "tool_choice": "auto"
}
```

响应：HTTP 200，SSE 分片正常，`choices[0].delta.content` 有文本。我们按 `index` 累积 `choices[0].delta.tool_calls`（`id`/`name` 取值覆盖、`arguments` 逐段拼接），**累积结果始终为空数组**，`finish_reason` 也从未出现过 `tool_calls`。

结论：贵方链路在「收下 tools」和「回传 tool_calls」之间断了一环。

---

## 3. 现场留痕（客户端会话日志，可按时间戳对齐贵方请求日志）

立格编辑器把每轮工具调用落盘在会话文件的 `toolTrace` 字段。失败轮次的共同特征就是 **toolTrace 为空**——模型说了话，但一次工具都没真正发起。

| 会话文件（本仓库 workspace/ 下） | 用户说 | 模型做了什么 | toolTrace |
|---|---|---|---|
| `未分类/自媒体推广实操清单/chat/2026-09-29T06-51-36-169Z.json` | 导出word | 「以下是文章的完整 Markdown，复制到 Word 里保存即可」，把 2000+ 字全文贴回对话 | 空 |
| `未分类/自媒体推广实操清单/chat/2026-09-29T07-59-05-048Z.json` | 导出work | 整条回复只有 <tool_call> <mcp__workspace__list_projects/> </tool_call>——调用了一个贵方清单里不存在、来自训练数据的名字 | 空 |
| `未分类/自媒体推广实操清单/chat/2026-09-29T07-59-38-038Z.json` | 连续 4 次「导出word」「导出pdf」 | 「我这边没法直接导出 Word 文件」／「立格编辑器目前不支持直接导出 Word（.docx）」，并编造不存在的菜单路径让用户手动另存为 | 空 |
| `科技数码/代码生成翻倍…/chat/2026-09-29T13-04-12-943Z.json`（对照组） | 导出word | export_docx → status: "done"，返回真实落盘路径 `…/交付/…-交稿.docx` | 有 |

两点如实标注，以免误判：

- 会话文件不落模型名，前三行不能逐条断言都出自 neohorse；但「聚合供应商收下 tools 却从不返回 tool_calls」是我们针对贵方通路做的实测结论，已写进本仓库修复记录（提交 66e1641：「聚合供应商（基元律动/Agnes）收下 tools 参数却从不返回 tool_calls」）。请按时间戳核对贵方日志。
- 对照组用来排除「客户端工具坏了」这一可能：同一个 export_docx、同一句指令，通路正常时就一定能出文件。

---

## 4. 希望贵方确认/修复的 5 件事

1. **neohorse 上游是否支持 OpenAI function calling？** 若支持，请检查网关转发前是否丢弃了 tools / tool_choice（最常见成因：路由按「纯文本补全」模板拼上游请求，参数白名单里没有 tools）。
2. **流式回传是否原样透传 delta.tool_calls**：包括 `index`、`id`、`function.name`（通常只在首片出现）、`function.arguments`（逐字增量拼接），以及末片的 `finish_reason: "tool_calls"`。任何一处被吃掉，客户端就永远收不到调用。
3. **不支持时请显式报错，而不是静默忽略。** 建议 HTTP 400 + `{"error":{"code":"tools_unsupported","message":"model neohorse does not support tools"}}`。静默 200 对客户端是最坏情况：它会把「没报错」误判成通路可用从而关掉降级逻辑，最终表现为「功能悄悄没了」，用户只会以为产品本身不支持导出。
4. **多轮回传链路**：一次调用返回后，我们会把 assistant 消息（带 tool_calls）与若干 `role: "tool"` 消息（带 `tool_call_id` 和工具返回值）原样送回，继续下一轮。请确认网关不会丢弃 tool_calls 字段或 role=tool 消息——否则即使第一跳能回传，工具循环也会断在第 2 轮。
5. **/v1/models 建议补能力元数据**（是否支持 tools、模态类型）。顺带一条已确认的现状：贵方 /v1/models 不返回生图模型 `wan2.7-image` / `qwen-image-2.0`，目前是我们客户端硬编码并入的，否则用户在列表里选不到。

---

## 5. 最小复现（可直接转给后端）

把 KEY 换成自己的 Key，10 秒出结论：

```bash
curl -N https://tokenrhythm.studio/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "neohorse",
    "stream": true,
    "tool_choice": "auto",
    "tools": [{"type":"function","function":{
      "name":"export_docx",
      "description":"把当前文章导出为 Word 交稿稿，返回文件绝对路径",
      "parameters":{"type":"object","properties":{"project":{"type":"string"}},"required":["project"]}}}],
    "messages": [{"role":"user","content":"请把文章导出为 Word"}]
  }' | tee /tmp/rhythm.txt

grep -c 'tool_calls' /tmp/rhythm.txt   # 期望 >= 1；实测为 0 即复现
```

验收判据：**响应流里出现非空 delta.tool_calls（或 finish_reason 为 tool_calls）才算通**。只看 HTTP 200 和文本内容不能作为依据——这正是我们最初踩的坑。

---

## 6. 我们这边已经做的规避，以及它的代价

为了不让用户卡在这一步，客户端已实现完整降级通路，功能等价，但有成本：

- 清单注入判据从「请求没报错」改成「**该模型实际返回过一次 tool_calls**」；未证实的模型一律把 20 个工具的名字与用途写进 system prompt（约 +480 token/请求，长期占上下文和费用）。
- 收编文本协议：模型自发写出的围栏格式（```tool-call 代码块）、标签格式（<tool_call> 内包 <function=export_docx>，或直接以工具名作标签名）、属性写法 k="v"、整段 JSON 作参数、零参数调用——全部由渲染层解析后本地执行；并额外过滤 <mcp__workspace__list_projects/> 这类不在清单里的臆造名字。
- 入参兜底：文本协议下数组参数必然是一段 JSON 字符串，做了归一；工程名的全角/半角标点变体做归一匹配，并把 dir（工程绝对路径）提升为一等入参，避免模型打字不准直接报 ENOENT。
- 防幻觉：本轮零工具调用却声称「已导出/已修改」时，回复尾部如实标注「内容未确认写入」。

把话说明白：**贵方通路修好后，这些规避就变成纯开销**——多花的 token、文本协议解析的天然脆弱（少写一个参数只能靠报错纠正，实测会连撞两次才停下来问用户）、以及拿不到原生并行调用。请优先排第 4 节的第 1–3 项。

---

## 7. 客户端解析口径（供贵方回归时对照）

- 只读取 `choices[0].delta.content` 与 `choices[0].delta.tool_calls`；SSE（data: 前缀）与 NDJSON（裸 JSON 行）两种流格式都兼容；`[DONE]` 之外的非 JSON 心跳行忽略。
- 非流式请求（能力核用）额外兼容「无视 stream:false 仍返回 SSE」的网关，取值顺序为 `message.content` → `delta.content`。
- 若贵方改为回传 tool_calls，请保持 `arguments` 是可被 JSON.parse 的完整对象串（分片拼接后），不要在 arguments 里夹解释文字。
