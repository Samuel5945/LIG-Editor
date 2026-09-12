# 发版流程（Release Runbook）

> 适用 v0.6.1 起。应用内更新提醒机制的完整发版步骤、更新源规则与官网接入件都在这篇。

## 应用内更新提醒机制

- **双更新源**：官网 `https://ligdesign.win/lig-editor-update.json`（主，国内可达）+ GitHub Releases API（兜底），并行请求，取两源中版本更高的「已就绪」者。
- **就绪规则**（对齐"传完网盘才提示"）：
  - 官网源：JSON 里的 `version` 高于当前版本即就绪——所以 update.json 一定是发版最后一步；
  - GitHub 源：release **正文必须贴夸克或百度网盘链接**才判定为"发布完成"，只发 Release 不传网盘不会触发提醒。
- **检查时机**：启动后 8 秒静默查一次（失败/已是最新都不打扰）；顶栏「🔄 版本更新」手动检查必有反馈（弹窗 / 已是最新 toast / 失败 toast）。
- **下载入口兜底**：弹窗永远有 夸克 / 百度 / GitHub / 官网 四个按钮——内置了稳定分享链接兜底（`app/src/main/updateChecker.ts` 的 `FALLBACK_DOWNLOADS`），源里给了同名字段则覆盖内置值。
- **忽略此版本**：记录在 `settings/update.json`，之后启动静默检查不再弹该版本；手动检查仍会展示。
- **dev 模拟**：`LIG_UPDATE_FAKE_VERSION=0.6.1 npm run dev` 可假装远端出了 0.6.1，验证弹窗与忽略逻辑（仅未打包时生效）。

## 发版五步（顺序即依赖）

1. **bump 版本**：改 `app/package.json` 的 `version`（应用内当前版本号即来自这里）。
2. **构建**：`cd app && npm run dist`，产物在 `releases/`（`LIG-Editor-setup-<版本>.exe` + portable）。
3. **上传网盘**：夸克 + 百度网盘（分享链接若变动，记下新链接）。
4. **发 GitHub Release**：tag `v<版本>`，正文写更新说明，**正文必须贴夸克/百度网盘链接**（裸链或 markdown 链接均可）。
5. **更新官网 update.json**：把 `docs/site/lig-editor-update.json` 内容改成真实版本后上传到 `https://ligdesign.win/lig-editor-update.json`——**这一步完成，应用内提醒才正式上线**。

## update.json 格式

```json
{
  "version": "0.6.1",
  "releaseDate": "2026-09-12",
  "notes": ["一行一个更新点，渲染时保留换行"],
  "downloads": {
    "quark": "https://pan.quark.cn/s/1cb400aa407b",
    "baidu": "https://pan.baidu.com/s/1Y1tbciVySYOEd2gcwivqrw?pwd=35c8",
    "github": "https://github.com/Samuel5945/LIG-Editor/releases/latest",
    "site": "https://ligdesign.win/lig-editor.html"
  }
}
```

- `version` 必填，`x.y.z`（带 `v` 前缀也能解析）；其余字段可省略，省略的下载入口落到应用内置兜底链接。
- `notes` 可以是字符串数组（推荐，一行一条）或一段纯文本。
- 站点是 Cloudflare 静态托管：**未上传该文件时路径会 200 返回首页 HTML**，应用已做防御（正文不像 JSON 即视为"清单未部署"），但别因此忘了上传。

## 官网详情页版本徽标（lig-editor.html）

在「最新版本下载」按钮旁边放以下元素 + 脚本，页面就会自动显示「最新版 vX.Y.Z」，发版只需改 update.json，页面不用动：

```html
<span id="lig-latest-ver" hidden
  style="margin-left:8px;padding:2px 10px;border:1px solid currentColor;border-radius:999px;font-size:12px;opacity:.85;vertical-align:middle">
  最新版 v<span id="lig-latest-ver-num"></span>
</span>
<script>
  fetch('lig-editor-update.json?t=' + Date.now())
    .then(function (r) {
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw 0
      return r.json()
    })
    .then(function (j) {
      if (j && /^\d+\.\d+/.test(j.version || '')) {
        document.getElementById('lig-latest-ver-num').textContent = j.version
        document.getElementById('lig-latest-ver').hidden = false
      }
    })
    .catch(function () {})
</script>
```

同样对软 404 做了防御（content-type 不是 JSON 就保持隐藏）；样式可按官网 tokens 自行调整。
