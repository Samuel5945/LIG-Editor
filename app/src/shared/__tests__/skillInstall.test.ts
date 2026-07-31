import { describe, it, expect } from 'vitest'
import {
  parseSkillDirective,
  extractInlineContent,
  githubCandidates,
  withMirrors,
  nameFromRef,
  detectScriptDep
} from '../skillInstall'

describe('parseSkillDirective', () => {
  it('无指令块时原样返回', () => {
    const r = parseSkillDirective('普通回复文本')
    expect(r.cleaned).toBe('普通回复文本')
    expect(r.directive).toBeNull()
  })

  it('解析 github 指令并剥离指令块', () => {
    const text = '这是一个日报技能。\n```skill-install\n{"source":"github","ref":"owner/repo"}\n```'
    const r = parseSkillDirective(text)
    expect(r.cleaned).toBe('这是一个日报技能。')
    expect(r.directive).toEqual({ source: 'github', ref: 'owner/repo', name: undefined })
  })

  it('解析 inline 指令带 name', () => {
    const r = parseSkillDirective('```skill-install\n{"source":"inline","name":"my-skill"}\n```')
    expect(r.directive).toEqual({ source: 'inline', ref: undefined, name: 'my-skill' })
  })

  it('非法 source 只剥离不产出指令', () => {
    const r = parseSkillDirective('嗯\n```skill-install\n{"source":"ftp","ref":"x"}\n```')
    expect(r.cleaned).toBe('嗯')
    expect(r.directive).toBeNull()
  })

  it('JSON 损坏时不抛错', () => {
    const r = parseSkillDirective('```skill-install\n{source:github}\n```')
    expect(r.directive).toBeNull()
  })
})

describe('extractInlineContent', () => {
  it('无围栏时取全文', () => {
    expect(extractInlineContent('  # 内容  ')).toBe('# 内容')
  })

  it('取最大的围栏代码块', () => {
    const text = '装这个：\n```\n短\n```\n```markdown\n# 长内容\n很多行\n```'
    expect(extractInlineContent(text)).toBe('# 长内容\n很多行')
  })
})

describe('githubCandidates', () => {
  it('owner/repo 生成三分支×多路径候选，含 skills 子目录布局', () => {
    const r = githubCandidates('mvanhorn/last30days-skill')
    expect(r).toHaveLength(9)
    expect(r[0]).toBe('https://raw.githubusercontent.com/mvanhorn/last30days-skill/HEAD/SKILL.md')
    expect(r).toContain(
      'https://raw.githubusercontent.com/mvanhorn/last30days-skill/main/skills/last30days/SKILL.md'
    )
    expect(r).toContain(
      'https://raw.githubusercontent.com/mvanhorn/last30days-skill/master/skills/last30days-skill/SKILL.md'
    )
  })

  it('仓库名无 -skill 后缀时不重复生成子目录候选', () => {
    expect(githubCandidates('a/b')).toHaveLength(6)
  })

  it('仓库链接去 .git 后同样生成候选', () => {
    const r = githubCandidates('https://github.com/a/b.git')
    expect(r[0]).toBe('https://raw.githubusercontent.com/a/b/HEAD/SKILL.md')
  })

  it('blob 链接转 raw 直链', () => {
    expect(githubCandidates('https://github.com/a/b/blob/main/SKILL.md')).toEqual([
      'https://raw.githubusercontent.com/a/b/main/SKILL.md'
    ])
  })

  it('raw 直链原样返回', () => {
    const url = 'https://raw.githubusercontent.com/a/b/main/SKILL.md'
    expect(githubCandidates(url)).toEqual([url])
  })

  it('识别不了返回空数组', () => {
    expect(githubCandidates('https://example.com/x')).toEqual([])
  })
})

describe('withMirrors', () => {
  it('github 域名追加镜像变体', () => {
    const r = withMirrors('https://raw.githubusercontent.com/a/b/main/SKILL.md')
    expect(r).toHaveLength(3)
    expect(r[1]).toMatch(/^https:\/\/ghproxy\.net\/https:\/\//)
  })

  it('非 github 域名不加镜像', () => {
    expect(withMirrors('https://example.com/s.md')).toEqual(['https://example.com/s.md'])
  })
})

describe('nameFromRef', () => {
  it('仓库引用取仓库名', () => {
    expect(nameFromRef('mvanhorn/last30days-skill')).toBe('last30days-skill')
  })

  it('SKILL.md 直链取上级目录名', () => {
    expect(nameFromRef('https://raw.githubusercontent.com/a/my-skill/main/SKILL.md')).toBe('main')
  })

  it('普通 md 链接去扩展名', () => {
    expect(nameFromRef('https://example.com/tools/daily-report.md?raw=1')).toBe('daily-report')
  })

  it('去掉 .git 与尾部斜杠', () => {
    expect(nameFromRef('https://github.com/a/b.git/')).toBe('b')
  })
})

describe('detectScriptDep', () => {
  it('纯提示词型返回 null', () => {
    expect(detectScriptDep('# 写作风格\n用短句，多用动词，避免形容词堆砌。')).toBeNull()
  })

  it('命中 scripts/ 捆绑脚本引用', () => {
    const r = detectScriptDep('运行 `scripts/last30days.py --preflight` 检查环境')
    expect(r).toContain('scripts/last30days.py')
  })

  it('命中 python 执行命令', () => {
    const r = detectScriptDep('先执行 python3 engine/run.py 启动引擎')
    expect(r).toContain('python3 engine/run.py')
  })

  it('命中 shell 脚本执行', () => {
    expect(detectScriptDep('然后 bash setup.sh 完成初始化')).not.toBeNull()
  })

  it('普通英文单词 sh/python 不误报', () => {
    expect(detectScriptDep('Use a python-like pseudocode style in your answers.')).toBeNull()
  })
})
