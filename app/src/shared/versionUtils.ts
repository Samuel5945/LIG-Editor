/** 版本号比较与网盘链接解析的纯函数（updateChecker 用；独立成模块便于单测） */

/** 比较两个 x.y.z 版本：a>b 返回 1，a<b 返回 -1，相等 0；兼容 v 前缀与非数字段（按 0 处理） */
export function compareVersions(a: string, b: string): number {
  const seg = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((s) => parseInt(s, 10) || 0)
  const pa = seg(a)
  const pb = seg(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** 从 release 正文等文本里抠出第一个匹配域名的 https 直链：markdown 链接/裸链均可，截到空白或闭合括号前 */
export function extractUrl(text: string, domain: RegExp): string | undefined {
  const m = new RegExp(`https?://${domain.source}[^\\s)\\]<>"]+`).exec(text)
  return m ? m[0].replace(/[).,，。;；！!]+$/, '') : undefined
}
