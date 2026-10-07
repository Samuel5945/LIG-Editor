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
4. **发 GitHub Release**：tag **必须带 `v` 前缀**（`v<版本>`，与 `v0.3.0`…`v0.8.0` 一致），正文写更新说明，**正文必须贴夸克/百度网盘链接**（裸链或 markdown 链接均可）。正文顶部若要像 0.8.0 那样放界面轮播图，先把 GIF 放进官网 `assets/img/lig-editor-<版本>-tour.gif` 并 push 上线，再回填链接。

   **走脚本，别手敲**（`app/scripts/ship-release.mjs` 把下面所有约束变成预检，不通过就不碰远端）：

   ```bash
   node app/scripts/ship-release.mjs <版本> --dry-run   # 先演一遍，看预检与将要执行的命令
   node app/scripts/ship-release.mjs <版本>             # 建 tag + 发 release + 传附件，一条命令完成
   node app/scripts/ship-release.mjs --verify <版本>    # 事后单独核对附件摘要
   ```

   脚本入参是 `x.y.z`（不带 `v`），它会自己补成 `v<版本>`；预检覆盖：`app/package.json` 已 bump、
   两个 exe 都在且体积像真产物、正文含网盘链接、本地 HEAD 已进远端 master、该 tag 没有 release。
   发完自动用 API 的 `assets[].digest` 对本地 `sha256sum`，名称/字节数/摘要三项全等才算过。

   手工等价命令（脚本不可用时的同一件事，**两个 exe 必须跟在 `--notes-file` 后面一起给**，没有第二步）：

   ```bash
   gh release create v<版本> --verify-tag --title "立格编辑器 <版本>" \
     --notes-file releases/RELEASE_BODY-<版本>.md \
     releases/LIG-Editor-setup-<版本>.exe releases/LIG-Editor-portable-<版本>.exe
   ```

   > ⛔ **踩过的坑（v0.9.0 又踩了一次，代价是一个永久作废的 tag 名）**：Release 一经发布就是
   > `immutable`（GitHub 默认行为，0.8.0 的 API 返回里同样是 `immutable:true`），事后再
   > `gh release upload` 会 `422 Cannot upload assets to an immutable release`；而一旦为了补传把这条
   > release 删掉，**它的 tag 名就永久占用了**，再建会 `422 tag_name was used by an immutable release`。
   > 所以「先建 release 再传附件」这条路根本不存在，必须一条命令带齐。
   >
   > 传完当场核对，别只看命令 exit 0：
   > `gh api repos/Samuel5945/LIG-Editor/releases/tags/v<版本> --jq '.assets[]|"\(.name) \(.size) \(.digest)"'`
   > 对本地 `sha256sum releases/LIG-Editor-*-<版本>.exe`，名称/字节数/摘要三项全等才算发出去。
   >
   > ⚠️ 创建 Release 前**必须先把本地提交推上远端**（`git push origin master`）——tag 会打在远端
   > master 的当前顶端，先建后推就会指向旧提交（v0.7.0 就吃过这个亏）。tag 本身可删可重打
   > （`git push origin :refs/tags/<tag>` 实测有效，v0.9.0 那次删裸 `0.9.0` 就成功了），
   > 但**删掉带过 release 的 tag 只留下墓碑**：名字不能再用，只能换个写法。
5. **更新官网**：官网源在本地 `C:\Users\PC\Documents\Qoder\2026-08-28\1b3e82f9\lig-site`（GitHub `Samuel5945/lig-site`，分支 `main`）。把 `docs/site/lig-editor-update.json` 的内容同步过去（版本/日期/notes），文案改动要**三处一起改**：`assets/i18n.js` 的 `zh` 与 `en` 两套，加上页面里的中文兜底文字；改词典必须把六个顶层页的 `assets/i18n.js?v=` 一起递增。本地先跑 `node tools/publish.mjs`（组 staging + 断链自检，不部署），再 **push main**：线上 ligdesign.win 由 Cloudflare Pages 的 **git 构建**喂（项目 `ligdesign`，Build command `node tools/publish.mjs --out dist`），**不要再走 `wrangler pages deploy` 直传**——直传改不动域名，还会把 `tools/`、`covers/` 暴露出去。这一步里 update.json 完成，应用内「发现新版本」提醒才正式上线，所以它必须排在 Release 之后。

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
