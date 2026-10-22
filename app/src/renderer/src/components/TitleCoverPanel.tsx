import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { Icon } from '../ui/Icon'
import { Button, Card, CardTitle, Segmented, Switch } from '../ui/primitives'
import type { ArticleTheme } from '@shared/categoryThemes'
import type { ProjectMeta, TitleCandidate } from '@shared/types'
import { cardsPlainText, hexToRgba } from '@shared/cards'
import { COVER_SQUARE, COVER_TEMPLATES, COVER_WIDE, NO_BG_TEMPLATES } from '@shared/coverTemplates'
import { shouldSubmitOnEnter } from '@shared/imeEnter'
import { extractTitle } from '@shared/exportHtml'
import { UNCATEGORIZED } from '@shared/categories'
import { mdToDoc } from '@shared/markdown'
import { chatOnce, extractJsonArray, stripHtmlFence } from '../copilot/llm'
import {
  coverHtmlBriefMessages,
  coverHtmlMessages,
  coverImageTextRule,
  coverPhotoMessages,
  coverPromptMessages,
  titleMessages
} from '../copilot/prompts'

interface TitleCoverPanelProps {
  project: string
  meta: ProjectMeta
  /** 当前正文（AI 起标题用） */
  article: string
  skill: string | null
  /** 工程目录绝对路径（封面预览走 asset:// 协议，与贴图面板同法） */
  projectDir?: string
  /** 排版调性：模板封面取它的强调色，与文章观感同源 */
  theme?: ArticleTheme
  /** 封面写盘 / meta 变化后通知 App 重新拉 meta */
  onMetaUpdated: () => void
  /** 把选中的标题候选写回正文首行 H1（草稿标题取自正文 H1） */
  onApplyTitle: (title: string) => void
  onToast: (msg: string) => void
}

// 导出尺寸：公众号头图 2.35:1 与朋友圈分享 1:1
const WIDE = { w: COVER_WIDE.w, h: COVER_WIDE.h, rel: 'assets/cover-235.png' }
const SQUARE = { w: COVER_SQUARE.w, h: COVER_SQUARE.h, rel: 'assets/cover-11.png' }
/** 底图导出长边上限：够 1175 宽的封面用，又不把工程撑大 */
const BG_MAX_EDGE = 1920

/**
 * 标题/封面 tab：AI 起标题 + 标题候选（打分排序+应用/复制）
 * + 封面两条产出路径——① 选版式模板直接渲染（标题/副标题/可选底图 → 双比例成品）
 * ② AI 生图或导入图片后拖动裁剪。两条路出口相同（assets/cover-235.png 与 cover-11.png）
 */
export default function TitleCoverPanel({
  project,
  meta,
  article,
  skill,
  projectDir,
  theme,
  onMetaUpdated,
  onApplyTitle,
  onToast
}: TitleCoverPanelProps): ReactElement {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [wideOffset, setWideOffset] = useState(0.5)
  const [squareOffset, setSquareOffset] = useState(0.5)
  const [saving, setSaving] = useState(false)
  const [titling, setTitling] = useState(false)
  const [genning, setGenning] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const wideRef = useRef<HTMLCanvasElement>(null)
  const squareRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bgFileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  // ---- 封面提示词：从正文提取关键信息（流式进输入框），也可手动输入/编辑 ----
  // 模板那条路的「插画」提示词（要求给左侧文字让位）与纯图那条路的「成图」提示词必须分开，
  // 共用一份就会互相污染：给纯图封面写留白，画面左边就是废片
  const [coverPrompt, setCoverPrompt] = useState('')
  const [photoPrompt, setPhotoPrompt] = useState('')
  const [useReference, setUseReference] = useState(false)
  /** 方图取景：纯图那条路的裁剪位置三档（拖动滑杆会转成自定义） */
  const [squarePick, setSquarePick] = useState<'left' | 'center' | 'right' | 'custom'>('center')
  const [prompting, setPrompting] = useState(false)
  const promptAbortRef = useRef<(() => void) | null>(null)
  // ---- 裁剪位置：预览上直接拖动（内容跟手） ----
  const dragRef = useRef<{ key: 'wide' | 'square'; x: number; y: number; start: number; axis: 'x' | 'y'; per: number } | null>(null)
  // ---- 封面三条路：一张卡里分段切换（照正文配图弹窗的管线选择来做，不用来回翻卡）----
  const [coverMode, setCoverMode] = useState<'template' | 'photo' | 'html'>('template')
  // ---- 模板封面：选版式 → 填标题 → 一步直出（与拖动裁剪出口相同） ----
  const [template, setTemplate] = useState(() => meta.cover?.template ?? COVER_TEMPLATES[0].id)
  const [coverTitle, setCoverTitle] = useState('')
  const [coverSubtitle, setCoverSubtitle] = useState('')
  /** 底图从哪来：不用 / AI 现场生（一次点击内完成生图+合成）/ 选工程里已有的图 */
  const [bgSource, setBgSource] = useState<'none' | 'ai' | 'file'>('none')
  const [bgFile, setBgFile] = useState('')
  const [projectImages, setProjectImages] = useState<string[]>([])
  const [projectCovers, setProjectCovers] = useState<string[]>([])
  const [coverError, setCoverError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  // ---- 封面口径三件套：磨砂面板 / 装饰元素 / 方图取景（模板直出与自定义 HTML 共用一套）----
  const [panel, setPanel] = useState<'frosted' | 'none'>('none')
  /** 手动动过面板开关后就不再跟版式联动（杂志大字有底图时自带磨砂，这是模板语言，不是"自动判断"） */
  const [panelTouched, setPanelTouched] = useState(false)
  const [decor, setDecor] = useState(true)
  const [focalPick, setFocalPick] = useState<'auto' | 'right' | 'center' | 'left'>('auto')
  // ---- HTML 直渲：只截图，不重生成作者/AI 写的源文件 ----
  const [customHtml, setCustomHtml] = useState('')
  const [customW, setCustomW] = useState<number>(COVER_WIDE.w)
  const [customH, setCustomH] = useState<number>(COVER_WIDE.h)
  /** 画布比例：预设两档，手改数字即转自定义（免得让人一上来填两个数） */
  const [canvasPreset, setCanvasPreset] = useState<'wide' | 'square' | 'custom'>('wide')
  /** HTML 直渲出的主图（方图预览在界面里就地裁，不再落一张 -11.png） */
  const [customImg, setCustomImg] = useState<HTMLImageElement | null>(null)
  const customSquareRef = useRef<HTMLCanvasElement>(null)
  const [customOut, setCustomOut] = useState<{ main: string; square?: string } | null>(null)
  const [customizing, setCustomizing] = useState(false)
  // AI 写 HTML：指令 + 上一版源码（改一版时带回给模型，不用重写全文）
  const [customDesc, setCustomDesc] = useState('')
  const [writing, setWriting] = useState(false)
  const customSrcRef = useRef<string | null>(null)
  const customAbortRef = useRef<(() => void) | null>(null)
  // 渲染完成后自增，给 asset:// 预览加参破缓存（同贴图面板）
  const [pv, setPv] = useState(0)

  // 封面标题缺省取最高分候选；没有候选就取正文 H1。用户填过之后不再自动覆盖
  useEffect(() => {
    if (coverTitle.trim()) return
    const top = [...(meta.titles ?? [])].sort((a, b) => b.score - a.score)[0]?.text
    const h1 = article.trim() ? extractTitle(mdToDoc(article), '') : ''
    const next = (top || h1).trim()
    if (next) setCoverTitle(next)
  }, [meta.titles, article, coverTitle])

  const assetUrl = useCallback(
    (rel: string): string =>
      projectDir
        ? 'asset://file/' + encodeURIComponent(`${projectDir}\\${rel.replace(/\//g, '\\')}`) + `?v=${pv}`
        : '',
    [projectDir, pv]
  )

  useEffect(() => () => promptAbortRef.current?.(), [])

  // 底图与封面 HTML 的候选：工程里现成的文件（打开面板与每次出图后刷新，Agent 刚生成的也要能选到）
  const refreshProjectFiles = useCallback(() => {
    window.api
      .invoke('project:listAssets', project)
      .then((a) => {
        // 封面成品不进底图候选（拿成品再套一层版式是套娃）；cover-bg*.png 是底图本身，要留着
        const isCoverOutput = (x: string): boolean =>
          /^assets\/cover-(235|11)\.png$/.test(x) || /^assets\/cover-custom.*\.png$/.test(x)
        // 刚生成的排最前：文件名里的毫秒时间戳就是顺序，当前底图 cover-bg.png 钉在第一
        const stamp = (x: string): number => Number(/(\d{10,})/.exec(x)?.[1] ?? 0)
        const rank = (x: string): number => (x === 'assets/cover-bg.png' ? Number.MAX_SAFE_INTEGER : stamp(x))
        setProjectImages(a.assets.filter((x) => !isCoverOutput(x)).sort((l, r) => rank(r) - rank(l)))
        setProjectCovers(a.covers)
      })
      .catch(() => {
        setProjectImages([])
        setProjectCovers([])
      })
  }, [project])

  useEffect(() => {
    refreshProjectFiles()
  }, [refreshProjectFiles, pv])

  // 版式自带的面板默认：杂志大字有底图时铺磨砂，其余不铺；用户手动改过就不再覆盖
  useEffect(() => {
    if (!panelTouched) setPanel(template === 'magazine' ? 'frosted' : 'none')
  }, [template, panelTouched])

  // 下拉缺省选第一个 covers/*.html：作者不用记文件名也能直接出图
  useEffect(() => {
    if (!customHtml && projectCovers.length) setCustomHtml(projectCovers[0])
  }, [projectCovers, customHtml])

  // ---- AI 起标题（独立一次性调用，不进对话） ----

  const runTitles = useCallback(async () => {
    if (titling) return
    // 贴图工程正文为空，回退用卡片文案作为起标题的依据
    let source = article
    if (!source.trim() && meta.format === 'cards') {
      const deck = await window.api.invoke('cards:read', project)
      if (deck?.cards.length) source = cardsPlainText(deck.cards)
    }
    if (!source.trim()) {
      onToast(meta.format === 'cards' ? '卡片为空，先加几张贴图再起标题' : '正文为空，先写点内容再起标题')
      return
    }
    setTitleError(null)
    setTitling(true)
    const { promise, abort } = chatOnce(titleMessages(source, skill))
    abortRef.current = abort
    try {
      const full = await promise
      const titles = extractJsonArray<TitleCandidate>(full)
      if (!titles) {
        setTitleError('标题解析失败，请重试')
        return
      }
      const fresh = await window.api.invoke('project:readMeta', project)
      fresh.titles = titles.filter((t) => t.text && typeof t.score === 'number')
      await window.api.invoke('project:writeMeta', project, fresh)
      onMetaUpdated()
      onToast(`已生成 ${fresh.titles.length} 个标题候选`)
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : String(err))
    } finally {
      setTitling(false)
      abortRef.current = null
    }
  }, [titling, article, skill, project, meta.format, onMetaUpdated, onToast])

  /** 底图进 assets/：不落盘的图「模板直出」那条路看不见，等于白生成/白导入一次 */
  const stashBg = useCallback(
    async (image: HTMLImageElement): Promise<string> => {
      const rel = await window.api.invoke('project:saveAsset', project, 'assets/cover-bg.png', renderFullPng(image))
      setBgFile(rel)
      refreshProjectFiles()
      return rel
    },
    [project, refreshProjectFiles]
  )

  /** 模板那条的底图导入：与纯图一样能拿本机图片，落地后进候选条并选中 */
  const importBg = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? '')
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
        if (!base64) return
        try {
          const rel = await window.api.invoke('project:saveAsset', project, 'assets/cover-bg.png', base64)
          setBgSource('file')
          setBgFile(rel)
          refreshProjectFiles()
        } catch (err) {
          setCoverError(err instanceof Error ? err.message : String(err))
        }
      }
      reader.readAsDataURL(file)
    },
    [project, refreshProjectFiles]
  )

  const pickImage = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        setImg(image)
        void stashBg(image).catch(() => undefined)
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        onToast('图片加载失败，换一张 PNG/JPG 试试')
      }
      image.src = url
    },
    [onToast, stashBg]
  )

  // ---- 封面提示词：LLM 通读正文提取关键信息，流式写进输入框供用户二次编辑 ----

  /** 提取用的正文：正文为空时贴图工程回退卡片文案（生图提示词与 HTML 设计指令共用这份取数逻辑） */
  const briefSource = useCallback(async (): Promise<string | null> => {
    let source = article
    if (!source.trim() && meta.format === 'cards') {
      const deck = await window.api.invoke('cards:read', project)
      if (deck?.cards.length) source = cardsPlainText(deck.cards)
    }
    if (!source.trim()) {
      onToast(meta.format === 'cards' ? '卡片为空，先加几张贴图再提取' : '正文为空，先写点内容再提取')
      return null
    }
    return source
  }, [article, meta.format, project, onToast])

  /** 底图那条路：出的是「画面里不要文字、主体偏右」的生图提示词 */
  const extractCoverPrompt = useCallback(async () => {
    if (prompting) return
    const source = await briefSource()
    if (!source) return
    setPrompting(true)
    const { promise, abort } = chatOnce(coverPromptMessages(source, skill), (full) => setCoverPrompt(full))
    promptAbortRef.current = abort
    try {
      const full = await promise
      setCoverPrompt(full.trim())
    } catch (err) {
      onToast(`封面提示词提取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPrompting(false)
      promptAbortRef.current = null
    }
  }, [prompting, briefSource, skill, onToast])

  /** 纯图成图那条路：出的是「完整封面画面」的提示词——主体可居中铺满，不为文字留白 */
  const extractPhotoPrompt = useCallback(async () => {
    if (prompting) return
    const source = await briefSource()
    if (!source) return
    setPrompting(true)
    const { promise, abort } = chatOnce(
      coverPhotoMessages(source, skill, theme?.accent),
      (full) => setPhotoPrompt(full)
    )
    promptAbortRef.current = abort
    try {
      const full = await promise
      setPhotoPrompt(full.trim())
    } catch (err) {
      onToast(`封面画面描述提取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPrompting(false)
      promptAbortRef.current = null
    }
  }, [prompting, briefSource, skill, theme?.accent, onToast])

  /** HTML 直渲那条路：出的是「标题文案 + 版式气质 + 画面元素 + 配色」的设计指令，直接喂给 AI 写 HTML */
  const extractHtmlBrief = useCallback(async () => {
    if (prompting) return
    const source = await briefSource()
    if (!source) return
    setPrompting(true)
    const { promise, abort } = chatOnce(coverHtmlBriefMessages(source, skill, theme?.accent), (full) => setCustomDesc(full))
    promptAbortRef.current = abort
    try {
      const full = await promise
      setCustomDesc(full.trim())
    } catch (err) {
      onToast(`设计指令提取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPrompting(false)
      promptAbortRef.current = null
    }
  }, [prompting, briefSource, skill, theme?.accent, onToast])

  // ---- 裁剪位置：预览画布上直接拖动（内容跟手），滑杆保留作微调 ----

  const startCropDrag = useCallback(
    (key: 'wide' | 'square', ratio: number) => (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!img) return
      // 手动拖过就不再声称是三档之一
      if (key === 'square') setSquarePick('custom')
      const m = dragFactor(e.currentTarget, img, ratio)
      if (!m) return
      dragRef.current = {
        key,
        x: e.clientX,
        y: e.clientY,
        start: key === 'wide' ? wideOffset : squareOffset,
        axis: m.axis,
        per: m.per
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [img, wideOffset, squareOffset]
  )

  const moveCropDrag = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const delta = d.axis === 'x' ? e.clientX - d.x : e.clientY - d.y
    const v = Math.min(1, Math.max(0, d.start - delta * d.per))
    if (d.key === 'wide') setWideOffset(v)
    else setSquareOffset(v)
  }, [])

  const endCropDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  // ---- 照片裁剪那条路：按描述出 21:9 横图作底图，生成即落 assets/（裁剪与「模板直出」共用这一张）----

  const genCover = useCallback(async () => {
    if (genning || prompting) return
    const prompt = photoPrompt.trim()
    if (!prompt) {
      onToast('先写一句画面描述，或点「从正文提取」')
      return
    }
    setGenning(true)
    setCoverError(null)
    try {
      // 2.35:1 + 长边 2432：商汤换算成 2432×1024（以前 '2.35:1' 解析不了，实际拿到 1024 方图再被裁一半）
      // 勾了「用当前图作参考」就走商汤 /images/edits：参考图以 data URI 传，原构图与风格保留
      // 标题逐字追加：让模型自己"安排标题"会改写文案或写错字，这里只把字钉死
      const fullPrompt = `${prompt}。${coverImageTextRule(coverTitle, coverSubtitle)}`
      const b64 = await window.api.invoke('image:generate', fullPrompt, {
        ratio: '2.35:1',
        longEdge: 2432,
        ...(useReference && img ? { reference: renderFullPng(img) } : {})
      })
      const image = new Image()
      image.onload = () => {
        setImg(image)
        // 这张图本身就是封面，1:1 只是派生：默认取主体侧，别把主体从中间切开
        // 字写进画面里时，方图默认取左才裁得到标题（提示词已要求字收在左 35%）；纯图则取主体侧。
        // 三档在下面都能改，这只是缺省。
        const hasText = !!coverTitle.trim()
        setSquarePick(hasText ? 'left' : 'right')
        setSquareOffset(hasText ? 0 : 1)
        onToast(useReference ? '已按参考图重画：方图默认取主体侧，可拖' : '封面图已生成：方图默认取主体侧，可拖')
        void stashBg(image).catch(() => undefined)
      }
      image.onerror = () => onToast('封面图片解码失败，请重试')
      image.src = `data:image/png;base64,${b64}`
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenning(false)
    }
  }, [genning, prompting, photoPrompt, coverTitle, coverSubtitle, useReference, img, onToast, stashBg])

  // 预览重绘
  useEffect(() => {
    if (img && wideRef.current) drawCrop(wideRef.current, img, WIDE.w / WIDE.h, wideOffset)
  }, [img, wideOffset])
  useEffect(() => {
    if (img && squareRef.current) drawCrop(squareRef.current, img, 1, squareOffset)
  }, [img, squareOffset])
  // HTML 直渲那条路的方图预览：同一套裁剪函数，只是源换成刚出图的主图
  useEffect(() => {
    if (customImg && customSquareRef.current) drawCrop(customSquareRef.current, customImg, 1, squareOffset)
  }, [customImg, squareOffset])

  const saveCovers = useCallback(async () => {
    if (!img || saving) return
    setSaving(true)
    try {
      await window.api.invoke('project:saveAsset', project, WIDE.rel, renderPng(img, WIDE.w, WIDE.h, wideOffset))
      await window.api.invoke('project:saveAsset', project, SQUARE.rel, renderPng(img, SQUARE.w, SQUARE.h, squareOffset))
      const fresh = await window.api.invoke('project:readMeta', project)
      fresh.cover = { main: WIDE.rel, square: SQUARE.rel }
      await window.api.invoke('project:writeMeta', project, fresh)
      onMetaUpdated()
      onToast('封面已保存到 assets/')
    } catch (err) {
      onToast(`封面保存失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }, [img, saving, project, wideOffset, squareOffset, onMetaUpdated, onToast])

  // ---- 模板封面：一次点击出成品（底图 = 不用 / AI 现场生 / 工程里已有的图，不再要求先去哪张卡生成）----

  /** 方图取景：auto 交给主进程按底图左右半区细节量判，手动三档给死值 */
  const focalValue = focalPick === 'auto' ? undefined : focalPick === 'left' ? 0 : focalPick === 'center' ? 0.5 : 1

  const renderTemplateCover = useCallback(async () => {
    if (rendering) return
    const title = coverTitle.trim()
    if (!title) {
      setCoverError('先填封面标题')
      return
    }
    const prompt = coverPrompt.trim()
    if (bgSource === 'ai' && !prompt) {
      setCoverError('选了「AI 生成底图」，写一句画面描述（或点「从正文提取」）')
      return
    }
    if (bgSource === 'file' && !bgFile) {
      setCoverError('选一张工程里已有的图作底图')
      return
    }
    setRendering(true)
    setCoverError(null)
    try {
      // 纯排印版式（杂志留白 / 大字版式）不吃底图，名单单源在 shared/coverTemplates
      const bgArgs =
        NO_BG_TEMPLATES.includes(template) || bgSource === 'none'
          ? {}
          : bgSource === 'ai'
            ? { prompt }
            : { bg: bgFile }
      const r = await window.api.invoke('cover:renderTemplate', {
        project,
        template,
        title,
        subtitle: coverSubtitle.trim() || undefined,
        accent: theme?.accent ?? '#0d9488',
        ...bgArgs,
        // 账号 = 分类：右下角标注账号名；「未分类」没有账号含义，不标
        brand: meta.category && meta.category !== UNCATEGORIZED ? meta.category : undefined,
        panel,
        decor,
        focal: focalValue
      })
      setPv((v) => v + 1)
      onMetaUpdated()
      onToast(`封面已生成：方图取自主图 ${Math.round(r.focal * 100)}% 处`)
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : String(err))
    } finally {
      setRendering(false)
    }
  }, [
    rendering,
    coverTitle,
    coverSubtitle,
    coverPrompt,
    bgSource,
    bgFile,
    project,
    template,
    theme,
    meta.category,
    panel,
    decor,
    focalValue,
    onMetaUpdated,
    onToast
  ])

  // ---- 路径三：covers/*.html 直接截图（不重生成，手改不会被覆盖）；HTML 可以作者手写，也可以让 AI 写 ----

  const renderCustomCover = useCallback(
    async (htmlArg?: string) => {
      if (customizing) return
      const html = (htmlArg ?? customHtml).trim()
      if (!html) {
        onToast('先选一份 covers/*.html（工程里还没有就先让 AI 写一版）')
        return
      }
      setCustomizing(true)
      setCoverError(null)
      try {
        const r = await window.api.invoke('cover:renderHtml', {
          project,
          html,
          // 固定产物名：HTML 才是源文件，每点一次出图就在 assets/ 堆一张时间戳图纯属脏
          out: 'assets/cover-custom.png',
          width: customW,
          height: customH,
          focal: focalValue
        })
        setCustomOut({ main: r.path })
        setPv((v) => v + 1)
        // 方图只在界面里裁着看：主图读进内存，滑杆一动就重画，不再落一张 -11.png
        const im = new Image()
        im.onload = () => setCustomImg(im)
        im.src = assetUrl(r.path)
        onToast('已按 HTML 出图；方图是这张主图的裁剪，只预览不落盘')
      } catch (err) {
        setCoverError(err instanceof Error ? err.message : String(err))
      } finally {
        setCustomizing(false)
      }
    },
    [customizing, customHtml, customW, customH, focalValue, project, onToast]
  )

  /** AI 写一版封面 HTML → 落 covers/cover-custom.html → 顺手渲出来；改一版时把上一版源码带回给模型 */
  const writeCustomHtml = useCallback(async () => {
    const desc = customDesc.trim()
    if (!desc || writing) return
    setWriting(true)
    const { promise, abort } = chatOnce(
      coverHtmlMessages(desc, customSrcRef.current, skill, { w: customW, h: customH }),
      (full) => {
        customSrcRef.current = stripHtmlFence(full)
      }
    )
    customAbortRef.current = abort
    try {
      const src = stripHtmlFence(await promise).trim()
      if (!/<html/i.test(src)) throw new Error('模型没吐出 HTML 源码，换个描述再试一次')
      customSrcRef.current = src
      const bytes = new TextEncoder().encode(src)
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      const rel = await window.api.invoke('project:saveAsset', project, 'covers/cover-custom.html', btoa(bin))
      setCustomHtml(rel)
      refreshProjectFiles()
      await renderCustomCover(rel)
      onToast('AI 已写好封面 HTML，源码在 covers/cover-custom.html')
    } catch (err) {
      onToast(`AI 写封面失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setWriting(false)
      customAbortRef.current = null
    }
  }, [customDesc, writing, skill, customW, customH, project, renderCustomCover, refreshProjectFiles, onToast])

  /** 把手写 HTML 渲出的图设为工程封面（方图缺省时同横图） */
  const applyCustomCover = useCallback(async () => {
    if (!customOut) return
    try {
      const fresh = await window.api.invoke('project:readMeta', project)
      // 方图不落盘：它是这张主图的裁剪，后台自己会裁；其它平台要 1:1 也从 main 现裁
      fresh.cover = { main: customOut.main, square: customOut.main }
      await window.api.invoke('project:writeMeta', project, fresh)
      setPv((v) => v + 1)
      onMetaUpdated()
      onToast('已设为封面（方图由主图裁，不另存）')
    } catch (err) {
      onToast(`设置封面失败：${err instanceof Error ? err.message : err}`)
    }
  }, [customOut, project, onMetaUpdated, onToast])

  const titles = [...(meta.titles ?? [])].sort((a, b) => b.score - a.score)
  // 已采用的候选 = 正文首行 H1（「采用」写的就是它），用于给对应行挂「已采用」态
  const appliedTitle = article.trim() ? extractTitle(mdToDoc(article), '') : ''
  const accent = theme?.accent ?? DEFAULT_ACCENT

  return (
    <div className="selectable thin-scroll min-h-0 flex-1 overflow-auto p-4 text-xs">
      <div className="flex flex-col gap-3">
        {/* ================= 卡 1 · 标题候选（稿 E：一卡一事，主按钮只有一个） ================= */}
        <Card>
          <div className="flex flex-nowrap items-center gap-2">
            <CardTitle tag={titles.length ? `${titles.length} 个候选` : undefined}>标题候选</CardTitle>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {titling && <span className="text-ink-dim">基于{meta.format === 'cards' ? '贴图文案' : '正文'}生成中…</span>}
              {titling ? (
                <Button size="sm" variant="ghost" icon="x" onClick={() => abortRef.current?.()}>
                  停止
                </Button>
              ) : (
                <Button size="sm" variant="pri" icon="brain" onClick={runTitles}>
                  {titles.length ? '重新起标题' : 'AI 起标题'}
                </Button>
              )}
            </div>
          </div>

          {titleError && (
            <p className="mt-2 break-all text-st-bad">
              <Icon name="xCircle" size={12} className="mr-1.5" />
              {titleError}
            </p>
          )}

          {titles.length === 0 ? (
            <p className="mt-2.5 rounded-lg border border-dashed border-panel-3 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
              暂无候选。点「AI 起标题」，会基于{meta.format === 'cards' ? '贴图文案' : '正文'}起 6 个标题并打分，选一条写入正文首行。
            </p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              {titles.map((t, i) => {
                const used = !!appliedTitle.trim() && t.text.trim() === appliedTitle.trim()
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                      used ? 'border-accent bg-accent/10' : 'border-panel-3 bg-panel hover:border-accent'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-ink">{t.text}</p>
                      {t.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{t.reason}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-accent">
                      {t.score} 分
                    </span>
                    <Button
                      size="sm"
                      variant="sec"
                      disabled={used}
                      onClick={() => {
                        onApplyTitle(t.text)
                        onToast('已把标题写入正文首行')
                      }}
                    >
                      {used ? '已采用' : '采用'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      title="复制到剪贴板"
                      onClick={() => {
                        navigator.clipboard.writeText(t.text)
                        onToast('标题已复制')
                      }}
                    >
                      复制
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* 贴图工程只要标题不要封面：两张封面卡整块隐藏 */}
        {meta.format !== 'cards' && (
          <Card>
            <CardTitle>封面</CardTitle>
            <div className="mt-3">
              <Segmented
                size="sm"
                ariaLabel="封面怎么来"
                value={coverMode}
                onChange={setCoverMode}
                items={[
                  { value: 'template', label: '模板直出', icon: 'palette', title: '选版式填标题，一步出图（底图可让 AI 现场生）' },
                  { value: 'photo', label: '纯图成图', icon: 'image', title: '只要画面不要文字：AI 生图或导入后拖选裁剪，整张就是封面' },
                  { value: 'html', label: 'HTML 直渲', icon: 'sliders', title: 'AI 或手写一份封面 HTML，直接截图' }
                ]}
              />
            </div>
            {coverMode === 'template' && (
              <>
                <div className="mt-3 grid grid-cols-[164px_minmax(0,1fr)] gap-4">
                  {/* 左：四版式缩略卡（诊断 9：选版式不再靠脑补） */}
                  <div className="grid grid-cols-2 gap-2 self-start" role="radiogroup" aria-label="封面版式">
                    {COVER_TEMPLATES.map((t) => (
                      <LayoutPick
                        key={t.id}
                        name={t.name}
                        hint={t.hint}
                        layoutId={t.id}
                        accent={accent}
                        on={template === t.id}
                        onPick={() => setTemplate(t.id)}
                      />
                    ))}
                  </div>
                  {/* 右：标题 / 副标题 / 底图 / 主按钮 */}
                  <div className="flex min-w-0 flex-col gap-2">
                    <input
                      value={coverTitle}
                      onChange={(e) => setCoverTitle(e.target.value)}
                      placeholder="封面大字（用 | 分行，行越短字越大；缺省取最高分候选）"
                      aria-label="封面标题"
                      className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none focus:border-accent"
                    />
                    <input
                      value={coverSubtitle}
                      onChange={(e) => setCoverSubtitle(e.target.value)}
                      placeholder="副标题（选填）"
                      aria-label="封面副标题"
                      className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none focus:border-accent"
                    />
                    {/* 底图从哪来一步选定，不用先去别的卡生成再回来勾选 */}
                    {NO_BG_TEMPLATES.includes(template) ? (
                      <p className="text-[11.5px] text-ink-dim">此版式为纯排印，不使用底图（要给照片压字请选「左文右图」）</p>
                    ) : (
                      <>
                        <Segmented
                          size="sm"
                          ariaLabel="底图来源"
                          value={bgSource}
                          onChange={setBgSource}
                          items={[
                            { value: 'none', label: '不用底图' },
                            { value: 'ai', label: 'AI 生插画' },
                            { value: 'file', label: '用工程里的图' }
                          ]}
                        />
                        {bgSource === 'ai' && (
                          <div className="flex items-start gap-2">
                            <textarea
                              value={coverPrompt}
                              onChange={(e) => setCoverPrompt(e.target.value)}
                              rows={2}
                              readOnly={prompting}
                              aria-label="底图画面描述"
                              placeholder="想要一张什么样的底图…主体放右侧约三分之一，左侧留给文字"
                              className="min-w-0 flex-1 rounded-lg border border-panel-3 bg-panel px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="file"
                              disabled={prompting || rendering}
                              onClick={extractCoverPrompt}
                            >
                              {prompting ? '提取中…' : '从正文提取'}
                            </Button>
                          </div>
                        )}
                        {bgSource === 'file' && (
                          <>
                            <BgPicker images={projectImages} url={assetUrl} value={bgFile} onPick={setBgFile} />
                            <Button size="sm" variant="ghost" icon="upload" onClick={() => bgFileRef.current?.click()}>
                              导入本地图片
                            </Button>
                            <input
                              ref={bgFileRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) importBg(f)
                                e.target.value = ''
                              }}
                            />
                          </>
                        )}
                      </>
                    )}
                    {coverError && <p className="text-[11.5px] text-st-bad">{coverError}</p>}
                    {/* 口径三件套直接摊开：折叠一层只多一次点击 */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        {/* 面板只能垫在照片上：没图（或纯排印版式）时不摆这个开关，免得"选了没反应" */}
                        {!NO_BG_TEMPLATES.includes(template) && bgSource !== 'none' && (
                          <Segmented
                            size="sm"
                            ariaLabel="文字区磨砂面板"
                            title="文字压在杂底上、看不清时的保底：垫一层磨砂；默认不铺"
                            value={panel}
                            onChange={(v) => {
                              setPanel(v)
                              setPanelTouched(true)
                            }}
                            items={[
                              { value: 'none', label: '不铺' },
                              { value: 'frosted', label: '磨砂' }
                            ]}
                          />
                        )}
                        <Segmented
                          size="sm"
                          ariaLabel="方图取景"
                          title="1:1 只能从主图裁出满高的一段：自动=主体在哪侧就往哪侧裁"
                          value={focalPick}
                          onChange={setFocalPick}
                          items={[
                            { value: 'auto', label: '自动' },
                            { value: 'right', label: '居右' },
                            { value: 'center', label: '居中' },
                            { value: 'left', label: '居左' }
                          ]}
                        />
                      <Switch checked={decor} onChange={setDecor} label="装饰" title="光晕 / 圆环 / 细线等装饰元素" />
                    </div>
                    <div className="mt-1 flex flex-nowrap items-center gap-2">
                      <Button
                        className="ml-auto shrink-0"
                        variant="pri"
                        icon="image"
                        disabled={rendering || !coverTitle.trim()}
                        onClick={renderTemplateCover}
                      >
                        {rendering ? (bgSource === 'ai' ? '生底图 + 排版中…' : '渲染中…') : '生成封面'}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 成品预览：读盘上的封面文件（带版本号破缓存），与另两条同一个预览壳 */}
                {meta.cover && projectDir && (
                  <div className="mt-3 flex flex-wrap items-start gap-2.5">
                    <PreviewFrame badge="2.35:1 头图" wide>
                      <img src={assetUrl(meta.cover.main)} alt="头图预览" className="block h-auto w-full" />
                    </PreviewFrame>
                    <PreviewFrame badge="1:1 方图">
                      <img src={assetUrl(meta.cover.square)} alt="方图预览" className="block h-auto w-full" />
                    </PreviewFrame>
                  </div>
                )}
                <CoverStateLine meta={meta} />

                              {/* 版式怎么排、方图为什么只能裁——这些设计依据在 docs/PRD.md 封面一节；界面只留可操作项 */}
              </>
            )}
            {coverMode === 'photo' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) pickImage(f)
                    e.target.value = ''
                  }}
                />
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    value={coverTitle}
                    onChange={(e) => setCoverTitle(e.target.value)}
                    placeholder="画面里的标题（留空则画面无字）"
                    aria-label="画面内标题"
                    className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
                  />
                  <input
                    value={coverSubtitle}
                    onChange={(e) => setCoverSubtitle(e.target.value)}
                    placeholder="副标题（选填；有标题时才会写进画面）"
                    aria-label="画面内副标题"
                    className="h-8 w-full rounded-lg border border-panel-3 bg-panel px-2.5 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
                  />
                  <p className="text-[11px] text-ink-dim">
                    这两行会被逐字写进画面（中文生图仍有出错率，出图后看一眼）；留空就是纯图封面。
                  </p>
                </div>
                <textarea
                  value={photoPrompt}
                  onChange={(e) => setPhotoPrompt(e.target.value)}
                  rows={photoPrompt.length > 60 ? 4 : 3}
                  readOnly={prompting}
                  placeholder="想要一张什么样的封面画面…主体可以居中铺满，这张图本身就是封面，不用给文字留白"
                  className="mt-1 w-full rounded-lg border border-panel-3 bg-panel px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
                />
                <div className="mt-2 flex flex-nowrap items-center gap-2">
                  {prompting ? (
                    <Button size="sm" variant="ghost" icon="x" onClick={() => promptAbortRef.current?.()}>
                      停止
                    </Button>
                  ) : (
                    <Button size="sm" variant="sec" icon="file" disabled={genning} onClick={extractPhotoPrompt}>
                      从正文提取
                    </Button>
                  )}
                  <Button size="sm" variant="sec" icon="upload" onClick={() => fileRef.current?.click()}>
                    {img ? '换一张图片' : '导入图片'}
                  </Button>
                  <Button
                    className="ml-auto shrink-0"
                    variant="sec"
                    icon="sparkles"
                    disabled={genning || prompting || !photoPrompt.trim()}
                    onClick={genCover}
                  >
                    {genning ? '生成中…' : '生成封面图'}
                  </Button>
                </div>
                {coverError && <p className="text-[11.5px] text-st-bad">{coverError}</p>}
                {img && (
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-dim">
                    <input
                      type="checkbox"
                      checked={useReference}
                      onChange={(e) => setUseReference(e.target.checked)}
                      className="accent-accent"
                    />
                    用当前图作参考（图生图，保留构图与风格；供应商不支持时会提示换模型）
                  </label>
                )}
                {prompting && <p className="mt-1.5 text-[11px] text-ink-dim">正在通读正文提取关键信息…</p>}
                {genning && <p className="mt-1.5 text-[11px] text-ink-dim">按提示词生成 21:9 横图，约一分钟</p>}

                {img ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {/* 两张成品并排看：2.35:1 头图 + 1:1 方图，都带比例角标、都能直接拖——
                        与「模板直出」的成品预览同一套语言，只是这里拖的是裁剪位置而不是成品 */}
                    <div className="flex flex-wrap items-start gap-2.5">
                      <PreviewFrame badge="2.35:1 头图" wide title="可直接拖动选裁剪位置">
                        <canvas
                          ref={wideRef}
                          width={WIDE.w}
                          height={WIDE.h}
                          onPointerDown={startCropDrag('wide', WIDE.w / WIDE.h)}
                          onPointerMove={moveCropDrag}
                          onPointerUp={endCropDrag}
                          onPointerCancel={endCropDrag}
                          style={{ touchAction: 'none' }}
                          className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
                        />
                      </PreviewFrame>
                      <PreviewFrame badge="1:1 方图" title="可直接拖动选裁剪位置">
                        <canvas
                          ref={squareRef}
                          width={SQUARE.w}
                          height={SQUARE.h}
                          onPointerDown={startCropDrag('square', 1)}
                          onPointerMove={moveCropDrag}
                          onPointerUp={endCropDrag}
                          onPointerCancel={endCropDrag}
                          style={{ touchAction: 'none' }}
                          className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
                        />
                      </PreviewFrame>
                    </div>
                    <CoverStateLine meta={meta} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented
                        size="sm"
                        ariaLabel="方图取景"
                        title="有标题时默认居左（裁得到字）；纯图封面默认居右（主体侧）"
                        value={squarePick}
                        onChange={(v) => {
                          setSquarePick(v)
                          setSquareOffset(v === 'left' ? 0 : v === 'center' ? 0.5 : 1)
                        }}
                        items={[
                          { value: 'left', label: '居左' },
                          { value: 'center', label: '居中' },
                          { value: 'right', label: '居右' }
                        ]}
                      />
                      <span className="text-[11px] text-ink-dim">方图取景，或直接在图上拖</span>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-ink-dim">
                      头图位置
                      <input
                        type="range"
                        min={0}
                        max={100}
                        aria-label="头图裁剪位置"
                        value={wideOffset * 100}
                        onChange={(e) => setWideOffset(Number(e.target.value) / 100)}
                        className="w-full max-w-[320px]"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-ink-dim">
                      方图位置
                      <input
                        type="range"
                        min={0}
                        max={100}
                        aria-label="方图裁剪位置"
                        value={squareOffset * 100}
                        onChange={(e) => {
                          setSquareOffset(Number(e.target.value) / 100)
                          setSquarePick('custom')
                        }}
                        className="w-full max-w-[320px]"
                      />
                    </label>
                    <div className="mt-1">
                      <Button variant="pri" icon="save" disabled={saving} onClick={saveCovers}>
                        {saving ? '保存中…' : '保存两种封面'}
                      </Button>
                      <p className="mt-1.5 text-[11px] text-ink-dim">
                        想让文字压得干净些：切到「模板直出」，底图选「用工程里的图」挑这张，文字会锁在左区、照片只占右侧画面。
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-ink-dim">
                    还没有画面：生成或导入一张后，两张成品并排预览、可直接拖动，保存时一次写 2.35:1 头图与 1:1 方图。
                  </p>
                )}
              </>
            )}
            {coverMode === 'html' && (
              <>
                <div className="mt-3 flex flex-nowrap items-center gap-2">
                  <textarea
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    onKeyDown={(e) => {
                      // 多行框里回车是换行；Ctrl/Cmd+Enter 才提交
                      if ((e.ctrlKey || e.metaKey) && shouldSubmitOnEnter(e)) writeCustomHtml()
                    }}
                    rows={customDesc.length > 60 ? 3 : 2}
                    placeholder="描述想要的封面，让 AI 写一份 HTML（改一版会带着上一版源码）"
                    aria-label="封面 HTML 生成指令"
                    className="min-w-0 flex-1 resize-y rounded-lg border border-panel-3 bg-panel px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-dim focus:border-accent"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="file"
                    disabled={prompting || writing}
                    onClick={extractHtmlBrief}
                  >
                    {prompting ? '提取中…' : '从正文提取'}
                  </Button>
                  {writing ? (
                    <Button size="sm" variant="ghost" icon="x" onClick={() => customAbortRef.current?.()}>
                      停止
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="sec"
                      icon="sparkles"
                      disabled={!customDesc.trim() || customizing}
                      onClick={() => writeCustomHtml()}
                    >
                      AI 写 HTML
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={customHtml}
                    onChange={(e) => setCustomHtml(e.target.value)}
                    aria-label="封面 HTML 源文件"
                    title="工程 covers/ 下的 HTML；这里只截图，不会重写这个文件"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-panel-3 bg-panel px-2 text-xs text-ink outline-none focus:border-accent"
                  >
                    {customHtml && !projectCovers.includes(customHtml) && (
                      <option value={customHtml}>{customHtml}</option>
                    )}
                    {projectCovers.map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {c.endsWith('covers/cover-wide.html') ? '（模板源）' : c.endsWith('covers/cover-custom.html') ? '（AI 写）' : '（手写）'}
                      </option>
                    ))}
                    {!projectCovers.length && !customHtml && <option value="">工程里还没有 covers/*.html</option>}
                  </select>
                  <Segmented
                    size="sm"
                    ariaLabel="画布比例"
                    value={canvasPreset}
                    onChange={(p) => {
                      setCanvasPreset(p)
                      if (p === 'wide') {
                        setCustomW(COVER_WIDE.w)
                        setCustomH(COVER_WIDE.h)
                      } else if (p === 'square') {
                        setCustomW(COVER_SQUARE.w)
                        setCustomH(COVER_SQUARE.h)
                      }
                    }}
                    items={[
                      { value: 'wide', label: '2.35:1', title: '1175×500 头图，顺带裁 1:1' },
                      { value: 'square', label: '1:1', title: '800×800 方图画布' },
                      { value: 'custom', label: '自定义' }
                    ]}
                  />
                  {canvasPreset === 'custom' && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <input
                        type="number"
                        value={customW}
                        min={100}
                        max={2400}
                        aria-label="画布宽度"
                        onChange={(e) => {
                          setCustomW(Number(e.target.value))
                          setCanvasPreset('custom')
                        }}
                        className="h-8 w-16 rounded-lg border border-panel-3 bg-panel px-2 text-xs tabular-nums text-ink outline-none focus:border-accent"
                      />
                      <span className="text-[11.5px] text-ink-dim">×</span>
                      <input
                        type="number"
                        value={customH}
                        min={100}
                        max={2400}
                        aria-label="画布高度"
                        onChange={(e) => {
                          setCustomH(Number(e.target.value))
                          setCanvasPreset('custom')
                        }}
                        className="h-8 w-16 rounded-lg border border-panel-3 bg-panel px-2 text-xs tabular-nums text-ink outline-none focus:border-accent"
                      />
                    </div>
                  )}
                  <Button
                    className="ml-auto shrink-0"
                    variant="sec"
                    icon="image"
                    disabled={customizing || writing || !customHtml.trim()}
                    onClick={() => renderCustomCover()}
                  >
                    {customizing ? '渲染中…' : '出图'}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-ink-dim">
                  covers/cover-wide.html 是模板直出的渲染源，每次「生成封面」都会重写；covers/cover-custom.html 是
                  「AI 写 HTML」写的，改它不会被覆盖。
                </p>
                {coverError && <p className="mt-1.5 text-[11.5px] text-st-bad">{coverError}</p>}
                {customOut ? (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <div className="flex flex-wrap items-start gap-2.5">
                      <PreviewFrame badge="2.35:1 头图" wide title={`${customW}×${customH}`}>
                        <img src={assetUrl(customOut.main)} alt="自定义封面预览" className="block h-auto w-full" />
                      </PreviewFrame>
                      {customW > customH && (
                        <PreviewFrame badge="1:1 方图" title="裁剪预览，不落盘">
                          <canvas ref={customSquareRef} width={SQUARE.w} height={SQUARE.h} className="block h-auto w-full" />
                        </PreviewFrame>
                      )}
                    </div>
                    <CoverStateLine meta={meta} />
                    {customW > customH && (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Segmented
                            size="sm"
                            ariaLabel="方图取景"
                            value={squarePick}
                            onChange={(v) => {
                              setSquarePick(v)
                              setSquareOffset(v === 'left' ? 0 : v === 'center' ? 0.5 : 1)
                            }}
                            items={[
                              { value: 'left', label: '居左' },
                              { value: 'center', label: '居中' },
                              { value: 'right', label: '居右' }
                            ]}
                          />
                          <span className="text-[11px] text-ink-dim">方图取景（仅预览，不落盘）</span>
                        </div>
                        <label className="flex items-center gap-2 text-[11px] text-ink-dim">
                          方图位置
                          <input
                            type="range"
                            min={0}
                            max={100}
                            aria-label="方图预览位置"
                            value={squareOffset * 100}
                            onChange={(e) => {
                              setSquareOffset(Number(e.target.value) / 100)
                              setSquarePick('custom')
                            }}
                            className="w-full max-w-[320px]"
                          />
                        </label>
                      </>
                    )}
                    <div>
                      <Button variant="pri" icon="check" onClick={applyCustomCover}>
                        设为封面
                      </Button>
                      <p className="mt-1.5 text-[11px] text-ink-dim">
                        {customOut.main}（方图不落盘，由它裁）
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-ink-dim">
                    2.35:1 画布出图后，1:1 方图就在主图旁边并排预览（只预览、不落盘；画布选 1:1 时本身就是方图）。出图不顶掉现有封面，点「设为封面」才写入。
                  </p>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )

}

/** 计算裁切源区域：短边吃满，长边按 offset(0-1) 滑动 */
function cropRect(img: HTMLImageElement, ratio: number, offset: number): { sx: number; sy: number; sw: number; sh: number } {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw / ih > ratio) {
    // 图更宽：吃满高，水平滑动
    const sw = ih * ratio
    return { sx: (iw - sw) * offset, sy: 0, sw, sh: ih }
  }
  // 图更高：吃满宽，垂直滑动
  const sh = iw / ratio
  return { sx: 0, sy: (ih - sh) * offset, sw: iw, sh }
}

/** 拖动裁剪度量：内容跟手。per = 指针每移动 1 显示像素对应的 offset 变化量；无可滑动余量返回 null */
function dragFactor(canvas: HTMLCanvasElement, img: HTMLImageElement, ratio: number): { axis: 'x' | 'y'; per: number } | null {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw / ih > ratio) {
    // 图更宽：裁剪窗水平滑动，显示宽=clientWidth 对应裁剪窗宽 sw 个图像像素
    const sw = ih * ratio
    const avail = iw - sw
    if (avail <= 0 || canvas.clientWidth <= 0) return null
    return { axis: 'x', per: sw / canvas.clientWidth / avail }
  }
  const sh = iw / ratio
  const avail = ih - sh
  if (avail <= 0 || canvas.clientHeight <= 0) return null
  return { axis: 'y', per: sh / canvas.clientHeight / avail }
}

function drawCrop(canvas: HTMLCanvasElement, img: HTMLImageElement, ratio: number, offset: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { sx, sy, sw, sh } = cropRect(img, ratio, offset)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
}

/** 按目标尺寸离屏渲染并导出 base64（不带 dataURL 前缀） */
function renderPng(img: HTMLImageElement, w: number, h: number, offset: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  drawCrop(canvas, img, w / h, offset)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/** 底图导出：整张源图不裁切，长边压到 BG_MAX_EDGE 以内（封面最宽 1175，够用又不撑大工程） */
function renderFullPng(img: HTMLImageElement): string {
  const scale = Math.min(1, BG_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}


/** 强调色缺省值：工程还没解析出排版调性时用 §3.1 的 primary */
const DEFAULT_ACCENT = '#0d9488'

/** 比例角标常驻的成品预览框（§5.3：封面预览标注 2.35:1 / 1:1） */
/**
 * 封面预览框：三条路共用同一层壳——圆角、边框、角标位置、宽度档位都在这里。
 * 里面可以是 <img>（读盘成品）也可以是 <canvas>（就地裁剪预览），外壳必须长得一样。
 */
function PreviewFrame({
  badge,
  wide = false,
  title,
  children
}: {
  badge: string
  wide?: boolean
  title?: string
  children: ReactElement
}): ReactElement {
  return (
    <span
      className={`relative block overflow-hidden rounded-lg border border-panel-3 ${
        wide ? 'w-[min(100%,420px)]' : 'w-[132px] shrink-0'
      }`}
      title={title}
    >
      {children}
      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
        {badge}
      </span>
    </span>
  )
}

/** 「当前封面」一行：三条路同一句、同一位置（有封面才出现），别各写各的 */
function CoverStateLine({ meta }: { meta: ProjectMeta }): ReactElement | null {
  if (!meta.cover) return null
  const tpl = meta.cover.template
    ? `（模板：${COVER_TEMPLATES.find((t) => t.id === meta.cover?.template)?.name ?? meta.cover.template}）`
    : ''
  return (
    <p className="mt-1.5 text-[11px] text-st-done">
      <Icon name="checkCircle" size={12} className="mr-1.5" />
      当前封面：{meta.cover.main} / {meta.cover.square}
      {tpl}
    </p>
  )
}

/**
 * 版式缩略卡（稿 E⑲，替代原来的四个纯文字链）：按各版式真实结构画出骨架——
 * 文字块 / 画面区 / 强调色竖条落位可见，选中态主色描边 + 光晕。
 * 纯 CSS，不做离屏渲染：缩略卡只表达「版式长什么样」，成品预览仍读盘上的真图。
 */
function LayoutPick({
  name,
  hint,
  layoutId,
  accent,
  on,
  onPick
}: {
  name: string
  hint: string
  layoutId: string
  accent: string
  on: boolean
  onPick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      title={hint}
      className={`rounded-lg border-2 p-1 transition-colors ${
        on ? 'border-accent bg-accent/10 shadow-[0_0_0_3px_rgb(var(--accent)/.16)]' : 'border-panel-3 bg-panel hover:border-accent'
      }`}
    >
      <span className="relative block h-11 overflow-hidden rounded" style={{ background: pickBackdrop(layoutId, accent) }}>
        {pickShapes(layoutId, accent).map((s, i) => (
          <span key={i} className="absolute block rounded" style={s} />
        ))}
      </span>
      <span className={`mt-1 block truncate text-center text-[10.5px] ${on ? 'font-semibold text-accent' : 'text-ink-dim'}`}>
        {name}
      </span>
    </button>
  )
}

/**
 * 底图选择器：缩略图横条，看到画面才能决定用哪张。
 * 不用下拉列文件名——`assets/ai-1791028410270.png` 这种一串时间戳人眼读不出是哪张图。
 */
function BgPicker({
  images,
  url,
  value,
  onPick
}: {
  images: string[]
  url: (rel: string) => string
  value: string
  onPick: (rel: string) => void
}): ReactElement {
  if (!images.length) {
    return (
      <p className="text-[11.5px] text-ink-dim">
        工程 assets/ 里还没有图。切到「照片裁剪」生成或导入一张，或直接选「AI 生成底图」。
      </p>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className="thin-scroll flex items-center gap-1.5 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="底图候选"
      >
        {images.map((p) => {
          const on = p === value
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              title={p}
              onClick={() => onPick(p)}
              className={`relative h-11 w-[76px] shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                on ? 'border-accent' : 'border-panel-3 hover:border-accent'
              }`}
            >
              <img src={url(p)} alt={p} loading="lazy" className="h-full w-full object-cover" />
              {on && (
                <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-white">
                  <Icon name="check" size={9} />
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="truncate text-[11px] text-ink-dim">{value ? `底图：${value}` : '点一张图作底图'}</p>
    </div>
  )
}

/** 缩略卡底色：大字版式 / 左侧竖栏是强调色深底，杂志大字用纸白底，氛围渐变用夜空底，其余走面板底 */
function pickBackdrop(layoutId: string, accent: string): string {
  if (layoutId === 'plain' || layoutId === 'left') return hexToRgba(accent, 0.82) ?? accent
  if (layoutId === 'magazine') return '#faf8f4'
  if (layoutId === 'aurora') return '#0a0e17'
  return 'transparent'
}

/** 版式骨架：一组绝对定位条块，位置即真实版式里文字块 / 画面区 / 竖条的落位 */
function pickShapes(layoutId: string, accent: string): CSSProperties[] {
  const bar = (left: string, top: string, width: string, height: string, strong = true): CSSProperties => ({
    left,
    top,
    width,
    height,
    background: strong ? 'rgb(var(--ink)/.85)' : 'rgb(var(--ink)/.3)'
  })
  // 深底版式（大字版式 / 左侧竖栏 / 氛围渐变）的字条走浅色，否则黑压黑看不出排版
  const lite = (left: string, top: string, width: string, height: string, strong = true): CSSProperties => ({
    left,
    top,
    width,
    height,
    background: strong ? 'rgba(244,246,251,.92)' : 'rgba(244,246,251,.5)'
  })
  if (layoutId === 'split') {
    return [
      bar('7%', '20%', '44%', '14%'),
      bar('7%', '42%', '34%', '10%', false),
      {
        right: '0',
        top: '0',
        bottom: '0',
        width: '36%',
        background: `linear-gradient(120deg, ${accent}, ${hexToRgba(accent, 0.55) ?? accent})`
      }
    ]
  }
  // plain（大字版式）：通栏超大字压底 + 右上首字水印，刻意与左文右图的左列居中拉开
  if (layoutId === 'plain') {
    return [
      { right: '3%', top: '8%', width: '30%', height: '64%', background: hexToRgba(accent, 0.3) ?? accent },
      lite('8%', '54%', '84%', '18%'),
      lite('8%', '76%', '58%', '9%', false)
    ]
  }
  if (layoutId === 'left') {
    return [
      { left: '0', top: '0', bottom: '0', width: '5%', background: accent },
      // 标题等高的竖线勾边是「左侧竖栏」自己的排字语言，缩略卡必须画出来，否则预览在说谎
      { left: '13%', top: '22%', bottom: '26%', width: '1.5%', background: accent },
      bar('18%', '26%', '52%', '16%', false),
      bar('18%', '50%', '36%', '10%', false)
    ]
  }
  // magazine（杂志大字）：纸白底 + 顶部通栏细线 + 超大粗字 + 右侧细描边大圆
  if (layoutId === 'magazine') {
    return [
      { left: '8%', right: '8%', top: '9%', height: '4%', background: accent },
      bar('8%', '30%', '54%', '24%'),
      bar('8%', '62%', '34%', '9%', false),
      {
        right: '7%',
        top: '22%',
        width: '40%',
        height: '58%',
        border: `1.5px solid ${hexToRgba(accent, 0.7) ?? accent}`,
        borderRadius: '50%'
      },
      { right: '25%', top: '48%', width: '8%', height: '15%', background: accent }
    ]
  }
  // aurora（氛围渐变）：夜空底 + 强调色弥散光斑 + 浅色大字（深底，字条走白）
  if (layoutId === 'aurora') {
    return [
      {
        right: '-8%',
        top: '-30%',
        width: '62%',
        height: '110%',
        background: `radial-gradient(circle at 50% 45%, ${hexToRgba(accent, 0.55) ?? accent} 0%, transparent 62%)`
      },
      {
        left: '-10%',
        bottom: '-36%',
        width: '44%',
        height: '86%',
        background: `radial-gradient(circle at 50% 50%, ${hexToRgba(accent, 0.32) ?? accent} 0%, transparent 62%)`
      },
      // 标记与两行字都居中在文字列中轴（约 28.5% 处）——这就是它区别于左文右图的地方
      { left: '24%', top: '24%', width: '10%', height: '4%', background: accent },
      lite('9%', '34%', '40%', '18%'),
      lite('13%', '58%', '31%', '9%', false)
    ]
  }
  // editorial（杂志留白）：浅底细线 + 深色字，无画面区
  return [
    bar('9%', '22%', '30%', '8%', false),
    bar('9%', '38%', '64%', '16%'),
    { left: '9%', top: '68%', width: '82%', height: '3%', background: 'rgb(var(--ink)/.25)' }
  ]
}
