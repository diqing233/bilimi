import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  NotePosterSummary,
  RecommendationKind,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import {
  PET_HOVER_SHORTCUTS,
  PET_HOVER_SHORTCUT_LIMIT,
  normalizePetHoverShortcuts,
  type PetHoverShortcutId
} from '@shared/petHoverShortcuts'
import { createNotePosterText } from '@shared/videoNoteArchive'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeVideoClassificationRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CommentChooser } from './CommentChooser'
import { CommentIntentDialog } from './CommentIntentDialog'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import { VideoNoteArchivePanel } from '../notes/VideoNoteArchivePanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import type { AssistantPetHint } from './petState'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'
import { PET_COLLAPSE_FAREWELL_LINES, pickPetLine } from './petInteractionLines'

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
  craft: '知识学习',
  suspicious: '待确认'
}

function pickRandomCommentDraft(drafts: string[]) {
  const index = Math.min(drafts.length - 1, Math.floor(Math.random() * drafts.length))
  return drafts[index] ?? ''
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
  onOpenInTab?: (url: string) => void
}

function findArchivedSummaryTextForNote(
  archives: VideoNoteArchiveEntry[],
  note: VideoNote | null
): string {
  if (!note) return ''

  const matchingVersion = archives
    .flatMap((archive) => archive.versions)
    .filter((version) => version.note.id === note.id && version.note.updatedAt === note.updatedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

  return matchingVersion?.summaryText.trim() ?? ''
}

type ActionFeedback = {
  tone: 'progress' | 'success' | 'error'
  message: string
  steps: string[]
  missingTargets: string[]
}

type PetFeedbackTone =
  | ActionFeedback['tone']
  | 'happy'
  | 'shy'
  | 'thinking'
  | 'cheer'
  | 'sleepy'
  | 'surprised'
  | 'done'

const PET_FEEDBACK_TONES: Record<PetFeedbackTone, AssistantPetHint['tone']> = {
  progress: 'working',
  success: 'happy',
  error: 'error',
  happy: 'happy',
  shy: 'shy',
  thinking: 'thinking',
  cheer: 'cheer',
  sleepy: 'sleepy',
  surprised: 'surprised',
  done: 'done'
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
    videoTitle: CURRENT_TITLE,
    activeTabUrl: ''
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
  onRequestCollapse,
  onOpenInTab
}: FloatingAssistantAppProps = {}) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const preferencesRef = useRef(preferences)
  const [favoriteLedgerStatus, setFavoriteLedgerStatus] = useState<FavoriteLedgerStatus | null>(null)
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<AssistantWorkspaceTab>('review')
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [commentIntentOpen, setCommentIntentOpen] = useState(false)
  const [commentIntentBusy, setCommentIntentBusy] = useState(false)
  const [commentIntentError, setCommentIntentError] = useState('')
  const [aiCommentDrafts, setAiCommentDrafts] = useState<string[]>([])
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteArchives, setVideoNoteArchives] = useState<VideoNoteArchiveEntry[]>([])
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<VideoAudioTranscriptionProgress | null>(null)
  const [transcriptionQueue, setTranscriptionQueue] = useState<VideoAudioTranscriptionQueueSnapshot>({
    items: []
  })
  const [deepSeekApiKeyDraft, setDeepSeekApiKeyDraft] = useState('')
  const [deepSeekStatusMessage, setDeepSeekStatusMessage] = useState('')
  const mounted = useRef(false)
  const lastPreferenceSaveAt = useRef(0)
  const transcriptionQueueRef = useRef<VideoAudioTranscriptionQueueSnapshot>({ items: [] })
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const [activeView, setActiveView] = useState<AssistantWorkspaceView>(activeTab)
  const isSidebarMode = mode === 'sidebar'

  function tellPet(tone: PetFeedbackTone, message: string) {
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: PET_FEEDBACK_TONES[tone],
      message: createPetHintMessage(message)
    })
  }

  function setActiveTab(tab: AssistantWorkspaceTab) {
    setFeedback(null)
    setCommentChooserOpen(false)
    setAiCommentDrafts([])
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
      const snapshotPreferences = createInitialAssistantPreferences(nextSnapshot.preferences)
      const snapshotArrivedSoonAfterSave = Date.now() - lastPreferenceSaveAt.current < 2000
      setPreferences((currentPreferences) => {
        const nextPreferences = snapshotArrivedSoonAfterSave
          ? {
              ...snapshotPreferences,
              defaultCoinCount: currentPreferences.defaultCoinCount,
              commentSubmitMode: currentPreferences.commentSubmitMode
            }
          : snapshotPreferences
        preferencesRef.current = nextPreferences
        return nextPreferences
      })
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
      preferencesRef.current = fallback.preferences
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
    preferencesRef.current = preferences
  }, [preferences])

  useEffect(() => {
    mounted.current = true

    void loadSnapshot()
    void loadVideoNoteArchives({ silent: true })
    void loadVideoAudioTranscriptionQueue()

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

  useEffect(() => {
    transcriptionQueueRef.current = transcriptionQueue
  }, [transcriptionQueue])

  useEffect(() => {
    return window.bilimiDesktop?.onVideoAudioTranscriptionQueueChanged?.((snapshot) => {
      const hadRunning = transcriptionQueueRef.current.items.some((item) => item.status === 'running')
      const hasRunning = snapshot.items.some((item) => item.status === 'running')

      transcriptionQueueRef.current = snapshot
      setTranscriptionQueue(snapshot)

      const activeDraftNote = snapshot.items.find(
        (item) => item.status === 'running' && item.draftNote
      )?.draftNote
      if (activeDraftNote) {
        setVideoNote(activeDraftNote)
        setActiveView('notes')
      }

      if (hadRunning && !hasRunning && snapshot.items.some((item) => item.status === 'completed')) {
        void syncCompletedQueuedVideoNote(snapshot)
      }
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
  const recommendation = useMemo(
    () => describeVideoClassificationRecommendation(currentClassification),
    [currentClassification]
  )
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle, resolvedVideoAuthor),
    [currentKind, resolvedVideoAuthor, resolvedVideoTitle]
  )
  const activeCommentDrafts = aiCommentDrafts.length > 0 ? aiCommentDrafts : commentDrafts
  const videoNoteArchivedSummaryText = useMemo(
    () => findArchivedSummaryTextForNote(videoNoteArchives, videoNote),
    [videoNote, videoNoteArchives]
  )
  const videoCategory =
    VIDEO_CATEGORY_LABELS[currentKind] || stripBilimiPrefix(currentClassification.displayName) || currentKind
  const actionsLocked =
    runningAction !== null ||
    commentIntentOpen ||
    commentIntentBusy
  const selectedPetHoverShortcuts = normalizePetHoverShortcuts(preferences.petHoverShortcuts)

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    preferencesRef.current = nextPreferences
    setPreferences(nextPreferences)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      const savedPreferences = createInitialAssistantPreferences(saved)
      preferencesRef.current = savedPreferences
      setPreferences(savedPreferences)
      lastPreferenceSaveAt.current = Date.now()
      window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
    }
  }

  function choosePetStyle(petStyle: AssistantPreferences['petStyle']) {
    tellPet('success', petStyle === 'big-head' ? '小咪换回萌版大头啦～' : '小咪换成Q版小人啦～')
    void persistPreferences({
      ...preferences,
      petStyle
    })
  }

  function toggleVideoFullscreenPetVisibility(hidePetDuringVideoFullscreen: boolean) {
    tellPet(
      'success',
      hidePetDuringVideoFullscreen
        ? '全屏看视频时，小咪会先让出画面。'
        : '小咪会常驻陪主人看视频啦。'
    )
    void persistPreferences({
      ...preferences,
      hidePetDuringVideoFullscreen
    })
  }

  function togglePetHoverShortcut(shortcutId: PetHoverShortcutId, selected: boolean) {
    const currentShortcuts = selectedPetHoverShortcuts

    if (selected && currentShortcuts.length >= PET_HOVER_SHORTCUT_LIMIT) {
      return
    }

    const nextShortcuts = selected
      ? [...currentShortcuts, shortcutId]
      : currentShortcuts.filter((id) => id !== shortcutId)

    void persistPreferences({
      ...preferences,
      petHoverShortcuts: normalizePetHoverShortcuts(nextShortcuts)
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

  function updateDeepSeekPreference(patch: Partial<AssistantPreferences>, options: { persist?: boolean } = {}) {
    setPreferences((current) => ({
      ...current,
      ...patch
    }))

    if (options.persist) {
      void persistPreferences({
        ...preferencesRef.current,
        ...patch
      })
    }
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
      deepseekCommentEnabled: false,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: false,
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
      submitOrChooseCommentDrafts(result.comments)
    } catch (error) {
      setAiCommentDrafts([])
      setCommentIntentOpen(false)
      submitOrChooseCommentDrafts(commentDrafts)
    } finally {
      setCommentIntentBusy(false)
    }
  }

  function submitOrChooseCommentDrafts(drafts: string[]) {
    if (preferencesRef.current.commentSubmitMode === 'random') {
      const commentDraft = pickRandomCommentDraft(drafts)
      setCommentChooserOpen(false)
      setAiCommentDrafts([])

      if (commentDraft) {
        void runAction('表', {
          commentDraft,
          submitComment: true
        })
      }
      return
    }

    setCommentChooserOpen(true)
  }

  async function runAction(
    action: AssistantAction,
    options?: { coinCount?: 1 | 2; commentDraft?: string; submitComment?: boolean }
  ) {
    if (runningAction) {
      return
    }

    setRunningAction(action)
    window.bilimiDesktop?.setAssistantPetState?.('cheer')
    tellPet('cheer', ACTION_PROGRESS_HINTS[action])
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
          pageClickOnly: preferences.bilibiliOperationMode === 'page-visual'
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
        result.ok ? 'done' : 'error',
        result.ok ? ACTION_SUCCESS_HINTS[action] : ACTION_ERROR_HINTS[action]
      )
      window.bilimiDesktop?.setAssistantPetState?.(result.ok ? 'done' : 'error')
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

    if (commentChooserOpen) {
      setCommentChooserOpen(false)
      setAiCommentDrafts([])
    }

    setFeedback(null)

    if (action === '赐') {
      void runAction('赐', { coinCount: preferences.defaultCoinCount })
      return
    }

    if (action === '表') {
      setAiCommentDrafts([])
      setCommentIntentError('')
      if (!preferences.deepseekEnabled || !preferences.deepseekCommentEnabled) {
        tellPet('success', 'DeepSeek 没开也没关系，小咪先给你本地短评候选。')
        submitOrChooseCommentDrafts(commentDrafts)
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

  async function generateVideoNoteFromAudio(options?: { summarizeWithDeepSeek?: boolean }) {
    setVideoNoteLoading(true)
    tellPet('progress', '小咪正在转写音频并整理札记，这一步可能要等一下。')

    try {
      const note = (await window.bilimiDesktop?.generateVideoNoteFromAudio?.()) ?? null
      let noteToStore = note

      let summaryText = ''

      if (noteToStore && preferences.deepseekEnabled && options?.summarizeWithDeepSeek) {
        const poster = await generateNotePoster(noteToStore)
        noteToStore = applyPosterSummaryToNote(noteToStore, poster)
        summaryText = createNotePosterText(poster)
      }

      setVideoNote(noteToStore)
      if (noteToStore) {
        tellPet('success', '音频札记整理好了，小咪也帮你存档啦。')
      }

      if (noteToStore) {
        const archives = await window.bilimiDesktop?.saveVideoNoteArchiveVersion?.(
          noteToStore,
          summaryText
        )

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

  async function loadVideoAudioTranscriptionQueue() {
    const snapshot = (await window.bilimiDesktop?.loadVideoAudioTranscriptionQueue?.()) ?? {
      items: []
    }
    transcriptionQueueRef.current = snapshot
    setTranscriptionQueue(snapshot)
    return snapshot
  }

  async function enqueueVideoAudioTranscription(options?: { summarizeWithDeepSeek?: boolean }) {
    if (!window.bilimiDesktop?.enqueueCurrentVideoAudioTranscription) {
      tellPet('error', '请先打开一个可转写的视频。')
      return null
    }

    tellPet('progress', '已加入转写队列，小咪会按顺序处理。')
    const nextQueue = await window.bilimiDesktop.enqueueCurrentVideoAudioTranscription?.(options)

    if (nextQueue) {
      transcriptionQueueRef.current = nextQueue
      setTranscriptionQueue(nextQueue)
    }
    return nextQueue
  }

  async function cancelQueuedVideoAudioTranscription(id: string) {
    const snapshot = await window.bilimiDesktop?.cancelVideoAudioTranscription?.(id)
    if (snapshot) {
      transcriptionQueueRef.current = snapshot
      setTranscriptionQueue(snapshot)
    }
  }

  async function retryQueuedVideoAudioTranscription(id: string) {
    const snapshot = await window.bilimiDesktop?.retryVideoAudioTranscription?.(id)
    if (snapshot) {
      transcriptionQueueRef.current = snapshot
      setTranscriptionQueue(snapshot)
    }
  }

  async function generateNotePoster(note: VideoNote) {
    tellPet('progress', '小咪正在整理 DeepSeek 总结。')
    const result = await window.bilimiDesktop?.generateDeepSeek?.({ kind: 'note-poster', note })

    if (!result || result.kind !== 'note-poster') {
      tellPet('error', 'DeepSeek 总结没有生成成功。')
      throw new Error('Poster generation failed.')
    }

    tellPet('success', 'DeepSeek 总结做好啦。')
    return result.poster
  }

  async function archiveNotePosterSummary(note: VideoNote, poster: NotePosterSummary) {
    const archives = await window.bilimiDesktop?.saveVideoNoteArchiveVersion?.(
      note,
      createNotePosterText(poster)
    )

    if (archives) {
      setVideoNoteArchives(archives)
    }
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

  async function syncCompletedQueuedVideoNote(snapshot: VideoAudioTranscriptionQueueSnapshot) {
    const completedItem = snapshot.items
      .filter((item) => item.status === 'completed' && item.archiveNoteId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    const archives = await loadVideoNoteArchives({ silent: true })

    if (!completedItem?.archiveNoteId) return

    const archive = archives.find((entry) => entry.id === completedItem.archiveNoteId)
    const latestVersion = archive?.versions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

    if (latestVersion) {
      setVideoNote(latestVersion.note)
    }
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

  async function updateVideoNoteArchiveVersion(
    archiveId: string,
    versionId: string,
    note: VideoNote
  ) {
    const archives =
      (await window.bilimiDesktop?.updateVideoNoteArchiveVersion?.(archiveId, versionId, note)) ?? []
    setVideoNoteArchives(archives)
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

  async function saveFavoriteLedgers(
    favoriteLedgers: AssistantPreferences['favoriteLedgers'],
    options?: FavoriteLedgerSaveOptions
  ) {
    tellPet('progress', '小咪正在同步掌库册目。')
    const result =
      (await (options === undefined
        ? window.bilimiDesktop?.saveFavoriteLedgers?.(favoriteLedgers)
        : window.bilimiDesktop?.saveFavoriteLedgers?.(favoriteLedgers, options))) ??
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

  async function openFavoritePage() {
    tellPet('progress', '小咪正在打开 B 站收藏夹。')
    const result =
      (await window.bilimiDesktop?.openBilibiliFavorites?.()) ??
      createDefaultResult('已打开 B 站收藏夹。')

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
  }

  async function scanOldFavorites(
    options: {
      multiArchiveMode?: AssistantPreferences['favoriteArchiveMultiMode']
    } = {}
  ): Promise<FavoriteLedgerPreview> {
    tellPet('progress', '小咪正在扫描旧收藏夹。')
    const preview =
      (await window.bilimiDesktop?.scanOldFavorites?.(options)) ?? {
        items: [],
        skippedSourceFolderTitles: []
      }

    tellPet(
      'success',
      preview.items.length > 0
        ? '旧藏扫描好了，小咪列出可归册项目。'
        : '旧藏扫描好了，暂时没有需要归册的项目。'
    )
    return preview
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    const result =
      (await window.bilimiDesktop?.executeOldFavoritePlan?.(items)) ??
      createDefaultResult('旧藏已归册。')

    return result
  }

  async function rejudgeOldFavorite(item: FavoriteLedgerPreviewItem): Promise<FavoriteLedgerPreviewItem> {
    tellPet('progress', '小咪正在根据最新改动重新判断。')
    const refreshedItem = (await window.bilimiDesktop?.rejudgeOldFavorite?.(item)) ?? item
    tellPet('success', '已经按最新信息判断一次。')
    return refreshedItem
  }

  function handleOldFavoriteExecutionStateChange(state: 'running' | 'finished') {
    tellPet(
      state === 'running' ? 'progress' : 'success',
      state === 'running' ? '旧藏整理中，请耐心等待。' : '本次整理已结束。'
    )
  }

  function closeAssistant() {
    if (isSidebarMode) {
      onRequestCollapse?.()
      return
    }

    tellPet('sleepy', pickPetLine(PET_COLLAPSE_FAREWELL_LINES))
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

        <div className="floating-assistant-view" hidden={activeView !== 'ledger'}>
          <FavoriteLedgerPanel
            ledgers={preferences.favoriteLedgers}
            missingLedgerIds={favoriteLedgerStatus?.missingLedgerIds ?? []}
            onEnsureLedgers={ensureFavoriteLedgers}
            onSaveLedgers={saveFavoriteLedgers}
            onOpenFavoritePage={openFavoritePage}
            onScanOldFavorites={scanOldFavorites}
            onExecuteOldFavoritePlan={executeOldFavoritePlan}
            onOldFavoriteExecutionStateChange={handleOldFavoriteExecutionStateChange}
            onOpenOldFavoriteVideo={onOpenInTab}
            onRejudgeOldFavorite={rejudgeOldFavorite}
            favoriteArchiveMultiMode={preferences.favoriteArchiveMultiMode}
          />
        </div>

        {activeView === 'ledger' ? null : activeView === 'settings' ? (
          <section className="assistant-settings" aria-label="助手设置">
            <header>
              <h2>设置</h2>
            </header>
            <fieldset className="assistant-settings__group assistant-settings__group--pet">
              <legend>宠物设置</legend>
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
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <label>
                <input
                  type="checkbox"
                  checked={preferences.hidePetDuringVideoFullscreen}
                  onChange={(event) =>
                    toggleVideoFullscreenPetVisibility(event.currentTarget.checked)
                  }
                />
                <span>全屏视频时自动收起小咪</span>
              </label>
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <div
                className="assistant-settings__hover-shortcuts"
                role="group"
                aria-label="宠物快捷操作"
              >
                <div className="assistant-settings__hover-shortcuts-copy">
                  <strong>宠物快捷操作</strong>
                  <small>
                    选择常用操作，数字表示显示顺序；点击可启用或停用快捷项，可不选，最多4个。
                  </small>
                </div>
                {PET_HOVER_SHORTCUTS.map((shortcut) => {
                  const selectedIndex = selectedPetHoverShortcuts.indexOf(shortcut.id)
                  const selected = selectedIndex >= 0
                  const selectionFull = selectedPetHoverShortcuts.length >= PET_HOVER_SHORTCUT_LIMIT
                  const orderLabel = selected ? ` 第 ${selectedIndex + 1} 位` : ''

                  return (
                    <button
                      key={shortcut.id}
                      className="assistant-settings__hover-shortcut"
                      type="button"
                      aria-label={`${shortcut.label} ${shortcut.title}${orderLabel}`}
                      aria-pressed={selected}
                      disabled={!selected && selectionFull}
                      onClick={() => togglePetHoverShortcut(shortcut.id, !selected)}
                    >
                      <span className="assistant-settings__hover-shortcut-mark">
                        {selected ? selectedIndex + 1 : shortcut.label}
                      </span>
                      <span className="assistant-settings__hover-shortcut-copy">
                        <strong>{shortcut.label}</strong>
                        <small>{shortcut.title}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <div className="assistant-settings__pet-actions">
                <button type="button" onClick={wakeAssistantPet}>
                  唤醒宠物
                </button>
                <button type="button" onClick={closeAssistantPet}>
                  关闭宠物
                </button>
              </div>
            </fieldset>
            <fieldset className="assistant-settings__group assistant-settings__group--archive">
              <legend>Bilimi 收藏策略</legend>
              <p>说明：设置一个待分类视频最多可同时保存在几个 Bilimi 收藏夹。用户原收藏夹不会移动、删除，也不计入数量。</p>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'off'}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      favoriteArchiveMultiMode: 'off'
                    })
                  }
                />
                <span>最多存入 1 个 Bilimi 收藏夹，优先存入生成和自定义创建的收藏夹</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'two'}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      favoriteArchiveMultiMode: 'two'
                    })
                  }
                />
                <span>最多存入 2 个 Bilimi 收藏夹，同一个视频可以存入一个默认分类和一个其他匹配的 Bilimi 收藏夹</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'three'}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      favoriteArchiveMultiMode: 'three'
                    })
                  }
                />
                <span>最多存入 3 个 Bilimi 收藏夹，同一个视频可以存入一个默认分类和两个其他匹配的 Bilimi 收藏夹</span>
              </label>
            </fieldset>
            <fieldset className="assistant-settings__group assistant-settings__group--review-actions">
              <legend>批阅动作设置</legend>
              <label>
                <input
                  type="radio"
                  name="default-coin-count"
                  checked={preferences.defaultCoinCount === 1}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      defaultCoinCount: 1
                    })
                  }
                />
                <span>赐默认投 1 币</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="default-coin-count"
                  checked={preferences.defaultCoinCount === 2}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      defaultCoinCount: 2
                    })
                  }
                />
                <span>赐默认投 2 币</span>
              </label>
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <label>
                <input
                  type="radio"
                  name="comment-submit-mode"
                  checked={preferences.commentSubmitMode === 'choose'}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      commentSubmitMode: 'choose'
                    })
                  }
                />
                <span>表三选一后发送</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="comment-submit-mode"
                  checked={preferences.commentSubmitMode === 'random'}
                  onChange={() =>
                    void persistPreferences({
                      ...preferences,
                      commentSubmitMode: 'random'
                    })
                  }
                />
                <span>表随机一条直接发送</span>
              </label>
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
                开启后可使用批阅的拟奏短评、札记中的 DeepSeek 总结、宠物对话功能。
              </p>
              <div className="assistant-settings__deepseek-switches">
                <label>
                  <input
                    type="checkbox"
                    checked={preferences.deepseekCommentEnabled}
                    onChange={(event) =>
                      updateDeepSeekPreference(
                        {
                          deepseekCommentEnabled: event.currentTarget.checked
                        },
                        { persist: true }
                      )
                    }
                  />
                  <span>启用 DeepSeek 生成趣味评论</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={preferences.deepseekAutoSummaryEnabled}
                    onChange={(event) =>
                      updateDeepSeekPreference(
                        {
                          deepseekAutoSummaryEnabled: event.currentTarget.checked
                        },
                        { persist: true }
                      )
                    }
                  />
                  <span>转写完成后自动生成 DeepSeek 总结</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={preferences.deepseekPetChatEnabled}
                    onChange={(event) =>
                      updateDeepSeekPreference(
                        {
                          deepseekPetChatEnabled: event.currentTarget.checked
                        },
                        { persist: true }
                      )
                    }
                  />
                  <span>启用 DeepSeek 宠物对话功能</span>
                </label>
              </div>
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
            onUpdateVersion={updateVideoNoteArchiveVersion}
            onDeleteEntry={deleteVideoNoteArchiveEntry}
            onDeleteVersion={deleteVideoNoteArchiveVersion}
          />
        ) : (
          <MemorialPanel
            recommendation={recommendation}
            commentDrafts={commentDrafts}
            deepSeekEnabled={preferences.deepseekEnabled}
            deepSeekCommentEnabled={preferences.deepseekCommentEnabled}
            deepSeekAutoSummaryEnabled={preferences.deepseekAutoSummaryEnabled}
            videoCategory={videoCategory}
            videoTitle={resolvedVideoTitle}
            videoAuthor={resolvedVideoAuthor}
            onAction={handleAction}
            onClose={closeAssistant}
            closeLabel={isSidebarMode ? '收起侧栏' : '合折'}
            showCloseButton={!isSidebarMode}
            onGenerateVideoNote={generateVideoNote}
            onTranscribeVideoAudio={generateVideoNoteFromAudio}
            onEnqueueVideoAudioTranscription={enqueueVideoAudioTranscription}
            onCancelQueuedVideoAudioTranscription={(id) => {
              void cancelQueuedVideoAudioTranscription(id)
            }}
            onRetryQueuedVideoAudioTranscription={(id) => {
              void retryQueuedVideoAudioTranscription(id)
            }}
            onGeneratePoster={generateNotePoster}
            onArchivePosterSummary={archiveNotePosterSummary}
            onSaveVideoNote={saveVideoNote}
            onChangeVideoNote={handleChangeVideoNote}
            videoNote={videoNote}
            videoNoteArchivedSummaryText={videoNoteArchivedSummaryText}
            videoNoteLoading={videoNoteLoading}
            transcriptionProgress={transcriptionProgress}
            transcriptionQueue={transcriptionQueue}
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
              void runAction('表', {
                commentDraft,
                submitComment: true
              })
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
