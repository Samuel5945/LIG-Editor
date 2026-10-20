# 待修：readMeta 漏四个图片排版字段（会静默丢数据）

- 状态：待修（2026-10-20 由公众号排版任务中发现）
- 影响版本：0.9.0
- 严重度：**高**（数据静默丢失，且导出侧四项功能全部失效）
- 触发场景：任何一次「改任意排版字段」或「改标题 / 封面 / Skill」的保存动作

## 一、症状

在工程里设「图片形态 = 通栏」，导出仍然是 `max-width:100%; max-height:420px`（inset）。
更隐蔽的是：设好通栏之后，只要再去改一下字号，或者改个标题，图片形态就悄悄回到默认——界面不会报错，也不会有提示。

同组另外三项（图片边框、图片外间距、图注排列）同样是「设了没用、下次保存还被清掉」。

## 二、根因（两处，必须一起改）

### 1. `src/main/projectStore.ts` · `readMeta()` 白名单漏字段

第 388 行那段注释原本就在警告这件事：

> B 期排版视觉覆盖 20 字段：白名单缺字段会在 readMeta→writeMeta 往返时被清空，必须全量透传

`THEME_OVERRIDE_KEYS`（`src/shared/categoryThemes.ts:587`）已经是 40 个键，其中包含：

- `imgStyle`（第 607 行）
- `imgFrame`
- `imgGap`
- `captionAlign`

但 `readMeta()` 的显式白名单里只有 `imgRadius`、`bodyRadius`、`bodyPadding`，**上面这四个一个都没登记**。

于是：

1. `set_theme` / 排版控件把 `imgStyle` 写进 project.json —— 成功。
2. 下次任何调用 `readMeta()` 的动作读到它时被丢弃。
3. 紧接着的 `writeMeta(name, {...meta})` 把不带这四个字段的对象整体写回盘上 —— **盘上原值被删除**。

### 2. `src/main/__tests__/projectMetaVisualPassthrough.test.ts` · 测试种子也漏了同样的键

测试遍历 `THEME_OVERRIDE_KEYS`（40 个）逐个断言「读出来不丢」，但种子表 `ALL_OVERRIDES` 里没有这四个键：

```ts
for (const k of THEME_OVERRIDE_KEYS) expect(m[k], `字段 ${k} 未在 readMeta 白名单里`).toBe(ALL_OVERRIDES[k])
```

种子没有该键 → 两边都是 `undefined` → 断言通过。**测试对漏掉的字段天然免疫，所以永远是绿的。**
（顺带：`pageBg`、`h1Bg` 也在白名单里而不在种子里，同样处于未覆盖状态，但不影响功能。）

## 三、影响面

| 位置 | 表现 |
| --- | --- |
| 编辑器画布预览 | **正常**（走 `ArticleEditor` 的 `--thm-img-*` 变量，直接读 theme） |
| 导出 article.html / 复制富文本 / 推送草稿 | 图片形态、边框、外间距、图注排列四项全部回落默认 |
| 任意一次保存（改字号 / 改标题 / 改封面 / 换 Skill） | 盘上这四个字段被清空 |
| MCP `set_theme` | 写入成功但下次读取即丢失，表现为「设置无效」 |

这是典型的「预览与导出不同源」，用户很难自己归因。

## 四、复现步骤

1. 打开任一工程，点「全量排版」，图片形态选「通栏」，保存。
2. `project.json` 里能看到 `"imgStyle": "fullwidth"`。
3. 导出 article.html → 图片样式仍是 `max-width:100%;max-height:420px`。
4. 回编辑器，把正文字号 16 改成 17，保存。
5. 再打开 `project.json` → `imgStyle` 已经不见了。

## 五、修复方案

### 改动 1：`src/main/projectStore.ts` · `readMeta()`

在 `imgRadius: raw.imgRadius,` 后面补四行（与 `THEME_OVERRIDE_KEYS` 顺序保持一致）：

```ts
    imgRadius: raw.imgRadius,
    imgStyle: raw.imgStyle,
    imgFrame: raw.imgFrame,
    imgGap: raw.imgGap,
    captionAlign: raw.captionAlign,
```

### 改动 2：测试种子补齐

`projectMetaVisualPassthrough.test.ts` 的 `ALL_OVERRIDES` 里补四项（值取合法且与其它键不重复的），顺手补上 `pageBg`、`h1Bg`：

```ts
  imgRadius: 0,
  imgStyle: 'fullwidth',
  imgFrame: 'shadow',
  imgGap: 18,
  captionAlign: 'left',
```

`THEME_OVERRIDE_KEYS` 长度断言（40）不用动——这四个键本来就在表里，是白名单和种子漏了。

### 不做的事

- 不要改 `THEME_OVERRIDE_KEYS`：它是对的，是唯一的真源。
- 不要用「把 readMeta 改成直接透传整份 JSON」来绕过：那会把 `name`/`status` 之外的历史脏字段一起带下去，白名单的意义就是防止这个。

## 六、验证

1. `npm test`（`projectMetaVisualPassthrough` 四条全绿，且**改前先确认改完种子的测试会红一次**——否则说明没测到）。
2. 手动：设置通栏 → 改字号 → 回看 `project.json`，`imgStyle` 仍在。
3. 手动：导出 article.html，确认图片是 `display:block;width:100%` 而不是 `max-height:420px`。
4. 已有工程：这四个字段在盘上大概率已经被清空，修完之后需要重新设一次。

## 七、顺带发现

修好之后，本次那篇文章的插图就可以不再受 `max-height:420px` 限制，不必为了「手机上显示得大」而把图压成近方形。
相关背景见该文章工程的 `review.md` 第五、六节。

## 待办

- [ ] `readMeta()` 补 `imgStyle` / `imgFrame` / `imgGap` / `captionAlign`
- [ ] 测试种子补上述四项 + `pageBg` / `h1Bg`
- [ ] 确认改完种子后测试先红后绿
- [ ] 重新构建（`npm run build`），验证 MCP `set_theme imgStyle=fullwidth` 在导出里生效
- [ ] 发布 0.9.1 时在 release notes 里提一句：图片四项排版覆盖此前不生效
