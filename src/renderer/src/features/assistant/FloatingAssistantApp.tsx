import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  NotePosterSummary,
  RecommendationKind,
  VideoAudioTranscriptionProgress,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CoinPrompt } from './CoinPrompt'
import { CommentChooser } from './CommentChooser'
import { CommentIntentDialog } from './CommentIntentDialog'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import { VideoNoteArchivePanel } from '../notes/VideoNoteArchivePanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

const CURRENT_TITLE = '早八生存实录'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const VIDEO_CATEGORY_LABELS: Record<RecommendationKind, string> = {
  funny: '娱乐',
  humor: '娱乐',
  story: '小剧场',
  play: '游戏',
  life: '生活',
  craft: '科技数码',
  suspicious: '待确认'
}

type AssistantWorkspaceTab = 'review' | 'notes' | 'ledger' | 'settings'
type AssistantWorkspaceView = AssistantWorkspaceTab | 'noteArchive'

const WORKSPACE_TABS: Array<{
  id: AssistantWorkspaceTab
  label: string
  icon: string
  iconAlt: string
}> = [
  { id: 'review', label: '批阅', icon: hintPetUrl, iconAlt: '小咪批阅' },
  { id: 'notes', label: '札记', icon: workingPetUrl, iconAlt: '小咪札记' },
  { id: 'ledger', label: '掌库', icon: clickedPetUrl, iconAlt: '小咪掌库' },
  { id: 'settings', label: '设置', icon: idlePetUrl, iconAlt: '小咪设置' }
]

type FloatingAssistantAppProps = {
  mode?: 'floating' | 'sidebar'
  activeTab?: AssistantWorkspaceTab
  onActiveTabChange?: (tab: AssistantWorkspaceTab) => void
  onRequestCollapse?: () => void
}

type ActionFeedback = {
  tone: 'progress' | 'success' | 'error'
  message: string
  steps: string[]
  missingTargets: string[]
}

const ACTION_PROGRESS_HINTS: Record<AssistantAction, string> = {
  赏: '主人，小咪正在帮这支视频点个喜欢～',
  藏: '主人，小咪正在把它收进合适的 Bilimi 分册～',
  赐: '主人，小咪正在把硬币准备好～',
  表: '主人，小咪正在备好短评候选，等你拍板～',
  阅: '主人，小咪正在登记已阅～'
}

const ACTION_SUCCESS_HINTS: Record<AssistantAction, string> = {
  赏: '做好啦，喜欢和分册都替主人处理好了～',
  藏: '收好啦，这支视频已经进 Bilimi 分册了。',
  赐: '投币完成啦，小咪给这份喜欢盖章了～',
  表: '短评已经送出啦，还是由主人选中的那句。',
  阅: '已阅登记完成，主人可以继续看下一支啦。'
}

const ACTION_ERROR_HINTS: Record<AssistantAction, string> = {
  赏: '主人，这次点赞归册没跑顺，小咪需要你看一眼提示。',
  藏: '主人，收藏归册遇到问题了，小咪把原因放在面板里。',
  赐: '主人，投币这一步卡住了，小咪把错误留给你看。',
  表: '主人，短评流程没完成，小咪把问题同步出来了。',
  阅: '主人，已阅登记失败了，小咪把细节放在提示里。'
}

const TAB_HINTS: Record<AssistantWorkspaceTab, string> = {
  review: '小咪切到批阅啦，当前视频的操作都在这里。',
  notes: '小咪切到札记啦，可以转写、整理和存档。',
  ledger: '小咪切到掌库啦，Bilimi 分册在这里管理。',
  settings: '小咪切到设置啦，宠物和 DeepSeek 都在这里调。'
}

function createFallbackSnapshot(): AssistantSnapshot {
  const preferences = createInitialAssistantPreferences()

  return {
    preferences,
    favoriteLedgerStatus: null,
    videoContentContext: { title: CURRENT_TITLE },
    videoTitle: CURRENT_TITLE
  }
}

function stripBilimiPrefix(displayName: string) {
  return displayName.replace(/^Bilimi[·\s-]*/, '').trim()
}

function normalizeTitle(title: string) {
  return title.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
}

function createDefaultResult(message: string): AssistantAutomationResult {
  return {
    ok: true,
    steps: [],
    missingTargets: [],
    message
  }
}

function createPetHintMessage(message: string) {
  const trimmed = message.trim()
  if (!trimmed) {
    return '主人，小咪已经同步到这里啦。'
  }

  if (/^(主人|小咪)/.test(trimmed)) {
    return trimmed
  }

  return `主人，${trimmed}`
}

function localizeDeepSeekStatusMessage(message: string): string {
  if (message === 'DeepSeek connection succeeded.') {
    return 'DeepSeek 连接成功。'
  }

  if (message === 'DeepSeek connection failed.') {
    return 'DeepSeek 连接失败。'
  }

  if (message === 'DeepSeek is not configured.') {
    return '请先启用 DeepSeek 并填写 API 密钥。'
  }

  return message
    .replace(/^DeepSeek API request failed:/, 'DeepSeek API 请求失败：')
    .replace(/^DeepSeek response did not include any content\.$/, 'DeepSeek 响应没有返回内容。')
    .replace(/^DeepSeek response could not be parsed\.$/, 'DeepSeek 响应解析失败。')
    .replace(/^DeepSeek response schema was invalid\.$/, 'DeepSeek 响应格式无效。')
}

function applyPosterSummaryToNote(note: VideoNote, poster: NotePosterSummary): VideoNote {
  const summaryLines = [poster.subtitle, ...poster.keyPoints]
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    ...note,
    overview: {
      ...note.overview,
      shortSummary: summaryLines.length > 0 ? summaryLines : note.overview.shortSummary,
      keywords: poster.keywords.length > 0 ? poster.keywords : note.overview.keywords
    },
    updatedAt: new Date().toISOString()
  }
}

export function FloatingAssistantApp({
  mode = 'floating',
  activeTab: controlledActiveTab,
  onActiveTabChange,
  onRequestCollapse
}: FloatingAssistantAppProps = {}) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const [favoriteLedgerStatus, setFavoriteLedgerStatus] = useState<FavoriteLedgerStatus | null>(null)
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<AssistantWorkspaceTab>('review')
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [commentIntentOpen, setCommentIntentOpen] = useState(false)
  const [commentIntentBusy, setCommentIntentBusy] = useState(false)
  const [commentIntentError, setCommentIntentError] = useState('')
  const [aiCommentDrafts, setAiCommentDrafts] = useState<string[]>([])
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [pageClickOnly, setPageClickOnly] = useState(true)
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteArchives, setVideoNoteArchives] = useState<VideoNoteArchiveEntry[]>([])
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<VideoAudioTranscriptionProgress | null>(null)
  const [deepSeekApiKeyDraft, setDeepSeekApiKeyDraft] = useState('')
  const [deepSeekStatusMessage, setDeepSeekStatusMessage] = useState('')
  const mounted = useRef(false)
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const [activeView, setActiveView] = useState<AssistantWorkspaceView>(activeTab)
  const isSidebarMode = mode === 'sidebar'

  function tellPet(tone: ActionFeedback['tone'], message: string) {
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: tone === 'progress' ? 'working' : tone === 'error' ? 'error' : 'hint',
      message: createPetHintMessage(message)
    })
  }

  function setActiveTab(tab: AssistantWorkspaceTab) {
    setActiveView(tab)
    tellPet('success', TAB_HINTS[tab])

    if (controlledActiveTab === undefined) {
      setUncontrolledActiveTab(tab)
    }

    onActiveTabChange?.(tab)
  }

  const loadSnapshot = useCallback(async ({ resetVideoNote = false } = {}) => {
    try {
      const nextSnapshot =
        (await window.bilimiDesktop?.requestAssistantSnapshot?.()) ?? createFallbackSnapshot()

      if (!mounted.current) {
        return
      }

      setSnapshot(nextSnapshot)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)

      if (resetVideoNote) {
        setVideoNote(null)
      }
    } catch (error) {
      if (!mounted.current) {
        return
      }

      const fallback = createFallbackSnapshot()
      setSnapshot(fallback)
      setPreferences(fallback.preferences)
      setFavoriteLedgerStatus(fallback.favoriteLedgerStatus)
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取当前视频时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
    }
  }, [])

  useEffect(() => {
    setActiveView(activeTab)
  }, [activeTab])

  useEffect(() => {
    mounted.current = true

    void loadSnapshot()
    void loadVideoNoteArchives({ silent: true })

    return () => {
      mounted.current = false
    }
  }, [loadSnapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantSnapshotChanged?.(() => {
      void loadSnapshot({ resetVideoNote: true })
    })
  }, [loadSnapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onVideoAudioTranscriptionProgress?.((progress) => {
      setTranscriptionProgress(progress)
    })
  }, [])

  const resolvedSnapshot = snapshot ?? createFallbackSnapshot()
  const resolvedVideoTitle = normalizeTitle(resolvedSnapshot.videoTitle)
  const resolvedVideoAuthor = resolvedSnapshot.videoContentContext.author?.trim()
  const currentClassification = useMemo(
    () => classifyVideoContent(resolvedSnapshot.videoContentContext, preferences.favoriteLedgers),
    [preferences.favoriteLedgers, resolvedSnapshot.videoContentContext]
  )
  const currentKind = currentClassification.ledgerId
  const recommendation = useMemo(() => describeRecommendation(currentKind), [currentKind])
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle, resolvedVideoAuthor),
    [currentKind, resolvedVideoAuthor, resolvedVideoTitle]
  )
  const activeCommentDrafts = aiCommentDrafts.length > 0 ? aiCommentDrafts : commentDrafts
  const videoCategory =
    VIDEO_CATEGORY_LABELS[currentKind] || stripBilimiPrefix(currentClassification.displayName) || currentKind
  const actionsLocked =
    runningAction !== null ||
    coinPromptOpen ||
    commentChooserOpen ||
    commentIntentOpen ||
    commentIntentBusy

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    setPreferences(nextPreferences)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  function choosePetStyle(petStyle: AssistantPreferences['petStyle']) {
    tellPet('success', petStyle === 'big-head' ? '小咪换回萌版大头啦～' : '小咪换成Q版小人啦～')
    void persistPreferences({
      ...preferences,
      petStyle
    })
  }

  function wakeAssistantPet() {
    tellPet('success', '小咪醒着呢，随时陪主人看视频。')
    void window.bilimiDesktop?.wakeAssistantPet?.()
  }

  function closeAssistantPet() {
    tellPet('success', '小咪先收起来，需要时再叫我就好。')
    window.bilimiDesktop?.closeAssistantPet?.()
  }

  function updateDeepSeekPreference(patch: Partial<AssistantPreferences>) {
    setPreferences((current) => ({
      ...current,
      ...patch
    }))
  }

  async function saveDeepSeekSettings() {
    const keyDraft = deepSeekApiKeyDraft.trim()

    tellPet('progress', '小咪正在保存 DeepSeek 设置。')

    if (keyDraft) {
      await window.bilimiDesktop?.saveDeepSeekApiKey?.(keyDraft)
    }

    await persistPreferences(preferences)
    tellPet('success', 'DeepSeek 设置保存好啦。')
  }

  async function testDeepSeekConnection() {
    if (!window.bilimiDesktop?.testDeepSeekConnection) {
      setDeepSeekStatusMessage('DeepSeek 测试功能未加载，请重启应用后再试。')
      tellPet('error', 'DeepSeek 测试功能还没加载好。')
      return
    }

    tellPet('progress', '小咪正在测试 DeepSeek 连接。')
    await saveDeepSeekSettings()
    const result = await window.bilimiDesktop.testDeepSeekConnection()
    const statusMessage = localizeDeepSeekStatusMessage(result.message)
    setDeepSeekStatusMessage(statusMessage)
    tellPet(result.ok ? 'success' : 'error', statusMessage)
  }

  async function resetDeepSeekSettings() {
    const nextPreferences = {
      ...preferences,
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL
    }

    setDeepSeekApiKeyDraft('')
    await window.bilimiDesktop?.clearDeepSeekApiKey?.()
    await persistPreferences(nextPreferences)
    setDeepSeekStatusMessage('DeepSeek 设置已重置。')
    tellPet('success', 'DeepSeek 设置已经重置，小咪回到本地提示模式啦。')
  }

  async function copyDeepSeekRecommendation(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setDeepSeekStatusMessage(`已复制${label}。`)
      tellPet('success', `${label}已复制好啦。`)
    } catch {
      setDeepSeekStatusMessage(`${label}复制失败，请手动复制。`)
      tellPet('error', `${label}复制失败，请主人手动复制。`)
    }
  }

  async function persistFeedback(action: AssistantAction, kind: RecommendationKind) {
    const nextPreferences = recordAssistantPreferenceFeedback(preferences, kind, action)
    await persistPreferences(nextPreferences)
  }

  async function generateCommentDrafts(intent = '') {
    setCommentIntentBusy(true)
    setCommentIntentError('')

    try {
      const result = await window.bilimiDesktop?.generateDeepSeek?.({
        kind: 'review-comment',
        intent,
        title: resolvedVideoTitle,
        author: resolvedVideoAuthor,
        description: resolvedSnapshot.videoContentContext.description,
        tags: resolvedSnapshot.videoContentContext.tags ?? [],
        classification: currentClassification.displayName || currentKind
      })

      if (!result || result.kind !== 'review-comment') {
        throw new Error('Comment generation failed.')
      }

      setAiCommentDrafts(result.comments)
      setCommentIntentOpen(false)
      setCommentChooserOpen(true)
    } catch (error) {
      setAiCommentDrafts([])
      setCommentIntentOpen(false)
      setCommentChooserOpen(true)
    } finally {
      setCommentIntentBusy(false)
    }
  }

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
    if (runningAction) {
      return
    }

    setRunningAction(action)
    window.bilimiDesktop?.setAssistantPetState?.('working')
    tellPet('progress', ACTION_PROGRESS_HINTS[action])
    setFeedback({
      tone: 'progress',
      message: action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。',
      steps: [],
      missingTargets: []
    })

    try {
      const result =
        (await window.bilimiDesktop?.runAssistantAction?.(action, {
          ...options,
          pageClickOnly
        })) ?? createDefaultResult('此折已阅。')

      if (result.ok && action !== '阅') {
        await persistFeedback(action, currentKind)
      }

      setFeedback({
        tone: result.ok ? 'success' : 'error',
        message: result.message,
        steps: result.steps,
        missingTargets: result.missingTargets
      })
      tellPet(
        result.ok ? 'success' : 'error',
        result.ok ? ACTION_SUCCESS_HINTS[action] : ACTION_ERROR_HINTS[action]
      )
      window.bilimiDesktop?.setAssistantPetState?.(result.ok ? 'hint' : 'error')
    } catch (error) {
      const message = error instanceof Error ? error.message : '代批时遇到未知差错。'
      setFeedback({
        tone: 'error',
        message,
        steps: [],
        missingTargets: []
      })
      tellPet('error', message)
      window.bilimiDesktop?.setAssistantPetState?.('error')
    } finally {
      setRunningAction(null)
    }
  }

  function handleAction(action: AssistantAction) {
    if (actionsLocked) {
      return
    }

    setFeedback(null)

    if (action === '赐') {
      tellPet('success', '主人，先选要投几枚硬币，小咪等你确认。')
      setCoinPromptOpen(true)
      return
    }

    if (action === '表') {
      setAiCommentDrafts([])
      setCommentIntentError('')
      if (!preferences.deepseekEnabled) {
        tellPet('success', 'DeepSeek 没开也没关系，小咪先给你本地短评候选。')
        setCommentChooserOpen(true)
        return
      }
      tellPet('progress', ACTION_PROGRESS_HINTS[action])
      void generateCommentDrafts()
      return
    }

    void runAction(action)
  }

  async function generateVideoNote(manualTranscript?: string) {
    setVideoNoteLoading(true)
    tellPet('progress', manualTranscript ? '小咪正在把粘贴的文稿整理成札记。' : '小咪正在生成当前视频札记。')

    try {
      const note = (await window.bilimiDesktop?.generateVideoNote?.(manualTranscript)) ?? null
      setVideoNote(note)
      tellPet(note ? 'success' : 'error', note ? '札记整理好了，主人可以检查啦。' : '小咪没拿到可用札记结果。')
      return note
    } catch (error) {
      tellPet('error', error instanceof Error ? error.message : '札记生成遇到问题。')
      throw error
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function generateVideoNoteFromAudio() {
    setVideoNoteLoading(true)
    tellPet('progress', '小咪正在转写音频并整理札记，这一步可能要等一下。')

    try {
      const note = (await window.bilimiDesktop?.generateVideoNoteFromAudio?.()) ?? null
      let noteToStore = note

      if (noteToStore && preferences.deepseekEnabled) {
        const poster = await generateNotePoster(noteToStore)
        noteToStore = applyPosterSummaryToNote(noteToStore, poster)
      }

      setVideoNote(noteToStore)
      tellPet(
        noteToStore ? 'success' : 'error',
        noteToStore ? '音频札记整理好了，小咪也帮你存档啦。' : '小咪没拿到可用的音频札记。'
      )

      if (noteToStore) {
        const archives = await window.bilimiDesktop?.saveVideoNoteArchiveVersion?.(noteToStore)

        if (archives) {
          setVideoNoteArchives(archives)
        }
      }

      return noteToStore
    } catch (error) {
      tellPet('error', error instanceof Error ? error.message : '转写音频时遇到问题。')
      throw error
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function generateNotePoster(note: VideoNote) {
    tellPet('progress', '小咪正在整理一图流总结。')
    const result = await window.bilimiDesktop?.generateDeepSeek?.({ kind: 'note-poster', note })

    if (!result || result.kind !== 'note-poster') {
      tellPet('error', '一图流总结没有生成成功。')
      throw new Error('Poster generation failed.')
    }

    tellPet('success', '一图流总结做好啦。')
    return result.poster
  }

  async function loadVideoNoteArchives({ silent = false } = {}) {
    if (!silent) {
      tellPet('progress', '小咪正在打开档案库。')
    }

    const archives = (await window.bilimiDesktop?.loadVideoNoteArchives?.()) ?? []
    setVideoNoteArchives(archives)

    if (!silent) {
      tellPet('success', '档案库已同步。')
    }

    return archives
  }

  async function deleteVideoNoteArchiveEntry(archiveId: string) {
    tellPet('progress', '小咪正在删除这份档案。')
    const archives = (await window.bilimiDesktop?.deleteVideoNoteArchiveEntry?.(archiveId)) ?? []
    setVideoNoteArchives(archives)
    tellPet('success', '这份档案已经删掉啦。')
  }

  async function deleteVideoNoteArchiveVersion(archiveId: string, versionId: string) {
    tellPet('progress', '小咪正在删除这个档案版本。')
    const archives =
      (await window.bilimiDesktop?.deleteVideoNoteArchiveVersion?.(archiveId, versionId)) ?? []
    setVideoNoteArchives(archives)
    tellPet('success', '这个版本已经删掉啦。')
  }

  async function saveVideoNote(note: VideoNote) {
    await window.bilimiDesktop?.saveVideoNote?.(note)
    tellPet('success', '札记保存好了。')
  }

  function handleChangeVideoNote(note: VideoNote) {
    setVideoNote(note)
  }


  async function ensureFavoriteLedgers() {
    tellPet('progress', '小咪正在检查 Bilimi 分册是否齐全。')
    const result =
      (await window.bilimiDesktop?.ensureFavoriteLedgers?.()) ?? createDefaultResult('册目已备齐。')
    const nextSnapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()

    if (nextSnapshot) {
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
    }

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
  }

  async function saveFavoriteLedgers(favoriteLedgers: AssistantPreferences['favoriteLedgers']) {
    tellPet('progress', '小咪正在同步掌库册目。')
    const result =
      (await window.bilimiDesktop?.saveFavoriteLedgers?.(favoriteLedgers)) ??
      createDefaultResult('掌库已同步。')
    const nextSnapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()

    if (nextSnapshot) {
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
    } else {
      await persistPreferences({
        ...preferences,
        favoriteLedgers
      })
    }

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
  }

  async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
    tellPet('progress', '小咪正在扫描旧收藏夹。')
    const preview =
      (await window.bilimiDesktop?.scanOldFavorites?.()) ?? {
        items: [],
        skippedSourceFolderTitles: []
      }

    tellPet('success', preview.items.length > 0 ? '旧藏扫描好了，小咪列出可归册项目。' : '旧藏扫描好了，暂时没有需要归册的项目。')
    return preview
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    tellPet('progress', '小咪正在按计划归整旧藏。')
    const result =
      (await window.bilimiDesktop?.executeOldFavoritePlan?.(items)) ??
      createDefaultResult('旧藏已归册。')

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
  }

  function closeAssistant() {
    tellPet('success', isSidebarMode ? '侧栏先收起来，小咪还在旁边。' : '悬浮助手先合上啦。')
    if (isSidebarMode) {
      onRequestCollapse?.()
      return
    }

    window.bilimiDesktop?.closeFloatingAssistant?.()
  }

  const workspace = (
    <section className={isSidebarMode ? 'assistant-sidebar-workspace' : 'floating-assistant-workspace'}>
        <div className="floating-assistant-tabs" role="tablist" aria-label="助手功能">
          {WORKSPACE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <img className="floating-assistant-tabs__pet" src={tab.icon} alt={tab.iconAlt} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {activeView === 'ledger' ? (
          <FavoriteLedgerPanel
            ledgers={preferences.favoriteLedgers}
            missingLedgerIds={favoriteLedgerStatus?.missingLedgerIds ?? []}
            onEnsureLedgers={ensureFavoriteLedgers}
            onSaveLedgers={saveFavoriteLedgers}
            onScanOldFavorites={scanOldFavorites}
            onExecuteOldFavoritePlan={executeOldFavoritePlan}
          />
        ) : activeView === 'settings' ? (
          <section className="assistant-settings" aria-label="助手设置">
            <header>
              <h2>设置</h2>
            </header>
            <fieldset className="assistant-settings__group">
              <legend>宠物样式</legend>
              <label>
                <input
                  type="radio"
                  name="pet-style"
                  checked={preferences.petStyle === 'big-head'}
                  onChange={() => choosePetStyle('big-head')}
                />
                <span>萌版大头</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="pet-style"
                  checked={preferences.petStyle === 'classic'}
                  onChange={() => choosePetStyle('classic')}
                />
                <span>Q版小人</span>
              </label>
              <div className="assistant-settings__pet-actions">
                <button type="button" onClick={wakeAssistantPet}>
                  唤醒宠物
                </button>
                <button type="button" onClick={closeAssistantPet}>
                  关闭宠物
                </button>
              </div>
            </fieldset>
            <fieldset className="assistant-settings__group assistant-settings__group--deepseek">
              <legend>DeepSeek</legend>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.deepseekEnabled}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekEnabled: event.currentTarget.checked })
                  }
                />
                <span>启用 DeepSeek</span>
              </label>
              <p className="assistant-settings__deepseek-help">
                开启后可使用批阅的拟奏短评、札记中的一图流总结、宠物对话功能。
              </p>
              <label>
                <span>DeepSeek API 密钥</span>
                <input
                  type="password"
                  value={deepSeekApiKeyDraft}
                  placeholder={preferences.deepseekApiKeyStored ? '已保存' : ''}
                  onChange={(event) => setDeepSeekApiKeyDraft(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>DeepSeek 模型</span>
                <input
                  type="text"
                  value={preferences.deepseekModel}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekModel: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>DeepSeek 服务地址</span>
                <input
                  type="url"
                  value={preferences.deepseekBaseUrl}
                  onChange={(event) =>
                    updateDeepSeekPreference({ deepseekBaseUrl: event.currentTarget.value })
                  }
                />
              </label>
              <div className="assistant-settings__actions">
                <button type="button" onClick={() => void saveDeepSeekSettings()}>
                  保存 DeepSeek
                </button>
                <button type="button" onClick={() => void testDeepSeekConnection()}>
                  测试 DeepSeek
                </button>
                <button type="button" onClick={() => void resetDeepSeekSettings()}>
                  重置 DeepSeek
                </button>
              </div>
              <aside className="assistant-settings__deepseek-recommendation">
                <strong>中转站推荐</strong>
                <p>
                  <a href="https://yunshulink.com/" target="_blank" rel="noreferrer">
                    云枢智元
                  </a>
                  <span>大模型token，官网两折起</span>
                </p>
                <p>API 密钥：创建令牌后，令牌分组请选择 deepseek（限时特价），复制密钥到这里使用。</p>
                <p className="assistant-settings__copy-row">
                  <span>推荐模型：deepseek-v4-pro</span>
                  <button
                    className="assistant-settings__copy-button"
                    type="button"
                    aria-label="复制推荐模型"
                    onClick={() => void copyDeepSeekRecommendation('deepseek-v4-pro', '推荐模型')}
                  >
                    <span className="assistant-settings__copy-icon" aria-hidden="true" />
                  </button>
                </p>
                <p className="assistant-settings__copy-row">
                  <span>服务器地址：https://api.yunshulink.com/v1</span>
                  <button
                    className="assistant-settings__copy-button"
                    type="button"
                    aria-label="复制服务器地址"
                    onClick={() =>
                      void copyDeepSeekRecommendation(
                        'https://api.yunshulink.com/v1',
                        '服务器地址'
                      )
                    }
                  >
                    <span className="assistant-settings__copy-icon" aria-hidden="true" />
                  </button>
                </p>
              </aside>
              {deepSeekStatusMessage ? <p role="status">{deepSeekStatusMessage}</p> : null}
            </fieldset>
          </section>
        ) : activeView === 'noteArchive' ? (
          <VideoNoteArchivePanel
            archives={videoNoteArchives}
            onClose={() => setActiveTab('notes')}
            onOpenSource={(url) => window.open(url)}
            onDeleteEntry={deleteVideoNoteArchiveEntry}
            onDeleteVersion={deleteVideoNoteArchiveVersion}
          />
        ) : (
          <MemorialPanel
            recommendation={recommendation}
            commentDrafts={commentDrafts}
            deepSeekEnabled={preferences.deepseekEnabled}
            videoCategory={videoCategory}
            videoTitle={resolvedVideoTitle}
            onAction={handleAction}
            onClose={closeAssistant}
            closeLabel={isSidebarMode ? '收起侧栏' : '合折'}
            showCloseButton={!isSidebarMode}
            onGenerateVideoNote={generateVideoNote}
            onTranscribeVideoAudio={generateVideoNoteFromAudio}
            onGeneratePoster={generateNotePoster}
            onSaveVideoNote={saveVideoNote}
            onChangeVideoNote={handleChangeVideoNote}
            pageClickOnly={pageClickOnly}
            onPageClickOnlyChange={setPageClickOnly}
            videoNote={videoNote}
            videoNoteLoading={videoNoteLoading}
            transcriptionProgress={transcriptionProgress}
            runningAction={runningAction}
            actionsLocked={actionsLocked}
            feedback={feedback}
            onOpenVideoNoteArchive={() => {
              void loadVideoNoteArchives()
              setActiveView('noteArchive')
            }}
            initialTab={activeView === 'notes' ? 'notes' : 'review'}
            showTabs={false}
          />
        )}

        {coinPromptOpen ? (
          <CoinPrompt
            onChoose={(coinCount) => {
              setCoinPromptOpen(false)
              void runAction('赐', { coinCount })
            }}
            onCancel={() => setCoinPromptOpen(false)}
          />
        ) : null}

        {commentIntentOpen ? (
          <CommentIntentDialog
            busy={commentIntentBusy}
            error={commentIntentError}
            onSubmit={(intent) => void generateCommentDrafts(intent)}
            onCancel={() => {
              setCommentIntentOpen(false)
              setCommentIntentError('')
              setAiCommentDrafts([])
            }}
          />
        ) : null}

        {commentChooserOpen ? (
          <CommentChooser
            drafts={activeCommentDrafts}
            onSelect={(commentDraft) => {
              setCommentChooserOpen(false)
              setAiCommentDrafts([])
              void runAction('表', { commentDraft })
            }}
            onCancel={() => {
              setCommentChooserOpen(false)
              setAiCommentDrafts([])
            }}
          />
        ) : null}
    </section>
  )

  if (isSidebarMode) {
    return (
      <div className="assistant-sidebar-embed" aria-label="Bilimi 应用侧栏">
        {workspace}
      </div>
    )
  }

  return (
    <main className="floating-assistant-shell" aria-label="Bilimi 悬浮助手">
      {workspace}
    </main>
  )
}
