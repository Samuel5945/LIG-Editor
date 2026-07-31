# PRD：图文编辑器（本地优先的公众号图文创作工作台）

- 版本：v1.0（2026-07-28）
- 状态：待评审
- 工作区：`C:\Users\PC\Desktop\图文编辑器`
- 参考范式：[Nomi](https://github.com/aqm857886159/Nomi)（本地优先 + AI 副驾驶 + 无头能力核），本产品为其"图文版"适配

---

## 1. 背景与定位

### 1.1 要解决的问题

一篇合格的公众号图文要经过：**脑暴选题 → 生成初稿 → 反复修改 → 审阅把关 → 配图/封面 → 标题打磨 → 排版导出**。目前这条链路散落在聊天窗口、本地 HTML 渲染脚本、图片处理脚本和公众号后台之间，素材靠手工搬运，改一张配图要跑一遍完整的"渲染→截图→替换→保存"手工流程。

### 1.2 产品定位

一个 **Windows 桌面 EXE**（Electron），把上述链路收进同一个工作台：

- **本地优先**：工程、素材、密钥全在本机，不上传任何内容到自有服务器
- **AI 副驾驶**：右侧对话面板驱动全流程，结果直接落到编辑器，改动可确认
- **Agent 可操控**：创作能力抽成无头能力核（MCP + 本地 HTTP），Codex / Qoder（WorkCN）/ workbuddy / Marvis 可用对话指挥编辑器；工程文件为纯文本，Agent 也可直接改文件，编辑器热载
- **模型自带**：接入任意 OpenAI 兼容 API（预置 Agnes AI `https://apihub.agnes-ai.com/v1`），文本与图像模型分开配置

### 1.3 非目标（明确不做）

- EXE 自身**不做联网搜索/热点抓取**——该能力由接入的模型 API 或外部 Agent 承担；产品侧通过 Skill 导入（如 wechat-viral-topic）提供方法论
- 不做多人协作、云同步、账号体系
- MVP 不做视频/动图创作（保持与 Nomi 的分工：它管视频，本产品管图文）

---

## 2. 用户与核心场景

**目标用户**：个人公众号作者 / 自媒体创作者（首个用户即产品所有者），同时把外部编程 Agent 视为"第二用户"。

| # | 场景 | 走向 |
|---|------|------|
| S1 | 手里有素材（链接文本/PDF/一句话想法），想脑暴出选题 | 副驾驶脑暴 → 选题卡 → 入选题库或立项 |
| S2 | 定了选题，想快速出一篇有个人风格的长文初稿 | 挂风格 Skill → 大纲 → 全文 → 落编辑器 |
| S3 | 初稿不满意，逐段修改打磨 | 编辑器选区 + 指令 → diff 高亮 → 确认应用 |
| S4 | 发布前想全面审一遍 | 审阅报告（结构/事实存疑/风格/敏感词/配图建议） |
| S5 | 需要配图：数据图用代码画，氛围图用 AI 生，品牌图用真图抠 | 三种配图管线，产物统一进 assets/ |
| S6 | 出标题候选和封面图 | N 个标题打分；封面 2.35:1 主图 + 1:1 小图 |
| S7 | 成品发到公众号 | 一键复制富文本 → 粘贴到公众号后台（MVP） |
| S8 | 在 Codex/Qoder 里说"帮我把第三张配图换成超椭圆序列图" | Agent 走 MCP 或直改 figures/*.html，编辑器热载 |

---

## 3. 总体架构

### 3.1 技术栈

- **Electron + React + Vite + Tailwind**（与 Nomi 同源，Agent 修改源码最熟悉）
- 富文本编辑器：**TipTap（ProseMirror）**
- 图像处理：**sharp**（裁切/合成）+ 自研 JS 抠图算法（白底反预乘/形状掩码/拟合圆，移植自已验证的 Python 实现）
- 代码绘图渲染：Electron **offscreen BrowserWindow**（HTML→PNG，替代外部 headless Edge 命令行）
- MCP：`@modelcontextprotocol/sdk`（stdio）+ 内置 HTTP server（127.0.0.1 随机端口，写入锁文件供发现）

### 3.2 进程结构

```
┌─ Electron 主进程 ────────────────────────────────┐
│ · 工程文件存储 + chokidar 文件 watcher（热载）     │
│ · 模型调用代理（OpenAI 兼容，流式转发到渲染进程）  │
│ · MCP 能力核（stdio 入口 + 本地 HTTP/SSE）        │
│ · offscreen 渲染器（figures/*.html → assets/*.png）│
│ · 图像处理（抠图/裁切/封面合成）                   │
│ · 密钥加密存储（safeStorage）                     │
└───────────────────────┬──────────────────────────┘
                     IPC (typed)
┌─ 渲染进程：三栏工作台 ─┴──────────────────────────┐
│ 左栏           │ 中栏               │ 右栏        │
│ 项目列表        │ 富文本编辑器        │ AI 副驾驶    │
│ 选题库(ideas)  │ (TipTap 所见即所得   │ 对话面板     │
│ 素材/配图树    │  公众号内联样式预览)  │ (指令→diff→ │
│ Skill 管理     │ 标题/封面工作区(页签) │  确认应用)   │
└──────────────────────────────────────────────────┘
```

### 3.3 双通道 Agent 操控（关键设计）

1. **MCP 通道**：编辑器运行时暴露工具集（见 §10），外部 Agent 注册后用对话指挥
2. **文件通道**：工程为纯文本（Markdown/JSON/HTML），Agent 直接改文件；watcher 检测到变化 → 编辑器热载并提示"外部修改已同步"

两条通道等价且互补：MCP 适合"触发生成/渲染"类动作，文件直改适合精确的内容编辑。冲突策略：编辑器内有未保存修改时收到外部文件变化，弹 diff 对比让用户选择（保留本地/接受外部/合并）。

---

## 4. 工程文件格式（数据模型）

每篇图文 = 一个工程目录，**article.md 为正文唯一事实源**：

```
C:\Users\PC\Desktop\图文编辑器\workspace\<项目名>\
├── project.json      # 元信息（见下）
├── article.md        # 正文事实源：Markdown + 图片引用 + 图注语法
├── article.html      # 导出物：内联样式 HTML（由导出动作生成，勿手改）
├── ideas.md          # 本项目选题脑暴记录
├── review.md         # 最新审阅报告（每次审阅覆盖，历史入 chat/）
├── assets/           # 全部配图 PNG（AI生图/代码绘图产物/导入真图）
├── figures/          # 代码绘图源 HTML（一图一文件，可被 Agent 直改）
│   └── fig-01.html   #   头部注释声明画布尺寸，渲染产物 assets/fig-01.png
└── chat/             # 副驾驶会话历史（JSON，跨次打开保留上下文）
```

**project.json 核心字段**：

```json
{
  "name": "荣耀新LOGO",
  "status": "drafting",
  "topic": { "angle": "...", "audience": "...", "source_material": ["..."] },
  "titles": [ { "text": "...", "score": 8.5, "reason": "..." } ],
  "cover": { "main": "assets/cover-235.png", "square": "assets/cover-11.png" },
  "style_skill": "khazix-writer",
  "created_at": "...", "updated_at": "..."
}
```

status 取值：`ideating | drafting | reviewing | ready`。

**article.md 图片语法**（约定优于配置）：

```markdown
![AI时代的环形浪潮](assets/fig-02.png)
<!-- caption: AI时代，大家都在画环（此图片由个人自制非官方原图） -->
<!-- figure-source: figures/fig-02.html -->
```

编辑器解析 caption/figure-source 注释：渲染图注、提供"改源码重渲染"入口。

**全局目录**（workspace 同级）：

```
├── workspace\           # 所有图文工程
├── skills\              # 导入的 Skill（SKILL.md 格式）
├── idea-inbox.md        # 跨项目选题收集箱
└── settings\            # 模型接入配置（密钥加密）、导出模板、bridge.json
```

**取舍说明**：事实源选 Markdown 而非 ProseMirror JSON（Agent 不友好、不可读）或纯 HTML（人工编辑困难）。编辑器负责 md ↔ TipTap 双向转换；公众号排版样式在**导出时**套用内联样式模板注入，正文源保持干净。

---

## 5. 模型接入

### 5.1 面板能力

- 添加供应商：BaseURL + API Key +「测试连接」（自动探测 `/v1/chat/completions` 与 `/v1/images/generations` 或 chat 图像模式）
- **预置 Agnes AI**：`https://apihub.agnes-ai.com/v1`，填 Key 即用；文本模型与图像模型分别下拉选择
- 支持多供应商并存，按能力（文本/图像）分别指定默认模型
- Key 用 Electron `safeStorage` 加密落盘，仅本机可解

### 5.2 模型分工

| 任务 | 模型类型 | 说明 |
|---|---|---|
| 脑暴/大纲/全文/修改/审阅/标题 | 文本（chat/completions，流式） | 挂载 Skill 系统提示 |
| AI 生图/封面/图生图 | 图像 | 兼容 OpenAI images 接口与 Agnes 多模态 chat 格式 |

联网搜索：若所接模型自带 search 能力则自然可用；EXE 不实现独立搜索器。

---

## 6. Skill 系统

- **格式**：兼容 SKILL.md（frontmatter: name/description + Markdown 正文），与 `.agents/skills` 生态一致
- **导入**：从本地目录导入到 `skills\`；左栏 Skill 管理页可启用/停用/查看
- **挂载**：副驾驶按任务类型自动推荐挂载（脑暴→选题类 Skill；生成→风格类 Skill），也可手动指定；挂载即注入系统提示
- **首发建议内置**：`wechat-viral-topic`（选题方法论）、`khazix-writer`（个人写作风格）——以"预装可删"的方式放入 skills\

---

## 7. 五大能力流（副驾驶对话驱动）

所有能力统一交互模式：**对话发指令 → AI 产出 → 落盘 + 界面呈现 → 改动需确认**。

### 7.1 脑暴选题

- 输入：粘贴素材文本 / 导入文件（txt/md/pdf 文本抽取）/ 一句话想法 / 从 idea-inbox.md 与选题库取料
- 输出：**选题卡**列表（角度、目标读者、切入点、标题雏形、爆款潜力评估与理由）
- 动作：选题卡可「存入选题库」（追加 ideas.md / idea-inbox.md）或「立项」（创建工程并写入 project.json.topic）

### 7.2 生成图文

- 流程：选题 → 大纲（可编辑确认）→ 全文生成（流式渐显落入编辑器）
- 可选挂载风格 Skill；生成时在文中以占位符标记建议配图位（`<!-- fig-suggest: 描述 -->`），供配图管线消费

### 7.3 修改图文

- 编辑器内选中文本 → 浮动指令条（改写/扩写/缩写/换风格/自定义指令）
- AI 返回后以 **diff 高亮**（删除线+新增底色）呈现，确认后写入 article.md；支持撤销

### 7.4 审阅图文

- 一键整篇审阅，输出结构化报告：结构与节奏 / 事实存疑点清单 / 风格一致性 / 敏感词与合规风险 / 配图与图注检查（图片是否有图注、自制图是否标注非官方）/ 标题与内文匹配度
- 报告写入 review.md 并在右栏面板分区展示，每条问题带「定位到原文」跳转

### 7.5 标题与封面

- 标题：生成 N 个候选 + 打分 + 理由，入 project.json.titles，一键采用
- 封面：三种来源（AI 生图 / 代码绘图 / 导入图）→ 内置裁切器出 **2.35:1 主封面 + 1:1 朋友圈小图**，写入 project.json.cover

---

## 8. 配图管线（三种能力）

| 管线 | 流程 | 适用 |
|---|---|---|
| AI 生图 | 对话描述 → 图像模型生成 → 预览 → 存 assets/ → 插入正文 | 氛围图、封面 |
| 代码绘图 | AI 按描述生成 figures/fig-N.html（SVG/HTML 绘制）→ offscreen 渲染 PNG → 插入正文；源文件保留，**支持"改源码→重渲染→原位替换"闭环** | 数据图、序列图、对比图、示意图 |
| 真图导入+抠图 | 拖入图片 → 可选抠图（白底反预乘 / 形状掩码 / 拟合圆三种算法，JS 移植）→ 存 assets/ | 品牌 LOGO、实拍图（保真实性） |

统一约束：正文中的图必须位于 assets/，md 中相对路径引用；代码绘图必须保留 figure-source 注释关联。

---

## 9. 导出

### 9.1 MVP：公众号富文本复制

- 「导出」动作：article.md → 套用内联样式模板（默认模板复刻已验证的公众号排版：正文段距、图注灰字、无 class/id 全内联）→ 生成 article.html → 写入剪贴板 `text/html`（图片以 dataURL 内嵌，公众号粘贴时自动转存 CDN）
- 提供导出预览窗（模拟手机宽度）

### 9.2 二期

- 自动推公众号草稿（浏览器自动化：复用已验证的"section 选区替换 + paste + CDN 转存 + 保存草稿"流程）
- Markdown / 长图（整文渲染为竖版 PNG）/ PDF 导出

---

## 10. Agent 操控：无头能力核

### 10.1 接入方式

- **MCP stdio**：`图文编辑器.exe --mcp` 以无头模式启动能力核（不开窗口也能干活）；GUI 运行时同一能力核在进程内共享
- **本地 HTTP**：`http://127.0.0.1:<port>/api/*`，端口与 token 写入 `settings\bridge.json` 供本机工具发现
- **「一键接入」卡片**：设置页生成 Codex（`config.toml`）/ Qoder / Claude Code 的 MCP 配置片段，一键复制

### 10.2 MCP 工具面（MVP 集）

```
list_projects / create_project / get_project        # 工程管理
read_article / write_article / patch_article        # 正文读写（patch 为搜索替换式局部改）
brainstorm_topics / generate_article / review_article / generate_titles   # AI 能力
render_figure(figure_path)                          # 渲染 figures/*.html → assets/*.png
generate_image(prompt, target)                      # AI 生图落盘
import_image(src_path, matting_mode?)               # 导入+可选抠图
set_cover(image, crop) / export_html                # 封面与导出
```

### 10.3 文件直改通道

Agent 直接编辑 article.md / figures/*.html / project.json → watcher 热载。figures/*.html 变化时自动重渲染对应 PNG（可在设置关闭）。

---

## 11. 范围划分

### MVP（一期）

1. 工程管理（新建/打开/列表）+ 工程文件格式落地
2. 三栏工作台：TipTap 编辑器（md 双向同步、图注渲染）+ 副驾驶对话面板
3. 模型接入面板（预置 Agnes AI，多供应商）
4. 五大能力流：脑暴 / 生成 / 修改（diff 确认）/ 审阅 / 标题封面
5. 三种配图管线（AI 生图、代码绘图+offscreen 渲染、真图导入+抠图）
6. 导出：内联样式 HTML + 富文本复制
7. MCP 能力核（stdio + HTTP）+ 文件 watcher 热载 + 一键接入卡片
8. Skill 导入与挂载
9. electron-builder 打包 Windows EXE（NSIS 安装包 + portable）

### 二期

- 自动推公众号草稿、Markdown/长图/PDF 导出
- 封面模板库、选题库看板视图、抠图交互精修
- 向导式新手流程（选题→大纲→成文→配图→标题封面 一路下一步）
- Skill 市场/在线导入

---

## 12. 错误处理与边界

| 场景 | 策略 |
|---|---|
| 模型 API 失败/超时 | 副驾驶面板内联报错 + 一键重试；流式中断保留已生成部分 |
| 外部改文件 vs 编辑器未保存 | diff 对比弹窗：保留本地/接受外部/手动合并 |
| figures 渲染失败 | 保留旧 PNG，报错定位到源 HTML 行 |
| 抠图效果差 | 提供三算法切换 + 阈值滑杆，实时预览 |
| 富文本粘贴公众号后图片丢失 | 图片 dataURL 内嵌兜底；单图 >10MB 警告 |
| MCP 并发写冲突 | 工程级写锁，后到操作排队 |

## 13. 验收标准（MVP Done 的定义）

1. 双击 EXE 可用；断网状态下除 AI 调用外所有功能正常
2. 填入 Agnes AI Key 后：S1–S7 场景全链路可在 30 分钟内产出一篇带 3 张配图、封面、标题的可发布图文
3. Codex/Qoder 通过一键接入配置后，能用对话完成：建项目→生成文章→改一张代码绘图→导出 HTML（S8）
4. 直接修改 article.md / figures/*.html，编辑器 3 秒内热载生效
5. 导出的富文本粘贴进公众号后台：排版不丢、图注完好、图片正常转存 CDN

## 14. 风险与开放问题

- **公众号粘贴兼容性**：不同浏览器剪贴板 text/html 行为有差异，需实测微调导出模板（验收项 5 兜底）
- **md ↔ 富文本双向同步**是编辑器最大技术难点，MVP 允许约束子集（标题/段落/加粗/引用/图片+图注/分隔线），不支持任意嵌套富文本
- **PDF 素材抽取**质量不稳，MVP 仅做纯文本抽取，不做版面还原
- Agnes AI 图像接口的具体出入参需在实现前用真实 Key 联调确认
