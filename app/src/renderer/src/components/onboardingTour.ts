/**
 * 新手引导（driver.js 分步高亮 Tour）
 * - 主 Tour：三栏工作台 + 顶栏入口共 6 步，首启自动弹出，顶栏「帮助」可随时重看
 * - 子引导：主 Tour 结束页可一键进入「模型接入」「MCP 接入」弹窗内的专项高亮
 * - 已读标记存 localStorage（纯 UI 状态，与 ui-theme 同例），Esc 中途退出也记为已读
 */
import { driver, type DriveStep, type Driver, type PopoverDOM } from 'driver.js'
import 'driver.js/dist/driver.css'

const DONE_KEY = 'lig-onboarding-done'

export function shouldAutoStart(): boolean {
  return localStorage.getItem(DONE_KEY) !== '1'
}

export function markTourDone(): void {
  localStorage.setItem(DONE_KEY, '1')
}

/** 主 Tour 结束页入口按钮需要的回调（App 打开对应弹窗） */
export interface TourHandlers {
  openSettings: () => void
  openIntegration: () => void
}

/** 防重入：主/子 Tour 共用，任一引导活动期间忽略新的启动请求 */
let tourActive = false
/** 当前主 Tour 的回调（onPopoverRender 注入按钮时闭包引用） */
let handlers: TourHandlers | null = null

const COMMON_CONFIG = {
  popoverClass: 'lig-tour-popover',
  showProgress: true,
  progressText: '{{current}} / {{total}}',
  allowClose: true
}

/** 主 Tour：全部指向常驻结构元素，不依赖工程是否打开 */
const MAIN_STEPS: DriveStep[] = [
  {
    popover: {
      title: '👋 欢迎使用立格编辑器',
      description:
        '本地优先的公众号图文创作工作台：脑暴选题 → AI 初稿 → 逐段修改 → 审阅 → 配图封面 → 排版导出，数据全部保存在本机。用 1 分钟认识一下界面。',
      showButtons: ['next'],
      nextBtnText: '开始认识 →'
    }
  },
  {
    element: '[data-tour="left-pane"]',
    popover: {
      title: '左栏 · 项目与选题库',
      description:
        '「项目」管理文章工程，顶部标签按分类筛选，⚙️ 可隐藏 / 重命名分类；「选题库」存放灵感卡片，可一键转成大纲开工。',
      side: 'right',
      align: 'start'
    }
  },
  {
    element: '[data-tour="center-toolbar"]',
    popover: {
      title: '中栏 · 编辑与排版',
      description:
        '「正文」页签实时预览公众号效果：✦ 排版优化让 AI 全文调整，🎨 排版可导入别人文章的样式，📤 导出复制进公众号后台，🖼 转贴图生成小红书竖版卡片。编辑器顶栏「版式」面板还能自选标题样式、H2 序号（含 ① 圈号）与文章背景色。',
      side: 'bottom',
      align: 'start'
    }
  },
  {
    element: '[data-tour="right-tabs"]',
    popover: {
      title: '右栏 · AI 副驾驶',
      description:
        '「对话」随问随改，可圈选文字直接下指令；「脑暴创作」从选题一路走到初稿；「审阅」出 AI 审稿意见并按报告修订。下拉可挂载写作风格 Skill。',
      side: 'left',
      align: 'end'
    }
  },
  {
    element: '[data-tour="topbar-actions"]',
    popover: {
      title: '顶栏 · 系统入口',
      description:
        '模型接入：管理 LLM 供应商与默认模型（开箱已预置基元律动 + Agnes AI）；设置：MCP 接入、Skill 管理、公众号推送凭据；另有日间 / 深色切换、版本更新与官网。',
      side: 'bottom',
      align: 'end'
    }
  },
  {
    popover: {
      title: '🎉 认识完毕',
      description: '去左栏新建第一个工程吧！首次使用建议先确认模型可用：',
      showButtons: ['next'],
      doneBtnText: '完成',
      onPopoverRender: (popover: PopoverDOM) => injectEntryButtons(popover)
    }
  }
]

/** 结束页注入「配置模型 / 了解 MCP」入口按钮（插在 footer 按钮组上方） */
function injectEntryButtons(popover: PopoverDOM): void {
  const bar = document.createElement('div')
  bar.className = 'lig-tour-entry'
  bar.innerHTML = `
    <button type="button" class="lig-tour-btn" data-tour-entry="settings">① 配置模型</button>
    <button type="button" class="lig-tour-btn lig-tour-btn--ghost" data-tour-entry="mcp">② 了解 MCP 接入</button>
  `
  popover.footer.insertBefore(bar, popover.footer.firstChild)

  bar.querySelector('[data-tour-entry="settings"]')?.addEventListener('click', () => {
    endMainTour()
    handlers?.openSettings()
    startSubTour('settings')
  })
  bar.querySelector('[data-tour-entry="mcp"]')?.addEventListener('click', () => {
    endMainTour()
    handlers?.openIntegration()
    startSubTour('mcp')
  })
}

let mainDriver: Driver | null = null

/** 主 Tour 收尾：destroy（触发 onDestroyed 记已读）并复位防重入 */
function endMainTour(): void {
  mainDriver?.destroy()
  mainDriver = null
}

function handleDestroyed(): void {
  tourActive = false
  markTourDone()
}

/** 轮询等待元素出现（弹窗内容多为异步加载），超时放弃不阻塞用户 */
function waitForElement(selector: string, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (document.querySelector(selector)) return resolve(true)
      if (Date.now() - started > timeout) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}

/** 弹窗内专项引导：独立小 driver，不写已读标记 */
function startSubTour(kind: 'settings' | 'mcp'): void {
  const step: DriveStep =
    kind === 'settings'
      ? {
          element: '[data-tour="provider-list"]',
          popover: {
            title: '第一步：确认模型可用',
            description:
              '开箱已预置「基元律动 + Agnes AI」。选中供应商填入你的 API Key，点「测试连接」确认可用；再切到「默认模型」页签指定默认文本 / 生图模型。配好后右栏 AI 副驾驶就能开工了。',
            side: 'right',
            align: 'start'
          }
        }
      : {
          element: '[data-tour="mcp-card"]',
          popover: {
            title: '让外部 Agent 操控编辑器',
            description:
              '复制下方片段填进 Codex（~/.codex/config.toml）或 Qoder / Claude 的 mcp.json，外部 Agent 即可通过对话完成建项目 → 生成正文 → 改图 → 导出全流程。本页还管理写作 Skill 与公众号推送凭据。',
            side: 'left',
            align: 'start'
          }
        }

  void waitForElement(step.element as string).then((found) => {
    if (!found || tourActive) return
    tourActive = true
    const sub = driver({
      ...COMMON_CONFIG,
      showButtons: ['next'],
      nextBtnText: '知道了',
      doneBtnText: '完成',
      onDestroyed: () => {
        tourActive = false
      },
      steps: [step]
    })
    sub.drive()
  })
}

/** 启动主 Tour（顶栏「帮助」按钮 / 首启自动弹出共用入口） */
export function startTour(opts: TourHandlers): void {
  if (tourActive) return
  tourActive = true
  handlers = opts
  mainDriver = driver({
    ...COMMON_CONFIG,
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    onDestroyed: handleDestroyed,
    steps: MAIN_STEPS
  })
  mainDriver.drive()
}
