import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement
} from 'react'
import {
  CARD_FORMAT_LABEL,
  cardsPlainText,
  parseCardItems,
  type CardDeck,
  type CardFormat,
  type CardItem
} from '@shared/cards'
import { chatOnce } from '../copilot/llm'
import {
  cardsCaptionMessages,
  cardsRefineMessages,
  cardsRestyleMessages,
  cardsToArticleMessages
} from '../copilot/prompts'

interface CardsPanelProps {
  project: string
  projectDir: string
  skill: string | null
  /** 正文非空时显示「回到文章」：不重新生成，只切回文章形态 */
  hasArticle: boolean
  /** 扩写成文章后把 md 落编辑器（App 会切回正文视图） */
  onArticleGenerated: (md: string) => void
  /** meta.format 变更后让 App 重读 meta */
  onMetaUpdated: () => void
  /** 格式/张数变化上报 App：统计信息显示在中栏页签行，工具条瘦身 */
  onDeckChanged: (info: { format: CardFormat; count: number } | null) => void
  onToast: (msg: string) => void
}

/** 右栏贴图审阅面板与对话指令通过 App 转发调用：落盘 / 按报告优化 / 滚到第 N 张卡 / 换强调色 */
export interface CardsPanelHandle {
  flush: () => Promise<void>
  refine: (review?: string) => Promise<void>
  scrollToCard: (index: number) => void
  setAccent: (color: string | null) => Promise<void>
}

const EMPTY_CARD: CardItem = { title: '', body: '', bgPrompt: '', bgImage: '', png: '' }

/** 预设强调色：覆盖两平台常用色系，选不中的用取色器自定义 */
const PRESET_ACCENTS: { color: string; name: string }[] = [
  { color: '#b0803c', name: '金棕（公众号默认）' },
  { color: '#ff2e63', name: '桃红（小红书默认）' },
  { color: '#ff6b35', name: '橙' },
  { color: '#e63946', name: '红' },
  { color: '#16a085', name: '绿' },
  { color: '#4f8cff', name: '蓝' },
  { color: '#7c5cff', name: '紫' }
]

/**
 * 贴图卡片面板（中央区，meta.format === 'cards' 时替代正文编辑器）
 * 文案/背图描述可编辑 → AI 生成背图 → 离屏渲染 1242×1656 PNG
 * 全局操作：全部重渲染、转另一种平台风格、扩写成公众号文章、打开图片文件夹
 * 贴图审阅在右栏「审阅」页签（CardsReviewPanel），经 ref 句柄联动本面板
 */
const CardsPanel = forwardRef<CardsPanelHandle, CardsPanelProps>(function CardsPanel(
  { project, projectDir, skill, hasArticle, onArticleGenerated, onMetaUpdated, onDeckChanged, onToast },
  handleRef
): ReactElement {
  const [deck, setDeck] = useState<CardDeck | null>(null)
  // 全局长任务提示（转风格/扩写中，禁用编辑）
  const [busy, setBusy] = useState<string | null>(null)
  const [renderingIdx, setRenderingIdx] = useState<number | null>(null)
  // 推送草稿箱进行中（传图较慢，防重复点击）
  const [pushing, setPushing] = useState(false)
  const [bgBusy, setBgBusy] = useState<number | null>(null)
  // AI 整卡成图进行中的卡序
  const [aiBusy, setAiBusy] = useState<number | null>(null)
  // 另一格式的存档版（转风格时自动备份）：非空则露出零成本「切回」入口
  const [archived, setArchived] = useState<CardDeck | null>(null)
  // 强调色选色条展开状态与取色器待应用颜色
  const [showAccent, setShowAccent] = useState(false)
  const [customColor, setCustomColor] = useState('')
  // 渲染完成后自增，给 asset:// 图片 URL 加参破缓存
  const [version, setVersion] = useState(0)
  const [dirtyN, setDirtyN] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)
  const deckRef = useRef<CardDeck | null>(null)
  deckRef.current = deck
  // 卡片 DOM 引用：右栏审阅报告点「第 N 张」定位滚动用
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const assetUrl = useCallback(
    (rel: string) =>
      'asset://file/' + encodeURIComponent(`${projectDir}\\${rel.replace(/\//g, '\\')}`) + `?v=${version}`,
    [projectDir, version]
  )

  // ---- 读写与渲染 ----

  /** 逐张离屏渲染（主进程串行队列），完毕后重读磁盘同步 png 字段 */
  const renderSeq = useCallback(
    async (indices: number[]) => {
      for (const i of indices) {
        setRenderingIdx(i)
        try {
          await window.api.invoke('cards:render', project, i)
        } catch (err) {
          onToast(`第 ${i + 1} 张渲染失败：${err instanceof Error ? err.message : err}`)
        }
      }
      setRenderingIdx(null)
      const fresh = await window.api.invoke('cards:read', project)
      if (fresh) setDeck(fresh)
      setVersion((v) => v + 1)
    },
    [project, onToast]
  )

  // 首载：读 cards.json；缺 PNG 的卡片（新建/转来的）自动补渲
  useEffect(() => {
    let alive = true
    void (async () => {
      const d = await window.api.invoke('cards:read', project)
      if (!alive) return
      setDeck(d)
      const missing = d ? d.cards.flatMap((c, i) => (c.png ? [] : [i])) : []
      if (missing.length) await renderSeq(missing)
    })()
    return () => {
      alive = false
    }
  }, [project, renderSeq])

  // 当前格式变化后刷新另一格式存档：有存档才显示「切回」按钮
  const format = deck?.format
  useEffect(() => {
    if (!format) {
      setArchived(null)
      return
    }
    let alive = true
    window.api
      .invoke('cards:archiveRead', project, format === 'wechat' ? 'xhs' : 'wechat')
      .then((a) => alive && setArchived(a))
      .catch(() => alive && setArchived(null))
    return () => {
      alive = false
    }
  }, [project, format])

  // 格式/张数上报 App 页签行显示；卸载（切回文章/换工程）时清空
  const onDeckChangedRef = useRef(onDeckChanged)
  onDeckChangedRef.current = onDeckChanged
  const count = deck?.cards.length ?? 0
  useEffect(() => {
    onDeckChangedRef.current(format ? { format, count } : null)
  }, [format, count])
  useEffect(() => () => onDeckChangedRef.current(null), [])

  // 外部（Agent/其他工具）改 cards.json → 热载
  useEffect(
    () =>
      window.api.on('file:external-change', async ({ project: p, file }) => {
        if (p !== project || file !== 'cards.json') return
        const fresh = await window.api.invoke('cards:read', project)
        if (fresh) setDeck(fresh)
        setVersion((v) => v + 1)
      }),
    [project]
  )

  // 文案编辑防抖落盘（渲染前会再 flush 一次，丢防抖也不丢数据）
  useEffect(() => {
    if (!dirtyN || !deckRef.current) return
    const t = setTimeout(() => {
      void window.api.invoke('cards:write', project, deckRef.current!)
    }, 800)
    return () => clearTimeout(t)
  }, [dirtyN, project])

  const flush = useCallback(async () => {
    if (deckRef.current) await window.api.invoke('cards:write', project, deckRef.current)
  }, [project])

  const editCard = useCallback((i: number, patch: Partial<CardItem>) => {
    setDeck((d) => d && { ...d, cards: d.cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
    setDirtyN((n) => n + 1)
  }, [])

  /** 增删/换序后页码全体失效：清空 png 整组重渲 */
  const restructure = useCallback(
    async (cards: CardItem[]) => {
      const cur = deckRef.current
      if (!cur) return
      const next = { ...cur, cards: cards.map((c) => ({ ...c, png: '' })) }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      await renderSeq(next.cards.map((_, i) => i))
    },
    [project, renderSeq]
  )

  // ---- 卡片操作 ----

  const renderOne = useCallback(
    async (i: number) => {
      await flush()
      await renderSeq([i])
    },
    [flush, renderSeq]
  )

  const renderAll = useCallback(async () => {
    await flush()
    await renderSeq(deckRef.current?.cards.map((_, i) => i) ?? [])
  }, [flush, renderSeq])

  /** AI 背图：3:4 生图 → assets/ 落盘 → 该卡重渲 */
  const genBg = useCallback(
    async (i: number) => {
      const card = deckRef.current?.cards[i]
      if (!card) return
      if (!card.bgPrompt.trim()) {
        onToast('请先填写背图画面描述')
        return
      }
      setBgBusy(i)
      try {
        const b64 = await window.api.invoke('image:generate', card.bgPrompt.trim(), { size: '1K', ratio: '3:4' })
        // 时间戳命名，避免换序后新背图覆盖别的卡还在引用的旧图
        const rel = await window.api.invoke('project:saveAsset', project, `assets/card-bg-${Date.now()}.png`, b64)
        const cur = deckRef.current
        if (!cur?.cards[i]) return
        const next = { ...cur, cards: cur.cards.map((c, j) => (j === i ? { ...c, bgImage: rel } : c)) }
        setDeck(next)
        await window.api.invoke('cards:write', project, next)
        await renderSeq([i])
      } catch (err) {
        onToast(`背图生成失败：${err instanceof Error ? err.message : err}`)
      } finally {
        setBgBusy(null)
      }
    },
    [project, onToast, renderSeq]
  )

  /** AI 整卡成图：文字直接画进图里，不走排版模板；可随时「恢复排版」切回 */
  const genAiFull = useCallback(
    async (i: number) => {
      await flush()
      const cur = deckRef.current
      const card = cur?.cards[i]
      if (!cur || !card) return
      const points = card.body.split('\n').map((s) => s.trim()).filter(Boolean).join('；')
      const style = card.bgPrompt.trim() || (cur.format === 'wechat' ? '米白底色、书面克制、纸面质感' : '暖色渐变、活泼小红书风、圆角卡片感')
      const prompt = `设计一张 3:4 竖版中文图文卡片成品，把以下文字直接排版进画面，汉字必须清晰可读、无错字无乱码：标题「${card.title}」${points ? `；要点：${points}` : ''}。视觉风格：${style}。文字与背景融合自然，构图留白考究，不要出现水印。`
      setAiBusy(i)
      try {
        const b64 = await window.api.invoke('image:generate', prompt, { size: '1K', ratio: '3:4' })
        const rel = await window.api.invoke('project:saveAsset', project, `assets/card-ai-${Date.now()}.png`, b64)
        const now = deckRef.current
        if (!now?.cards[i]) return
        const next = { ...now, cards: now.cards.map((c, j) => (j === i ? { ...c, aiImage: rel, mode: 'ai' as const } : c)) }
        setDeck(next)
        await window.api.invoke('cards:write', project, next)
        await renderSeq([i])
      } catch (err) {
        onToast(`AI 成图失败：${err instanceof Error ? err.message : err}`)
      } finally {
        setAiBusy(null)
      }
    },
    [project, flush, onToast, renderSeq]
  )

  /** AI 成图 → 恢复排版渲染（成图文件保留，再点 AI 成图会重新生成） */
  const restoreLayout = useCallback(
    async (i: number) => {
      const cur = deckRef.current
      if (!cur?.cards[i]) return
      const next = { ...cur, cards: cur.cards.map((c, j) => (j === i ? { ...c, mode: 'layout' as const } : c)) }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      await renderSeq([i])
    },
    [project, renderSeq]
  )

  /** 深色底反白开关：背图偏深时底色变深、文字切浅色配色板，立即重渲该卡 */
  const toggleDark = useCallback(
    async (i: number, dark: boolean) => {
      const cur = deckRef.current
      if (!cur?.cards[i]) return
      const next = { ...cur, cards: cur.cards.map((c, j) => (j === i ? { ...c, dark: dark || undefined } : c)) }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      await renderSeq([i])
    },
    [project, renderSeq]
  )

  /** 要点序号开关：每条要点前加 01/02 强调色编号，立即重渲该卡 */
  const toggleNumbered = useCallback(
    async (i: number, numbered: boolean) => {
      const cur = deckRef.current
      if (!cur?.cards[i]) return
      const next = { ...cur, cards: cur.cards.map((c, j) => (j === i ? { ...c, numbered: numbered || undefined } : c)) }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      await renderSeq([i])
    },
    [project, renderSeq]
  )

  /** 强调色变更（null 恢复平台默认）：着色点遍布全组，整组重渲 */
  const setAccent = useCallback(
    async (color: string | null) => {
      await flush()
      const cur = deckRef.current
      if (!cur) return
      const next = { ...cur, accent: color ?? undefined }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      await renderSeq(next.cards.map((_, i) => i))
      onToast(color ? `强调色已换为 ${color}` : '强调色已恢复平台默认')
    },
    [project, flush, renderSeq, onToast]
  )

  const moveCard = useCallback(
    (i: number, dir: -1 | 1) => {
      const cards = [...(deckRef.current?.cards ?? [])]
      const j = i + dir
      if (!cards[i] || !cards[j]) return
      ;[cards[i], cards[j]] = [cards[j], cards[i]]
      void restructure(cards)
    },
    [restructure]
  )

  const deleteCard = useCallback(
    (i: number) => {
      const cards = deckRef.current?.cards ?? []
      if (!window.confirm(`删除第 ${i + 1} 张卡片？`)) return
      void restructure(cards.filter((_, j) => j !== i))
    },
    [restructure]
  )

  const addCard = useCallback(() => {
    void restructure([...(deckRef.current?.cards ?? []), { ...EMPTY_CARD, title: '新卡片' }])
  }, [restructure])

  /** 在第 i 张卡片下方插入一张新卡片：页码全体失效，整组重渲 */
  const insertCard = useCallback(
    (i: number) => {
      const cards = [...(deckRef.current?.cards ?? [])]
      cards.splice(i + 1, 0, { ...EMPTY_CARD, title: '新卡片' })
      void restructure(cards)
    },
    [restructure]
  )

  // ---- 全局操作：转风格 / 扩写成文章 ----

  /** 公众号风 ⇄ 小红书风：文案改写、背图按张保留、整组重渲；原版存档可随时零成本切回 */
  const restyle = useCallback(async () => {
    await flush()
    const d = deckRef.current
    if (!d?.cards.length) return
    const target: CardFormat = d.format === 'wechat' ? 'xhs' : 'wechat'
    const label = CARD_FORMAT_LABEL[target]
    setBusy(`正在转换为${label}…`)
    try {
      const { promise, abort } = chatOnce(cardsRestyleMessages(cardsPlainText(d.cards), target, skill), (full) =>
        setBusy(`正在转换为${label}…已生成 ${full.length} 字`)
      )
      abortRef.current = abort
      const parsed = parseCardItems(await promise)
      if (!parsed) throw new Error('卡片解析失败，请重试')
      // 原格式先存档：产物目录按格式分开，PNG 不会被新格式覆盖，切回无需重渲
      await window.api.invoke('cards:archiveWrite', project, d)
      const cards = parsed.map((c, i) => ({
        ...c,
        // 背图/透出/深色/字号/序号按张保留；AI 成图里的文字已过时，回退到排版渲染
        bgImage: d.cards[i]?.bgImage ?? '',
        bgOpacity: d.cards[i]?.bgOpacity,
        dark: d.cards[i]?.dark,
        fontScale: d.cards[i]?.fontScale,
        numbered: d.cards[i]?.numbered,
        aiImage: d.cards[i]?.aiImage ?? ''
      }))
      // 强调色是作者审美偏好，跨平台保留
      const next: CardDeck = { format: target, cards, accent: d.accent }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      setBusy(null)
      await renderSeq(cards.map((_, i) => i))
      onToast(`已转换为${label}`)
    } catch (err) {
      setBusy(null)
      onToast(`转换失败：${err instanceof Error ? err.message : err}`)
    } finally {
      abortRef.current = null
    }
  }, [project, skill, flush, onToast, renderSeq])

  /** 零成本互切：当前版存档 ↔ 另一格式存档版互换，不花 token；PNG 分目录互不覆盖 */
  const switchFormat = useCallback(async () => {
    await flush()
    const cur = deckRef.current
    const other = archived
    if (!cur || !other) return
    await window.api.invoke('cards:archiveWrite', project, cur)
    await window.api.invoke('cards:write', project, other)
    setDeck(other)
    setVersion((v) => v + 1)
    onToast(`已切回${CARD_FORMAT_LABEL[other.format]}，另一版已存档可随时再切`)
    // 存档版可能还有没渲染过的卡，补齐
    const missing = other.cards.flatMap((c, i) => (c.png ? [] : [i]))
    if (missing.length) await renderSeq(missing)
  }, [project, archived, flush, onToast, renderSeq])

  /** 推送贴图组到公众号草稿箱（图片消息形态）；后端校验失败原因直接展示 result.error */
  const pushToDraft = useCallback(async () => {
    await flush()
    setPushing(true)
    try {
      const result = await window.api.invoke('wechat:push-cards', { project })
      onToast(
        result.ok
          ? `✓ 贴图已推送到公众号${result.accountName ? `「${result.accountName}」` : ''}草稿箱，mediaId：${result.mediaId ?? ''}`
          : `推送失败：${result.error ?? '未知错误'}`
      )
    } catch (err) {
      onToast(`推送失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setPushing(false)
    }
  }, [project, flush, onToast])

  /** AI 优化：平台风格不变，逐张润色文案 + 生成贴题角标；传入审阅报告则逐条落实；背图/透出/深色/字号按张保留 */
  const refine = useCallback(
    async (review?: string) => {
      await flush()
      const d = deckRef.current
      if (!d?.cards.length) return
      const label = review ? '正在按报告优化…' : '正在 AI 优化文案…'
      setBusy(label)
      try {
        const { promise, abort } = chatOnce(cardsRefineMessages(cardsPlainText(d.cards), d.format, skill, review), (full) =>
          setBusy(`${label}已生成 ${full.length} 字`)
        )
        abortRef.current = abort
        const parsed = parseCardItems(await promise)
        if (!parsed) throw new Error('卡片解析失败，请重试')
        const cards = parsed.map((c, i) => ({
          ...c,
          // 背图/透出/深色/字号/序号按张保留；AI 成图里的文字已过时，回退到排版渲染
          bgImage: d.cards[i]?.bgImage ?? '',
          bgOpacity: d.cards[i]?.bgOpacity,
          dark: d.cards[i]?.dark,
          fontScale: d.cards[i]?.fontScale,
          numbered: d.cards[i]?.numbered,
          aiImage: d.cards[i]?.aiImage ?? ''
        }))
        // 同平台优化：配文仍适用，保留
        const next: CardDeck = { ...d, cards }
        setDeck(next)
        await window.api.invoke('cards:write', project, next)
        setBusy(null)
        await renderSeq(cards.map((_, i) => i))
        onToast(review ? '已按报告完成优化，排版类建议（字号/深色）记得手动调' : '已完成 AI 优化')
      } catch (err) {
        setBusy(null)
        onToast(`AI 优化失败：${err instanceof Error ? err.message : err}`)
      } finally {
        abortRef.current = null
      }
    },
    [project, skill, flush, onToast, renderSeq]
  )

  /** 卡片文案 → 完整公众号文章：写入编辑器并把工程切回文章形态 */
  const toArticle = useCallback(async () => {
    const d = deckRef.current
    if (!d?.cards.length) return
    if (!window.confirm('将卡片文案扩写成公众号文章，并把工程切换为文章形态（正文会被覆盖，卡片数据保留可随时切回），继续？')) return
    setBusy('正在扩写成文章…')
    try {
      const { promise, abort } = chatOnce(cardsToArticleMessages(cardsPlainText(d.cards), skill), (full) =>
        setBusy(`正在扩写成文章…已生成 ${full.length} 字`)
      )
      abortRef.current = abort
      const md = (await promise).trim() + '\n'
      const meta = await window.api.invoke('project:readMeta', project)
      meta.format = 'article'
      if (meta.status === 'ideating') meta.status = 'drafting'
      await window.api.invoke('project:writeMeta', project, meta)
      onArticleGenerated(md)
      onMetaUpdated()
      onToast('已扩写成文章，工程已切换为文章形态')
    } catch (err) {
      onToast(`扩写失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(null)
      abortRef.current = null
    }
  }, [project, skill, onArticleGenerated, onMetaUpdated, onToast])

  const openFolder = useCallback(() => {
    const fmt = deckRef.current?.format ?? 'wechat'
    window.api
      .invoke('export:openFile', `${projectDir}\\cards\\${fmt}`)
      .catch(() => onToast('图片文件夹还不存在，先渲染一张卡片'))
  }, [projectDir, onToast])

  /** 发布配文：按平台风格生成带话题标签的发图文案，可编辑可复制；转平台后作废需重新生成 */
  const genCaption = useCallback(async () => {
    await flush()
    const d = deckRef.current
    if (!d?.cards.length) return
    setBusy('正在生成发布配文…')
    try {
      const { promise, abort } = chatOnce(cardsCaptionMessages(cardsPlainText(d.cards), d.format, skill), (full) =>
        setBusy(`正在生成发布配文…已生成 ${full.length} 字`)
      )
      abortRef.current = abort
      const text = (await promise).trim()
      const cur = deckRef.current
      if (!cur) return
      const next = { ...cur, caption: text }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
      onToast('配文已生成，可直接编辑或复制')
    } catch (err) {
      onToast(`配文生成失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(null)
      abortRef.current = null
    }
  }, [project, skill, flush, onToast])

  const editCaption = useCallback((v: string) => {
    setDeck((d) => d && { ...d, caption: v })
    setDirtyN((n) => n + 1)
  }, [])

  const copyCaption = useCallback(async () => {
    const text = deckRef.current?.caption?.trim()
    if (!text) return
    await navigator.clipboard.writeText(text)
    onToast('配文已复制，粘到发布框即可')
  }, [onToast])

  /** 回退：不重新生成，只切回文章形态（article.md 与 cards.json 各自保留，可随时再切回来） */
  const backToArticle = useCallback(async () => {
    const meta = await window.api.invoke('project:readMeta', project)
    meta.format = 'article'
    await window.api.invoke('project:writeMeta', project, meta)
    onMetaUpdated()
    onToast('已切回文章形态，卡片数据保留，工具条「回到贴图」可随时切回来')
  }, [project, onMetaUpdated, onToast])

  /** meta.format 是 cards 但还没有 cards.json（例如脑暴解析失败）→ 引导手动起组 */
  const createEmpty = useCallback(
    async (format: CardFormat) => {
      const next: CardDeck = { format, cards: [{ ...EMPTY_CARD, title: '封面标题' }] }
      setDeck(next)
      await window.api.invoke('cards:write', project, next)
    },
    [project]
  )

  /** 右栏审阅报告点「第 N 张」→ 滚到对应卡片 */
  const scrollToCard = useCallback((index: number) => {
    cardRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // 暴露给右栏贴图审阅面板与对话改色指令（经 App 转发）
  useImperativeHandle(handleRef, () => ({ flush, refine, scrollToCard, setAccent }), [flush, refine, scrollToCard, setAccent])

  // ---- 视图 ----

  if (!deck) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-xs text-ink-dim">
        <p>本工程是贴图形态，但还没有卡片数据</p>
        <div className="flex gap-2">
          <button onClick={() => createEmpty('wechat')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
            🖼 新建公众号贴图
          </button>
          <button onClick={() => createEmpty('xhs')} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
            📕 新建小红书贴图
          </button>
          {hasArticle && (
            <button onClick={backToArticle} className="rounded bg-panel-3 px-3 py-1.5 text-ink hover:bg-panel">
              ↩ 回到文章
            </button>
          )}
        </div>
      </div>
    )
  }

  const globalBusy = Boolean(busy) || renderingIdx !== null
  const otherLabel = CARD_FORMAT_LABEL[deck.format === 'wechat' ? 'xhs' : 'wechat']

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      {/* 工具条：按钮不换行，放不下就整体折行成两排（格式/张数已移到中栏页签行） */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-panel-3 px-4 py-1.5 text-ink-dim">
        <button onClick={renderAll} disabled={globalBusy || !deck.cards.length} className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
          🔁 全部重渲染
        </button>
        <button
          onClick={() => setShowAccent((v) => !v)}
          disabled={globalBusy || !deck.cards.length}
          title="换强调色：角标、色条、页码、加粗词等点缀色跟随，选后整组重渲"
          className={`whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40 ${showAccent ? 'bg-panel-3 text-ink' : ''}`}
        >
          🎨 强调色
          <span
            className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
            style={{ background: deck.accent || (deck.format === 'wechat' ? '#b0803c' : '#ff2e63') }}
          />
        </button>
        {archived ? (
          <button onClick={() => void switchFormat()} disabled={globalBusy} title={`直接换回已有的${otherLabel}版本，不重新生成不花 token；当前版同步存档`} className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
            ⇄ 切回{otherLabel}
          </button>
        ) : (
          <button onClick={restyle} disabled={globalBusy || !deck.cards.length} title="张数与背图保留，文案改写成另一平台风格；原版自动存档可随时切回" className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
            ⇄ 转成{otherLabel}
          </button>
        )}
        <button onClick={() => void refine()} disabled={globalBusy || !deck.cards.length} title="逐张润色标题与要点，并生成贴题的封面角标；背图、透出、深色、字号设置保留；逐张点评请用右栏「审阅」" className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
          ✨ AI 优化
        </button>
        <button onClick={toArticle} disabled={globalBusy || !deck.cards.length} className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
          📄 扩写成文章
        </button>
        {hasArticle && (
          <button onClick={backToArticle} disabled={globalBusy} title="不重新生成，直接切回已有正文；卡片数据保留可随时切回来" className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
            ↩ 回到文章
          </button>
        )}
        <button
          onClick={pushToDraft}
          disabled={globalBusy || pushing || !deck.cards.length}
          title="以图片消息形态推送到公众号草稿箱（读者可左右滑动看图）；推送账号按工程所属分类的绑定决定，账号在「设置-推送设置」里管理"
          className="whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40"
        >
          {pushing ? '⏳ 推送中…' : '📮 推送草稿箱'}
        </button>
        <button onClick={openFolder} className="ml-auto whitespace-nowrap rounded px-2 py-0.5 hover:bg-panel-3" title="渲染好的 PNG 按平台分目录存在工程 cards/ 下，直接取用发布">
          📂 打开图片文件夹
        </button>
      </div>

      {/* 强调色选色条：预设色卡 + 取色器自定义 + 恢复默认；选后整组重渲 */}
      {showAccent && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-panel-3 bg-panel-2 px-4 py-1.5 text-ink-dim">
          <span className="text-[10px]">强调色</span>
          {PRESET_ACCENTS.map((p) => (
            <button
              key={p.color}
              onClick={() => void setAccent(p.color)}
              disabled={globalBusy}
              title={p.name}
              className={`h-5 w-5 rounded-full border-2 disabled:opacity-40 ${deck.accent === p.color ? 'border-ink' : 'border-transparent hover:border-ink-dim'}`}
              style={{ background: p.color }}
            />
          ))}
          <label className="flex cursor-pointer items-center gap-1" title="自定义取色，选完点「应用」">
            <input
              type="color"
              value={customColor || deck.accent || '#4f8cff'}
              onChange={(e) => setCustomColor(e.target.value)}
              disabled={globalBusy}
              className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
            />
            <span className="text-[10px]">{customColor || '自定义'}</span>
          </label>
          {customColor && (
            <button onClick={() => void setAccent(customColor)} disabled={globalBusy} className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90 disabled:opacity-40">
              应用
            </button>
          )}
          {deck.accent && (
            <button onClick={() => void setAccent(null)} disabled={globalBusy} className="rounded px-2 py-0.5 hover:bg-panel-3 disabled:opacity-40">
              恢复默认
            </button>
          )}
        </div>
      )}

      {/* 长任务横幅 */}
      {busy && (
        <div className="flex items-center gap-2 border-b border-panel-3 bg-panel-2 px-4 py-1.5 text-ink-dim">
          <span className="animate-pulse">✦</span>
          <span className="min-w-0 flex-1 truncate">{busy}</span>
          <button onClick={() => abortRef.current?.()} className="rounded px-2 py-0.5 text-red-400 hover:bg-panel-3">
            停止
          </button>
        </div>
      )}

      {/* 卡片列表 */}
      <div className="selectable min-h-0 flex-1 overflow-auto p-4">
        {deck.cards.map((card, i) => (
          <div
            key={i}
            ref={(el) => {
              cardRefs.current[i] = el
            }}
            className="mb-3 flex gap-3 rounded-lg border border-panel-3 bg-panel-2 p-3"
          >
            {/* 预览缩略图 */}
            <div className="shrink-0">
              {card.png && renderingIdx !== i ? (
                <img
                  src={assetUrl(card.png)}
                  alt={card.title}
                  className="w-44 rounded border border-panel-3"
                  style={{ aspectRatio: '3 / 4', objectFit: 'cover' }}
                />
              ) : (
                <div
                  className="flex w-44 items-center justify-center rounded border border-dashed border-panel-3 text-ink-dim"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  {renderingIdx === i ? '渲染中…' : '未渲染'}
                </div>
              )}
            </div>
            {/* 编辑区 */}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2 text-ink-dim">
                <span className="rounded bg-panel-3 px-1.5 py-0.5 text-[10px]">
                  {i === 0 ? '封面' : i === deck.cards.length - 1 ? '尾卡' : `第 ${i + 1} 张`}
                </span>
                {card.mode === 'ai' ? (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">AI 成图</span>
                ) : (
                  card.bgImage && <span className="text-[10px]">已有背图</span>
                )}
                <span className="ml-auto flex gap-1">
                  <button onClick={() => moveCard(i, -1)} disabled={globalBusy || i === 0} title="上移" className="rounded px-1.5 py-0.5 hover:bg-panel-3 disabled:opacity-30">
                    ↑
                  </button>
                  <button onClick={() => moveCard(i, 1)} disabled={globalBusy || i === deck.cards.length - 1} title="下移" className="rounded px-1.5 py-0.5 hover:bg-panel-3 disabled:opacity-30">
                    ↓
                  </button>
                  <button onClick={() => insertCard(i)} disabled={globalBusy} title="在此卡下方插入新卡片" className="rounded px-1.5 py-0.5 hover:bg-panel-3 hover:text-accent disabled:opacity-30">
                    ＋
                  </button>
                  <button onClick={() => deleteCard(i)} disabled={globalBusy} title="删除" className="rounded px-1.5 py-0.5 hover:bg-panel-3 hover:text-red-400 disabled:opacity-30">
                    ✕
                  </button>
                </span>
              </div>
              {i === 0 && (
                <input
                  value={card.tag ?? ''}
                  onChange={(e) => editCard(i, { tag: e.target.value })}
                  disabled={globalBusy}
                  placeholder="封面角标，如「续航真相」；留空用平台默认文案"
                  className="w-full rounded bg-panel-3 px-2 py-1.5 text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
                />
              )}
              <input
                value={card.title}
                onChange={(e) => editCard(i, { title: e.target.value })}
                disabled={globalBusy}
                placeholder="卡片标题"
                className="w-full rounded bg-panel-3 px-2 py-1.5 font-bold text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
              />
              <textarea
                value={card.body}
                onChange={(e) => editCard(i, { body: e.target.value })}
                disabled={globalBusy}
                rows={4}
                placeholder={'正文要点，每行一条，重点词可用 **加粗**'}
                className="w-full resize-y rounded bg-panel-3 p-2 leading-5 text-ink outline-none placeholder:text-ink-dim disabled:opacity-50"
              />
              <textarea
                value={card.bgPrompt}
                onChange={(e) => editCard(i, { bgPrompt: e.target.value })}
                disabled={globalBusy}
                rows={2}
                placeholder="背图画面描述（氛围底图，不含文字元素；留空则纯排版底色）"
                className="w-full resize-y rounded bg-panel-3 p-2 leading-5 text-ink-dim outline-none placeholder:text-ink-dim disabled:opacity-50"
              />
              {card.bgImage && card.mode !== 'ai' && (
                <div className="flex items-center gap-2 text-ink-dim">
                  <span className="shrink-0 text-[10px]">背图透出</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={card.bgOpacity ?? 15}
                    onChange={(e) => editCard(i, { bgOpacity: Number(e.target.value) })}
                    onMouseUp={() => void renderOne(i)}
                    disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                    className="flex-1 accent-accent"
                    title="拖动调背图透出强度，松手自动重渲染；越大背图越清晰、文字遮罩越淡"
                  />
                  <span className="w-8 shrink-0 text-right text-[10px]">{card.bgOpacity ?? 15}%</span>
                </div>
              )}
              {card.mode !== 'ai' && (
                <div className="flex items-center gap-2 text-ink-dim">
                  <span className="shrink-0 text-[10px]">文字大小</span>
                  <input
                    type="range"
                    min={80}
                    max={150}
                    step={5}
                    value={card.fontScale ?? 100}
                    onChange={(e) => editCard(i, { fontScale: Number(e.target.value) })}
                    onMouseUp={() => void renderOne(i)}
                    disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                    className="flex-1 accent-accent"
                    title="文字少、显得空时调大字号，松手自动重渲染；只缩放字号不动版式"
                  />
                  <span className="w-8 shrink-0 text-right text-[10px]">{card.fontScale ?? 100}%</span>
                </div>
              )}
              {card.mode !== 'ai' && (
                <div className="flex items-center gap-4">
                  <label className="flex w-fit cursor-pointer items-center gap-1.5 text-[10px] text-ink-dim" title="背图偏深时勾选：底色变深、文字切浅色，看得清">
                    <input
                      type="checkbox"
                      checked={Boolean(card.dark)}
                      onChange={(e) => void toggleDark(i, e.target.checked)}
                      disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                      className="accent-accent"
                    />
                    深色底反白
                  </label>
                  {i > 0 && (
                    <label className="flex w-fit cursor-pointer items-center gap-1.5 text-[10px] text-ink-dim" title="每条要点前加 01/02 强调色编号，步骤清单更清晰">
                      <input
                        type="checkbox"
                        checked={Boolean(card.numbered)}
                        onChange={(e) => void toggleNumbered(i, e.target.checked)}
                        disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                        className="accent-accent"
                      />
                      要点序号
                    </label>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => genBg(i)}
                  disabled={globalBusy || bgBusy !== null || aiBusy !== null || card.mode === 'ai' || !card.bgPrompt.trim()}
                  className="rounded bg-accent px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-40"
                >
                  {bgBusy === i ? '背图生成中…' : '🎨 生成背图'}
                </button>
                <button
                  onClick={() => genAiFull(i)}
                  disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                  title="AI 一次画出整张成品卡（文字直接画进图里），不走排版模板；风格取背图描述"
                  className="rounded bg-panel-3 px-2.5 py-1 text-ink hover:bg-panel disabled:opacity-40"
                >
                  {aiBusy === i ? 'AI 成图中…' : '🪄 AI 直接成图'}
                </button>
                {card.mode === 'ai' && (
                  <button
                    onClick={() => void restoreLayout(i)}
                    disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                    title="切回排版+背图渲染；成图文件保留"
                    className="rounded bg-panel-3 px-2.5 py-1 text-ink hover:bg-panel disabled:opacity-40"
                  >
                    ↩ 恢复排版
                  </button>
                )}
                <button
                  onClick={() => renderOne(i)}
                  disabled={globalBusy || bgBusy !== null || aiBusy !== null}
                  className="rounded bg-panel-3 px-2.5 py-1 text-ink hover:bg-panel disabled:opacity-40"
                >
                  🔄 重渲染
                </button>
              </div>
            </div>
          </div>
        ))}
        {/* 卡片全删光后的兜底入口：平时加卡用每张卡操作行的「＋」 */}
        {!deck.cards.length && (
          <button onClick={addCard} disabled={globalBusy} className="mx-auto block rounded border border-dashed border-panel-3 px-4 py-2 text-ink-dim hover:border-accent hover:text-accent disabled:opacity-40">
            ➕ 新建第一张卡片
          </button>
        )}

        {/* 发布配文：带话题标签，发图时直接复制 */}
        {deck.cards.length > 0 && (
          <div className="mt-1 rounded-lg border border-panel-3 bg-panel-2 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-bold text-ink">🏷 发布配文</span>
              <span className="text-ink-dim">带话题标签，发图时直接复制粘贴</span>
              <button onClick={() => void genCaption()} disabled={globalBusy} className="ml-auto whitespace-nowrap rounded bg-accent px-2 py-0.5 text-white hover:opacity-90 disabled:opacity-40">
                {deck.caption?.trim() ? '✨ 重新生成' : '✨ 生成配文'}
              </button>
              {deck.caption?.trim() && (
                <button onClick={() => void copyCaption()} className="whitespace-nowrap rounded bg-panel-3 px-2 py-0.5 text-ink hover:bg-panel">
                  📋 复制
                </button>
              )}
            </div>
            <textarea
              value={deck.caption ?? ''}
              onChange={(e) => editCaption(e.target.value)}
              placeholder="点「生成配文」让 AI 按当前平台写一段带话题标签的发图文案，也可手动填写"
              rows={4}
              className="w-full resize-y rounded bg-panel-3 p-2 text-ink outline-none placeholder:text-ink-dim"
            />
          </div>
        )}
      </div>
    </div>
  )
})

export default CardsPanel
