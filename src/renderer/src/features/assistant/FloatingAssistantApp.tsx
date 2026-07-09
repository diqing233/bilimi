import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekArchiveMode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteCorrectionRecord,
  AssistantPreferences,
  FavoriteKeywordSuggestion,
  FavoriteKeywordSuggestionStatus,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  NotePosterSummary,
  RecommendationKind,
  StartupDiagnosticItem,
  StartupDiagnosticReport,
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
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeVideoClassificationRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import {
  createPreferenceSaveScheduler,
  type PreferenceSaveScheduler
} from '../state/preferenceSaveScheduler'
import { CommentChooser } from './CommentChooser'
import { CommentIntentDialog } from './CommentIntentDialog'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import type { VideoNotesResultTab } from '../notes/VideoNotesPanel'
import { VideoNoteArchivePanel } from '../notes/VideoNoteArchivePanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import type { AssistantPetHint } from './petState'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'
import { PET_COLLAPSE_FAREWELL_LINES, pickPetLine } from './petInteractionLines'

const CURRENT_TITLE = '等待视频加载'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/[^/?#]+/i
const BILIBILI_PAGE_PATTERN = /bilibili\.com/i
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const FAVORITE_LEDGER_BACKUP_HINT =
  '使用bilimi第一件事就是备册，生成专属收藏夹，同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧'
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
  workspaceRequestsEnabled?: boolean
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

function isCurrentVideoMissingFeedback(feedback: ActionFeedback | null): boolean {
  return feedback?.tone === 'error' && feedback.missingTargets.includes('current-video')
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
  藏: '主人，小咪正在把它收进合适的 bilimi 分册～',
  赐: '主人，小咪正在把硬币准备好～',
  表: '主人，小咪正在备好短评候选，等你拍板～',
  阅: '主人，小咪正在登记已阅～'
}

const ACTION_SUCCESS_HINTS: Record<AssistantAction, string> = {
  赏: '做好啦，喜欢和分册都替主人处理好了～',
  藏: '收好啦，这支视频已经进 bilimi 分册了。',
  赐: '投币完成啦，小咪给这份喜欢盖章了～',
  表: '短评已经送出啦，还是由主人选中的那句。',
  阅: '已阅登记完成，主人可以继续看下一支啦。'
}

const ACTION_ERROR_HINTS: Record<AssistantAction, string> = {
  赏: '点赞归册没完成，小咪这次没有拿到更具体的原因。',
  藏: '收藏归册没完成，小咪这次没有拿到更具体的原因。',
  赐: '投币没完成，小咪这次没有拿到更具体的原因。',
  表: '短评流程没完成，小咪这次没有拿到更具体的原因。',
  阅: '已阅登记没完成，小咪这次没有拿到更具体的原因。'
}

const ACTION_NO_VIDEO_ERROR_HINTS: Record<AssistantAction, string> = {
  赏: '当前还没打开视频，小咪不能帮这条点喜欢。',
  藏: '当前还没打开视频，小咪不能把这条归入 bilimi。',
  赐: '当前还没打开视频，小咪不能给这条投币。',
  表: '当前还没打开视频，小咪不能帮这条拟短评。',
  阅: '当前还没打开视频，小咪不能登记已阅。'
}

const TAB_HINTS: Record<AssistantWorkspaceTab, string> = {
  review: '小咪切到批阅啦，当前视频的操作都在这里。',
  notes: '小咪切到札记啦，可以转写、整理和存档。',
  ledger: '小咪切到掌库啦，bilimi 分册在这里管理。',
  settings: '小咪切到设置啦，宠物和 DeepSeek 都在这里调。'
}

type GlobalStatusTone = 'ok' | 'warn' | 'error' | 'running' | 'idle'

type GlobalStatusItem = {
  label: string
  detail: string
  tone: GlobalStatusTone
}

function favoriteLedgerBackupGap(ledgers: FavoriteLedger[]) {
  const enabledLedgers = ledgers.filter((ledger) => ledger.enabled)
  const enabledLedgersWithoutFolder = enabledLedgers.filter(
    (ledger) => !ledger.bilibiliFolderId?.trim()
  )

  return {
    enabledCount: enabledLedgers.length,
    enabledWithoutFolderCount: enabledLedgersWithoutFolder.length,
    backedEnabledCount: enabledLedgers.length - enabledLedgersWithoutFolder.length
  }
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

function didActiveVideoChange(
  previousSnapshot: AssistantSnapshot | null,
  nextSnapshot: AssistantSnapshot
) {
  if (!previousSnapshot) {
    return false
  }

  const previousUrl = previousSnapshot.activeTabUrl?.trim() ?? ''
  const nextUrl = nextSnapshot.activeTabUrl?.trim() ?? ''

  if (previousUrl || nextUrl) {
    return previousUrl !== nextUrl
  }

  return normalizeTitle(previousSnapshot.videoTitle) !== normalizeTitle(nextSnapshot.videoTitle)
}

function stripBilimiPrefix(displayName: string) {
  return stripBilimiLedgerPrefix(displayName)
}

function normalizeTitle(title: string) {
  return title.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
}

const ARCHIVE_STRATEGY_OPTIONS: Array<{
  value: AssistantPreferences['favoriteArchiveStrategy']
  label: string
}> = [
  { value: 'aggressive', label: '积极整理' },
  { value: 'balanced', label: '均衡整理' },
  { value: 'conservative', label: '保守整理' }
]

const KEYWORD_SUGGESTION_ACTION_LABELS: Record<FavoriteKeywordSuggestion['action'], string> = {
  'add-keyword': '新增关键词',
  'remove-keyword': '移除关键词',
  'downgrade-to-weak': '降为弱词',
  'replace-with-combination': '替换组合词',
  'add-entity-alias': '新增实体别名',
  'add-concept-variant': '新增概念变体'
}

const FAVORITE_CORRECTION_LEARNING_HELP =
  '确认整理后，记录“原建议”和“你实际选择”的差异，用来沉淀纠错经验。'
const FAVORITE_CORRECTION_CLASSIFICATION_HELP =
  '开启后，后续分类会参考这些纠错记录；关闭后只保留记录，不影响自动分类。'

const SETTINGS_JUMP_OPTIONS = [
  { value: 'diagnostics', label: '诊断' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'pet', label: '宠物设置' },
  { value: 'transcription', label: '视频音频转写速度' },
  { value: 'archive', label: '收藏整理' },
  { value: 'learning', label: '整理策略' },
  { value: 'review-actions', label: '批阅动作' }
] as const

type SettingsJumpValue = (typeof SETTINGS_JUMP_OPTIONS)[number]['value']

function formatSettingsDate(value?: string) {
  if (!value) return '未记录'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDeepSeekFeatureList(preferences: AssistantPreferences): string {
  if (!preferences.deepseekEnabled || !preferences.deepseekApiKeyStored) {
    return [
      'DeepSeek 未连接。',
      `趣评生成：${preferences.deepseekCommentEnabled ? '开启' : '关闭'}`,
      `自动总结：${preferences.deepseekAutoSummaryEnabled ? '开启' : '关闭'}`,
      `宠物对话：${preferences.deepseekPetChatEnabled ? '开启' : '关闭'}`,
      `辅助整理：${preferences.deepseekDailyClassificationEnabled ? '开启' : '关闭'}`
    ].join('\n')
  }

  return [
    'DeepSeek 已连接。',
    `趣评生成：${preferences.deepseekCommentEnabled ? '开启' : '关闭'}，拟奏短评会生成候选。`,
    `自动总结：${preferences.deepseekAutoSummaryEnabled ? '开启' : '关闭'}，转写后生成文稿总结。`,
    `宠物对话：${preferences.deepseekPetChatEnabled ? '开启' : '关闭'}，小咪可使用 DeepSeek 对话。`,
    `辅助整理：${preferences.deepseekDailyClassificationEnabled ? '开启' : '关闭'}，代批和旧藏整理会复核分类。`
  ].join('\n')
}

function joinSettingValues(values: Array<string | number | undefined>) {
  const text = values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('、')

  return text || '未记录'
}

function getLedgerDisplayName(ledgers: FavoriteLedger[], ledgerId?: string) {
  if (!ledgerId) return '未记录'

  const ledger = ledgers.find((candidate) => candidate.id === ledgerId)
  return ledger ? stripBilimiPrefix(ledger.displayName) : ledgerId
}

function updateLedgerKeywords(
  ledgers: FavoriteLedger[],
  ledgerId: string | undefined,
  updater: (keywords: string[]) => string[]
) {
  if (!ledgerId) return ledgers

  return ledgers.map((ledger) =>
    ledger.id === ledgerId
      ? {
          ...ledger,
          keywords: Array.from(
            new Set(
              updater([...ledger.keywords])
                .map((keyword) => keyword.trim())
                .filter(Boolean)
            )
          )
        }
      : ledger
  )
}

function keywordSuggestionSignature(suggestion: FavoriteKeywordSuggestion) {
  return [
    suggestion.action,
    suggestion.ledgerId,
    suggestion.keyword?.trim().toLocaleLowerCase() ?? '',
    suggestion.replacement?.trim().toLocaleLowerCase() ?? ''
  ].join('::')
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

function formatGlobalProgressPercent(progress?: VideoAudioTranscriptionProgress) {
  if (!progress) return null

  if (
    progress.step === 'transcribing-segment' &&
    typeof progress.segmentIndex === 'number' &&
    typeof progress.segmentCount === 'number' &&
    progress.segmentCount > 0
  ) {
    return Math.min(100, Math.max(0, Math.round(30 + 38 * (progress.segmentIndex / progress.segmentCount))))
  }

  const fallbackByStep: Record<VideoAudioTranscriptionProgress['step'], number> = {
    'preparing-session': 8,
    'downloading-audio': 18,
    'preparing-segments': 30,
    'transcribing-segment': 50,
    'merging-transcript': 76,
    'generating-note': 94,
    'summarizing-deepseek': 96,
    'saving-archive': 98,
    'queue-completed': 100
  }

  return fallbackByStep[progress.step]
}

function createActionErrorHint(action: AssistantAction, result: AssistantAutomationResult) {
  const message = result.message.trim()
  const missingCurrentVideo = result.missingTargets.includes('current-video')
  const messageSaysNoVideo = /未打开视频|暂无视频|打开一个视频|当前视频/.test(message)

  if (missingCurrentVideo || messageSaysNoVideo) {
    return ACTION_NO_VIDEO_ERROR_HINTS[action]
  }

  return message || ACTION_ERROR_HINTS[action]
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
  onOpenInTab,
  workspaceRequestsEnabled = true
}: FloatingAssistantAppProps = {}) {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null)
  const snapshotRef = useRef<AssistantSnapshot | null>(null)
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
  const [settingsDiagnosticReport, setSettingsDiagnosticReport] =
    useState<StartupDiagnosticReport | null>(null)
  const [settingsDiagnosticRunning, setSettingsDiagnosticRunning] = useState(false)
  const [settingsDiagnosticMessage, setSettingsDiagnosticMessage] = useState('')
  const [settingsDiagnosticsExpanded, setSettingsDiagnosticsExpanded] = useState(true)
  const [settingsLearningMessage, setSettingsLearningMessage] = useState('')
  const [settingsJumpValue, setSettingsJumpValue] = useState<SettingsJumpValue>('diagnostics')
  const [globalFeedbackMessage, setGlobalFeedbackMessage] = useState('')
  const [oldFavoriteExecutionState, setOldFavoriteExecutionState] =
    useState<'idle' | 'running' | 'finished'>('idle')
  const [oldFavoriteGlobalStatus, setOldFavoriteGlobalStatus] = useState<GlobalStatusItem | null>(null)
  const settingsBodyRef = useRef<HTMLDivElement | null>(null)
  const mounted = useRef(false)
  const lastPreferenceChangeAt = useRef(0)
  const lastPreferenceSaveAt = useRef(0)
  const preferenceSaveSchedulerRef = useRef<PreferenceSaveScheduler<AssistantPreferences> | null>(
    null
  )
  const transcriptionQueueRef = useRef<VideoAudioTranscriptionQueueSnapshot>({ items: [] })
  const workspaceRequestsEnabledRef = useRef(workspaceRequestsEnabled)
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const [activeView, setActiveView] = useState<AssistantWorkspaceView>(activeTab)
  const [notesWorkspaceView, setNotesWorkspaceView] =
    useState<Extract<AssistantWorkspaceView, 'notes' | 'noteArchive'>>('notes')
  const [videoNotesResultTab, setVideoNotesResultTab] =
    useState<VideoNotesResultTab | null>(null)
  const [organizeOldFavoritesRequestSignal, setOrganizeOldFavoritesRequestSignal] = useState(0)
  const isSidebarMode = mode === 'sidebar'

  const globalTranscriptionStatus = useMemo<GlobalStatusItem>(() => {
    const runningItem = transcriptionQueue.items.find((item) => item.status === 'running')
    if (runningItem) {
      const percent = formatGlobalProgressPercent(runningItem.progress)
      const pendingCount = transcriptionQueue.items.filter((item) => item.status === 'pending').length
      return {
        label: percent === null ? '转写中' : `转写 ${percent}%`,
        detail: `${runningItem.title} 正在转写${pendingCount > 0 ? `，排队 ${pendingCount} 个` : ''}`,
        tone: 'running'
      }
    }

    const pendingCount = transcriptionQueue.items.filter((item) => item.status === 'pending').length
    if (pendingCount > 0) {
      return {
        label: `转写排队 ${pendingCount}`,
        detail: `还有 ${pendingCount} 个转写任务等待处理。`,
        tone: 'warn'
      }
    }

    const completedItem = transcriptionQueue.items
      .filter((item) => item.status === 'completed')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    if (completedItem) {
      return {
        label: '转写完成',
        detail: `${completedItem.title} 已完成转写。`,
        tone: 'ok'
      }
    }

    return {
      label: '暂无转写',
      detail: '当前视频暂无可用转写。',
      tone: 'idle'
    }
  }, [transcriptionQueue])

  const globalDeepSeekStatus = useMemo<GlobalStatusItem>(() => {
    if (!preferences.deepseekEnabled || !preferences.deepseekApiKeyStored) {
      return {
        label: 'DeepSeek 未连',
        detail: formatDeepSeekFeatureList(preferences),
        tone: 'warn'
      }
    }

    const runningDeepSeekItem = transcriptionQueue.items.find(
      (item) => item.status === 'running' && item.progress?.step === 'summarizing-deepseek'
    )
    if (runningDeepSeekItem) {
      return {
        label: 'DeepSeek 总结中',
        detail: `${runningDeepSeekItem.title} 正在生成 DeepSeek 总结。`,
        tone: 'running'
      }
    }

    return {
      label: 'DeepSeek 已连',
      detail: formatDeepSeekFeatureList(preferences),
      tone: 'ok'
    }
  }, [
    preferences.deepseekApiKeyStored,
    preferences.deepseekAutoSummaryEnabled,
    preferences.deepseekCommentEnabled,
    preferences.deepseekDailyClassificationEnabled,
    preferences.deepseekEnabled,
    preferences.deepseekPetChatEnabled,
    transcriptionQueue
  ])

  const globalLedgerStatus = useMemo<GlobalStatusItem>(() => {
    const backupGap = favoriteLedgerBackupGap(preferences.favoriteLedgers)

    if (oldFavoriteExecutionState === 'running') {
      return {
        label: '整理中',
        detail: '旧藏正在整理中。',
        tone: 'running'
      }
    }

    if (oldFavoriteGlobalStatus) {
      return oldFavoriteGlobalStatus
    }

    if (favoriteLedgerStatus?.missingLedgerIds.length) {
      return {
        label: '未备册',
        detail: `还有 ${favoriteLedgerStatus.missingLedgerIds.length} 个 bilimi 收藏夹未备册。\n${FAVORITE_LEDGER_BACKUP_HINT}`,
        tone: 'error'
      }
    }

    if (backupGap.enabledCount === 0) {
      return {
        label: '未备册',
        detail: `当前没有启用的 bilimi 收藏夹。\n${FAVORITE_LEDGER_BACKUP_HINT}`,
        tone: 'error'
      }
    }

    if (backupGap.enabledWithoutFolderCount > 0) {
      return {
        label: '未备册',
        detail: `还有 ${backupGap.enabledWithoutFolderCount} 个已启用 bilimi 收藏夹未备册。\n${FAVORITE_LEDGER_BACKUP_HINT}`,
        tone: 'error'
      }
    }

    if (favoriteLedgerStatus?.ok) {
      return {
        label: oldFavoriteExecutionState === 'finished' ? '整理完成' : '已备册',
        detail: oldFavoriteExecutionState === 'finished' ? '本次旧藏整理已结束。' : 'bilimi 收藏夹已备册。',
        tone: 'ok'
      }
    }

    return {
      label: '整理空闲',
      detail: '暂未检查备册状态。',
      tone: 'idle'
    }
  }, [
    favoriteLedgerStatus,
    oldFavoriteExecutionState,
    oldFavoriteGlobalStatus,
    preferences.favoriteLedgers
  ])

  function tellPet(tone: PetFeedbackTone, message: string) {
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: PET_FEEDBACK_TONES[tone],
      message: createPetHintMessage(message)
    })
  }

  function setGlobalFeedback(message: string) {
    const trimmed = message.trim()
    if (trimmed) {
      setGlobalFeedbackMessage(trimmed)
    }
  }

  function setActiveTab(tab: AssistantWorkspaceTab, options?: { view?: AssistantWorkspaceView }) {
    setFeedback(null)
    const nextView = options?.view ?? (tab === 'notes' ? notesWorkspaceView : tab)
    setActiveView(nextView)
    if (tab === 'notes' && (nextView === 'notes' || nextView === 'noteArchive')) {
      setNotesWorkspaceView(nextView)
    }
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

      if (didActiveVideoChange(snapshotRef.current, nextSnapshot)) {
        setCommentChooserOpen(false)
        setAiCommentDrafts([])
      }

      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      const snapshotPreferences = createInitialAssistantPreferences(nextSnapshot.preferences)
      const lastLocalPreferenceChangeAt = Math.max(
        lastPreferenceChangeAt.current,
        lastPreferenceSaveAt.current
      )
      const snapshotArrivedSoonAfterLocalChange = Date.now() - lastLocalPreferenceChangeAt < 2000
      setPreferences((currentPreferences) => {
        const nextPreferences = snapshotArrivedSoonAfterLocalChange
          ? currentPreferences
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
      snapshotRef.current = fallback
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
    if (controlledActiveTab !== undefined) {
      setActiveView(controlledActiveTab === 'notes' ? notesWorkspaceView : controlledActiveTab)
    }
  }, [controlledActiveTab, notesWorkspaceView])

  useEffect(() => {
    preferencesRef.current = preferences
  }, [preferences])

  useEffect(() => {
    workspaceRequestsEnabledRef.current = workspaceRequestsEnabled
  }, [workspaceRequestsEnabled])

  useEffect(() => {
    mounted.current = true

    void loadSnapshot()
    void loadVideoNoteArchives({ silent: true })
    void loadVideoAudioTranscriptionQueue()

    return () => {
      void preferenceSaveSchedulerRef.current?.flush()
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

  function clearCurrentVideoMissingFeedback() {
    setFeedback((currentFeedback) =>
      isCurrentVideoMissingFeedback(currentFeedback) ? null : currentFeedback
    )
  }

  useEffect(() => {
    return window.bilimiDesktop?.onVideoAudioTranscriptionQueueChanged?.((snapshot) => {
      const hadRunning = transcriptionQueueRef.current.items.some((item) => item.status === 'running')
      const hasRunning = snapshot.items.some((item) => item.status === 'running')

      transcriptionQueueRef.current = snapshot
      setTranscriptionQueue(snapshot)
      if (hasRunning) {
        clearCurrentVideoMissingFeedback()
      }

      const activeDraftNote = snapshot.items.find(
        (item) => item.status === 'running' && item.draftNote
      )?.draftNote
      if (activeDraftNote) {
        setVideoNote(activeDraftNote)
      }

      if (hadRunning && !hasRunning && snapshot.items.some((item) => item.status === 'completed')) {
        setGlobalFeedback('转写完成，文稿已保存到档案库')
        void syncCompletedQueuedVideoNote(snapshot)
      }
    })
  }, [])

  const resolvedSnapshot = snapshot ?? createFallbackSnapshot()
  const resolvedVideoTitle = normalizeTitle(resolvedSnapshot.videoTitle)
  const resolvedVideoAuthor = resolvedSnapshot.videoContentContext.author?.trim()
  const hasCurrentVideo = Boolean(
    resolvedSnapshot.activeTabUrl && BILIBILI_VIDEO_URL_PATTERN.test(resolvedSnapshot.activeTabUrl)
  )
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
  const hasBilibiliPageOpen = BILIBILI_PAGE_PATTERN.test(resolvedSnapshot.activeTabUrl?.trim() ?? '')
  const favoriteLedgerBackupStatus = favoriteLedgerBackupGap(preferences.favoriteLedgers)
  const hasMissingFavoriteLedgers =
    Boolean(favoriteLedgerStatus?.missingLedgerIds.length) ||
    favoriteLedgerBackupStatus.enabledCount === 0 ||
    favoriteLedgerBackupStatus.enabledWithoutFolderCount > 0
  const readinessFeedbackMessage = useMemo(() => {
    if (!hasBilibiliPageOpen && hasMissingFavoriteLedgers) {
      return '请先登录 B 站，并到掌库备册。'
    }

    if (!hasBilibiliPageOpen) {
      return '请先登录 B 站。'
    }

    if (hasMissingFavoriteLedgers) {
      return '请到掌库备册后再开始整理。'
    }

    return '准备就绪。'
  }, [hasBilibiliPageOpen, hasMissingFavoriteLedgers])
  const displayedGlobalFeedbackMessage = globalFeedbackMessage || readinessFeedbackMessage

  function applyPreferenceSnapshot(nextPreferences: AssistantPreferences) {
    lastPreferenceChangeAt.current = Date.now()
    preferencesRef.current = nextPreferences
    setPreferences(nextPreferences)
  }

  function getPreferenceSaveScheduler() {
    if (!preferenceSaveSchedulerRef.current) {
      preferenceSaveSchedulerRef.current = createPreferenceSaveScheduler<AssistantPreferences>({
        delayMs: 250,
        save: async (nextPreferences) => {
          if (!window.bilimiDesktop?.savePreferences) {
            return nextPreferences
          }

          const saveStartedAt = Date.now()
          const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
          const savedPreferences = createInitialAssistantPreferences(saved)
          const newerLocalChangeExists = lastPreferenceChangeAt.current > saveStartedAt

          if (!newerLocalChangeExists) {
            preferencesRef.current = savedPreferences

            if (mounted.current) {
              setPreferences(savedPreferences)
            }
          }

          lastPreferenceSaveAt.current = Date.now()
          return savedPreferences
        }
      })
    }

    return preferenceSaveSchedulerRef.current
  }

  function persistPreferencePatch(patch: Partial<AssistantPreferences>) {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      ...patch
    })
    applyPreferenceSnapshot(nextPreferences)
    getPreferenceSaveScheduler().schedule(nextPreferences)
  }

  function deleteCorrectionRecord(recordId: string) {
    const nextRecords = preferencesRef.current.favoriteCorrectionRecords.filter(
      (record) => record.id !== recordId
    )
    persistPreferencePatch({ favoriteCorrectionRecords: nextRecords })
  }

  function clearCorrectionRecords() {
    persistPreferencePatch({ favoriteCorrectionRecords: [] })
  }

  function updateKeywordSuggestionStatus(
    suggestionId: string,
    status: FavoriteKeywordSuggestionStatus,
    favoriteLedgers = preferencesRef.current.favoriteLedgers
  ) {
    const nextSuggestions = preferencesRef.current.favoriteKeywordSuggestions.map((suggestion) =>
      suggestion.id === suggestionId ? { ...suggestion, status } : suggestion
    )

    persistPreferencePatch({
      favoriteLedgers,
      favoriteKeywordSuggestions: nextSuggestions
    })
  }

  function acceptKeywordSuggestion(suggestion: FavoriteKeywordSuggestion) {
    let nextLedgers = preferencesRef.current.favoriteLedgers

    if (suggestion.action === 'add-keyword' && suggestion.keyword) {
      nextLedgers = updateLedgerKeywords(nextLedgers, suggestion.ledgerId, (keywords) => [
        ...keywords,
        suggestion.keyword ?? ''
      ])
      setSettingsLearningMessage('关键词已加入目标收藏夹。')
    } else if (suggestion.action === 'remove-keyword' && suggestion.keyword) {
      nextLedgers = updateLedgerKeywords(nextLedgers, suggestion.ledgerId, (keywords) =>
        keywords.filter((keyword) => keyword !== suggestion.keyword)
      )
      setSettingsLearningMessage('关键词已从目标收藏夹移除。')
    } else if (
      suggestion.action === 'replace-with-combination' &&
      suggestion.keyword &&
      suggestion.replacement
    ) {
      nextLedgers = updateLedgerKeywords(nextLedgers, suggestion.ledgerId, (keywords) => [
        ...keywords.filter((keyword) => keyword !== suggestion.keyword),
        suggestion.replacement ?? ''
      ])
      setSettingsLearningMessage('关键词已替换为组合词。')
    } else if (suggestion.action === 'downgrade-to-weak') {
      setSettingsLearningMessage('已采纳；当前版本弱词由分类器内置解释。')
    } else if (
      suggestion.action === 'add-entity-alias' ||
      suggestion.action === 'add-concept-variant'
    ) {
      setSettingsLearningMessage('已采纳；需要后续版本纳入内置词库。')
    } else {
      setSettingsLearningMessage('建议已采纳。')
    }

    updateKeywordSuggestionStatus(suggestion.id, 'accepted', nextLedgers)
  }

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    const normalizedPreferences = createInitialAssistantPreferences(nextPreferences)
    applyPreferenceSnapshot(normalizedPreferences)
    getPreferenceSaveScheduler().schedule(normalizedPreferences)
    const savedPreferences = await getPreferenceSaveScheduler().flush()

    if (savedPreferences) {
      applyPreferenceSnapshot(savedPreferences)
      return savedPreferences
    }

    return normalizedPreferences
  }

  function choosePetStyle(petStyle: AssistantPreferences['petStyle']) {
    tellPet('success', petStyle === 'big-head' ? '小咪换回萌版大头啦～' : '小咪换成Q版小人啦～')
    persistPreferencePatch({ petStyle })
  }

  function toggleVideoFullscreenPetVisibility(hidePetDuringVideoFullscreen: boolean) {
    tellPet(
      'success',
      hidePetDuringVideoFullscreen
        ? '全屏看视频时，小咪会先让出画面。'
        : '小咪会常驻陪主人看视频啦。'
    )
    persistPreferencePatch({ hidePetDuringVideoFullscreen })
  }

  function togglePetHoverShortcut(shortcutId: PetHoverShortcutId, selected: boolean) {
    const currentShortcuts = selectedPetHoverShortcuts

    if (selected && currentShortcuts.length >= PET_HOVER_SHORTCUT_LIMIT) {
      return
    }

    const nextShortcuts = selected
      ? [...currentShortcuts, shortcutId]
      : currentShortcuts.filter((id) => id !== shortcutId)

    persistPreferencePatch({
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
    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      ...patch
    })

    applyPreferenceSnapshot(nextPreferences)

    if (options.persist) {
      getPreferenceSaveScheduler().schedule(nextPreferences)
    }
  }

  function toggleDeepSeekEnabled(enabled: boolean) {
    updateDeepSeekPreference(
      enabled
        ? {
            deepseekEnabled: true,
            deepseekCommentEnabled: true,
            deepseekAutoSummaryEnabled: true,
            deepseekPetChatEnabled: true
          }
        : { deepseekEnabled: false },
      { persist: true }
    )
  }

  function jumpToSettingsSection(section: SettingsJumpValue) {
    setSettingsJumpValue(section)
    const selector = `[data-settings-section="${section}"]`
    const target = settingsBodyRef.current?.querySelector(selector) ?? document.querySelector(selector)
    if (target && 'scrollIntoView' in target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  function syncSettingsJumpFromScroll() {
    const body = settingsBodyRef.current
    if (!body) {
      return
    }

    const bodyTop = body.getBoundingClientRect().top
    let nextValue = settingsJumpValue

    for (const option of SETTINGS_JUMP_OPTIONS) {
      const section = body.querySelector<HTMLElement>(`[data-settings-section="${option.value}"]`)
      if (section && section.getBoundingClientRect().top - bodyTop <= 12) {
        nextValue = option.value
      }
    }

    if (nextValue !== settingsJumpValue) {
      setSettingsJumpValue(nextValue)
    }
  }

  async function saveDeepSeekSettings() {
    const keyDraft = deepSeekApiKeyDraft.trim()
    let nextPreferences = preferencesRef.current

    tellPet('progress', '小咪正在保存 DeepSeek 设置。')

    if (keyDraft) {
      const keyStatus = await window.bilimiDesktop?.saveDeepSeekApiKey?.(keyDraft)
      if (keyStatus) {
        nextPreferences = createInitialAssistantPreferences({
          ...preferencesRef.current,
          deepseekApiKeyStored: keyStatus.configured
        })
      }
    }

    await persistPreferences(nextPreferences)
    setGlobalFeedback('DeepSeek 设置已保存。')
    tellPet('success', 'DeepSeek 设置保存好啦。')
  }

  async function testDeepSeekConnection() {
    if (!window.bilimiDesktop?.testDeepSeekConnection) {
      setGlobalFeedback('DeepSeek 测试功能未加载，请重启应用后再试。')
      tellPet('error', 'DeepSeek 测试功能还没加载好。')
      return
    }

    tellPet('progress', '小咪正在测试 DeepSeek 连接。')
    await saveDeepSeekSettings()
    const result = await window.bilimiDesktop.testDeepSeekConnection()
    const statusMessage = localizeDeepSeekStatusMessage(result.message)
    setDeepSeekStatusMessage(statusMessage)
    setGlobalFeedback(statusMessage)
    tellPet(result.ok ? 'success' : 'error', statusMessage)
  }

  async function resetDeepSeekSettings() {
    const nextPreferences = {
      ...preferencesRef.current,
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: false,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: false,
      deepseekDailyClassificationEnabled: false,
      deepseekDailyClassificationMode: 'all',
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL
    }

    setDeepSeekApiKeyDraft('')
    await window.bilimiDesktop?.clearDeepSeekApiKey?.()
    await persistPreferences(nextPreferences)
    setDeepSeekStatusMessage('')
    setGlobalFeedback('DeepSeek 设置已重置。')
    tellPet('success', 'DeepSeek 设置已经重置，小咪回到本地提示模式啦。')
  }

  async function resetAssistantSettings() {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      petStyle: 'big-head',
      petHoverShortcuts: undefined,
      hidePetDuringVideoFullscreen: false,
      favoriteArchiveMultiMode: 'off',
      defaultCoinCount: 1,
      commentSubmitMode: 'random',
      videoAudioTranscriptionThreadLimit: 'unlimited',
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: false,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: false,
      deepseekDailyClassificationEnabled: false,
      deepseekDailyClassificationMode: 'all',
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      assistantSidebarWidthPx: null
    })

    setDeepSeekApiKeyDraft('')
    await window.bilimiDesktop?.clearDeepSeekApiKey?.()
    await persistPreferences(nextPreferences)
    setDeepSeekStatusMessage('')
    setSettingsDiagnosticMessage('')
    setGlobalFeedback('设置已经恢复默认。')
    tellPet('success', '设置已经恢复默认，小咪重新整理好啦。')
  }

  async function restoreDefaultLayoutSize() {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      assistantSidebarWidthPx: null
    })

    await persistPreferences(nextPreferences)
    await window.bilimiDesktop?.restoreDefaultLayoutSize?.()
    setSettingsDiagnosticMessage('')
    setGlobalFeedback('布局大小已恢复默认。')
    tellPet('success', '布局大小已经恢复默认啦。')
  }

  async function copyDeepSeekRecommendation(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setGlobalFeedback(`已复制${label}。`)
      tellPet('success', `${label}已复制好啦。`)
    } catch {
      setGlobalFeedback(`${label}复制失败，请手动复制。`)
      tellPet('error', `${label}复制失败，请主人手动复制。`)
    }
  }

  function createCurrentPageDiagnosticItem(): StartupDiagnosticItem {
    const activeUrl = resolvedSnapshot.activeTabUrl?.trim() ?? ''

    if (/bilibili\.com/i.test(activeUrl)) {
      return {
        id: 'bilibili-page',
        label: '当前 B 站页面',
        status: 'ok',
        message: hasCurrentVideo ? '当前已打开 B 站视频页面。' : '当前已打开 B 站页面。'
      }
    }

    return {
      id: 'bilibili-page',
      label: '当前 B 站页面',
      status: 'warning',
      message: '当前没有打开 B 站页面。',
      action: '需要点赞、收藏、投币、弹幕或转写时，请先打开 B 站视频页面并确认已登录。'
    }
  }

  async function runSettingsDiagnostics() {
    if (!window.bilimiDesktop?.runStartupDiagnostics) {
      setGlobalFeedback('诊断功能尚未加载，请重启应用后再试。')
      tellPet('error', '诊断功能还没有加载好。')
      return
    }

    setSettingsDiagnosticRunning(true)
    setSettingsDiagnosticMessage('')
    tellPet('progress', '正在运行 bilimi 诊断。')

    try {
      const report = await window.bilimiDesktop.runStartupDiagnostics()
      const nextReport = {
        ...report,
        items: [...report.items, createCurrentPageDiagnosticItem()]
      }

      setSettingsDiagnosticReport(nextReport)
      setSettingsDiagnosticsExpanded(true)
      setSettingsDiagnosticMessage('')
      setGlobalFeedback(nextReport.ok ? '诊断完成。' : '诊断完成，有项目需要处理。')
      tellPet(nextReport.ok ? 'success' : 'error', nextReport.ok ? '诊断完成。' : '诊断发现需要处理的项目。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '诊断失败。'
      setSettingsDiagnosticMessage('')
      setGlobalFeedback(message)
      tellPet('error', message)
    } finally {
      setSettingsDiagnosticRunning(false)
    }
  }

  async function persistFeedback(action: AssistantAction, kind: RecommendationKind) {
    const nextPreferences = recordAssistantPreferenceFeedback(preferencesRef.current, kind, action)
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
    setGlobalFeedback(action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。')

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
      setGlobalFeedback(result.message)
      tellPet(
        result.ok ? 'done' : 'error',
        result.ok ? ACTION_SUCCESS_HINTS[action] : createActionErrorHint(action, result)
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
      setGlobalFeedback(message)
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
      void runAction('赐', { coinCount: preferences.defaultCoinCount })
      return
    }

    if (action === '表') {
      setCommentChooserOpen(false)
      if (!hasCurrentVideo) {
        setFeedback({
          tone: 'error',
          message: '未打开视频',
          steps: [],
          missingTargets: ['current-video']
        })
        tellPet('error', '未打开视频，小咪等主人打开视频页再拟短评。')
        return
      }

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

  useEffect(() => {
    return window.bilimiDesktop?.onOpenFloatingAssistantWorkspace?.((payload) => {
      if (!workspaceRequestsEnabledRef.current) {
        return
      }

      if (payload.openNoteArchive) {
        void loadVideoNoteArchives()
        setActiveTab(payload.tab, { view: 'noteArchive' })
      } else {
        setActiveTab(payload.tab)
      }

      if (payload.organizeOldFavorites) {
        tellPet('progress', '小咪切到掌库啦，旧藏整理从这里开始。')
        setOrganizeOldFavoritesRequestSignal((signal) => signal + 1)
      }

      if (payload.action) {
        window.setTimeout(() => {
          handleAction(payload.action!)
        }, 0)
      }
    })
  }, [loadVideoNoteArchives, workspaceRequestsEnabled])

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

      if (noteToStore && options?.summarizeWithDeepSeek) {
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

    if (!hasCurrentVideo) {
      setFeedback({
        tone: 'error',
        message: '未打开视频',
        steps: [],
        missingTargets: ['current-video']
      })
      tellPet('error', '未打开视频，小咪等主人打开视频页再转写音频。')
      return null
    }

    tellPet('progress', '已加入转写队列，小咪会按顺序处理。')
    setGlobalFeedback('已加入转写队列')
    const nextQueue = await window.bilimiDesktop.enqueueCurrentVideoAudioTranscription?.(options)

    if (nextQueue) {
      transcriptionQueueRef.current = nextQueue
      setTranscriptionQueue(nextQueue)
      clearCurrentVideoMissingFeedback()
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
    note: VideoNote,
    summaryText?: string
  ) {
    const archives =
      (await window.bilimiDesktop?.updateVideoNoteArchiveVersion?.(
        archiveId,
        versionId,
        note,
        summaryText
      )) ?? []
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
    tellPet('progress', '小咪正在检查 bilimi 分册是否齐全。')
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
        ...preferencesRef.current,
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

  async function organizeOldFavoritesWithDeepSeek(
    _mode: DeepSeekArchiveMode,
    request: DeepSeekGenerateRequest
  ): Promise<DeepSeekGenerateResult | null | undefined> {
    tellPet('progress', '小咪正在请 DeepSeek 整理旧藏。')
    const result = await window.bilimiDesktop?.generateDeepSeek?.(request)
    tellPet(
      result?.kind === 'favorite-archive-organize' ? 'success' : 'error',
      result?.kind === 'favorite-archive-organize'
        ? 'DeepSeek 旧藏整理结果已返回。'
        : 'DeepSeek 旧藏整理没有返回可用结果。'
    )
    return result
  }

  function mergeDeepSeekArchiveKeywordSuggestions(suggestions: FavoriteKeywordSuggestion[]) {
    if (suggestions.length === 0) {
      return
    }

    const existingIds = new Set(
      preferencesRef.current.favoriteKeywordSuggestions.map((suggestion) => suggestion.id)
    )
    const existingSignatures = new Set(
      preferencesRef.current.favoriteKeywordSuggestions.map(keywordSuggestionSignature)
    )
    const nextIncomingSuggestions: FavoriteKeywordSuggestion[] = []

    for (const suggestion of suggestions) {
      const signature = keywordSuggestionSignature(suggestion)
      if (existingIds.has(suggestion.id) || existingSignatures.has(signature)) {
        continue
      }
      existingIds.add(suggestion.id)
      existingSignatures.add(signature)
      nextIncomingSuggestions.push(suggestion)
    }

    const nextSuggestions = [
      ...preferencesRef.current.favoriteKeywordSuggestions,
      ...nextIncomingSuggestions
    ]

    persistPreferencePatch({ favoriteKeywordSuggestions: nextSuggestions })
  }

  function confirmArchiveCorrectionRecords(records: FavoriteCorrectionRecord[]) {
    if (!preferencesRef.current.favoriteCorrectionLearningEnabled || records.length === 0) {
      return
    }

    const existingIds = new Set(
      preferencesRef.current.favoriteCorrectionRecords.map((record) => record.id)
    )
    const nextRecords = [
      ...preferencesRef.current.favoriteCorrectionRecords,
      ...records.filter((record) => !existingIds.has(record.id))
    ]

    persistPreferencePatch({ favoriteCorrectionRecords: nextRecords })
  }

  function handleOldFavoriteExecutionStateChange(state: 'running' | 'finished') {
    setOldFavoriteExecutionState(state)
    setGlobalFeedback(state === 'running' ? '旧藏整理中' : '本次整理已结束')
    tellPet(
      state === 'running' ? 'progress' : 'success',
      state === 'running' ? '旧藏整理中，请耐心等待。' : '本次整理已结束。'
    )
  }

  function handleOldFavoriteStatusUpdate(status: {
    label: string
    message: string
    tone: GlobalStatusTone
  }) {
    setOldFavoriteGlobalStatus({
      label: status.label,
      detail: status.message,
      tone: status.tone
    })
    setGlobalFeedback(status.message)
  }

  function closeAssistant() {
    if (isSidebarMode) {
      onRequestCollapse?.()
      return
    }

    tellPet('sleepy', pickPetLine(PET_COLLAPSE_FAREWELL_LINES))
    window.bilimiDesktop?.closeFloatingAssistant?.()
  }

  useEffect(() => {
    if (isSidebarMode) {
      return
    }

    const closeOnBlur = () => closeAssistant()

    window.addEventListener('blur', closeOnBlur)

    return () => {
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [isSidebarMode])

  function closeAssistantFromBlankWorkspace(event: PointerEvent<HTMLElement>) {
    if (isSidebarMode || event.target !== event.currentTarget) {
      return
    }

    closeAssistant()
  }

  const pendingKeywordSuggestions = preferences.favoriteKeywordSuggestions.filter(
    (suggestion) => suggestion.status === 'pending'
  )

  const workspace = (
    <section
      className={isSidebarMode ? 'assistant-sidebar-workspace' : 'floating-assistant-workspace'}
      onPointerDown={closeAssistantFromBlankWorkspace}
    >
        <div className="floating-assistant-chrome">
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

          <section className="floating-assistant-global-status" aria-label="全局提示区">
            <p
              className="floating-assistant-global-status__feedback"
              aria-label="全局提示"
              aria-live="polite"
            >
              {displayedGlobalFeedbackMessage}
            </p>
            <div className="floating-assistant-global-status__lights" aria-label="后台状态灯">
              {[
                { ...globalDeepSeekStatus, ariaLabel: 'DeepSeek状态' },
                { ...globalTranscriptionStatus, ariaLabel: '转写音频状态' },
                { ...globalLedgerStatus, ariaLabel: '整理状态' }
              ].map((item) => (
                <span
                  key={item.label}
                  className="floating-assistant-global-status__light"
                  data-tone={item.tone}
                  aria-label={item.ariaLabel}
                  title={item.detail}
                >
                  <span className="floating-assistant-global-status__dot" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </section>
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
            onOldFavoriteStatusUpdate={handleOldFavoriteStatusUpdate}
            onOpenOldFavoriteVideo={onOpenInTab}
            onRejudgeOldFavorite={rejudgeOldFavorite}
            deepSeekArchiveAvailable={
              preferences.deepseekEnabled &&
              preferences.deepseekApiKeyStored &&
              preferences.deepseekDailyClassificationEnabled
            }
            onOrganizeOldFavoritesWithDeepSeek={organizeOldFavoritesWithDeepSeek}
            onDeepSeekArchiveKeywordSuggestions={mergeDeepSeekArchiveKeywordSuggestions}
            onConfirmArchiveCorrections={confirmArchiveCorrectionRecords}
            favoriteArchiveMultiMode={preferences.favoriteArchiveMultiMode}
            organizeOldFavoritesRequestSignal={organizeOldFavoritesRequestSignal}
          />
        </div>

        {activeView === 'ledger' ? null : activeView === 'settings' ? (
          <section className="assistant-settings" aria-label="助手设置">
            <header>
              <div className="assistant-settings__title-row">
                <h2>设置</h2>
                <div className="assistant-settings__header-actions">
                  <button type="button" onClick={() => void restoreDefaultLayoutSize()}>
                    恢复默认布局
                  </button>
                  <button type="button" onClick={() => void resetAssistantSettings()}>
                    重置设置
                  </button>
                </div>
              </div>
              <label className="assistant-settings__jump">
                <span>设置项</span>
                <select
                  value={settingsJumpValue}
                  onChange={(event) =>
                    jumpToSettingsSection(event.currentTarget.value as SettingsJumpValue)
                  }
                >
                  {SETTINGS_JUMP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </header>
            <div
              className="assistant-settings__body"
              ref={settingsBodyRef}
              onScroll={syncSettingsJumpFromScroll}
            >
              <fieldset
              className="assistant-settings__group assistant-settings__group--diagnostics"
              data-settings-section="diagnostics"
            >
              <legend>诊断</legend>
              <div className="assistant-settings__diagnostics-head">
                <div>
                  <strong>启动与功能诊断</strong>
                  <small>检查 B 站网络、本地媒体工具、DeepSeek、存储和当前页面状态。</small>
                </div>
                <button
                  type="button"
                  onClick={() => void runSettingsDiagnostics()}
                  disabled={settingsDiagnosticRunning}
                >
                  {settingsDiagnosticRunning ? '诊断中' : '运行诊断'}
                </button>
                {settingsDiagnosticReport ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSettingsDiagnosticsExpanded((currentExpanded) => !currentExpanded)
                    }
                  >
                    {settingsDiagnosticsExpanded ? '收起诊断' : '展开诊断'}
                  </button>
                ) : null}
              </div>
              {settingsDiagnosticReport && settingsDiagnosticsExpanded ? (
                <ul className="assistant-settings__diagnostics-list" aria-label="设置诊断结果">
                  {settingsDiagnosticReport.items.map((item) => (
                    <li key={item.id} data-status={item.status}>
                      <strong>{item.label}</strong>
                      <span>{item.message}</span>
                      {item.action ? <small>{item.action}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--deepseek"
              data-settings-section="deepseek"
            >
              <legend>DeepSeek</legend>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.deepseekEnabled}
                  onChange={(event) =>
                    toggleDeepSeekEnabled(event.currentTarget.checked)
                  }
                />
                <span>启用 DeepSeek</span>
              </label>
              <p className="assistant-settings__deepseek-help">
                开启后可使用批阅短评、札记总结、宠物对话和辅助整理。关闭后相关功能入口会提示先开启。
              </p>
              {preferences.deepseekEnabled ? (
                <>
                  <div className="assistant-settings__deepseek-switches">
                    <label title="用 DeepSeek 根据当前视频生成更自然的评论候选。">
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
                      <span>趣味评论</span>
                    </label>
                    <label title="转写音频完成后，自动用 DeepSeek 生成结构化总结。">
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
                      <span>自动总结</span>
                    </label>
                    <label title="让小咪可以用 DeepSeek 回答问题和聊天。">
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
                      <span>宠物对话</span>
                    </label>
                    <label title="在整理旧藏时，用 DeepSeek 帮忙判断视频适合放到哪个收藏夹。">
                      <input
                        type="checkbox"
                        checked={preferences.deepseekDailyClassificationEnabled}
                        onChange={(event) =>
                          updateDeepSeekPreference(
                            {
                              deepseekDailyClassificationEnabled: event.currentTarget.checked
                            },
                            { persist: true }
                          )
                        }
                      />
                      <span>辅助整理</span>
                    </label>
                  </div>
                  {preferences.deepseekDailyClassificationEnabled ? (
                    <div className="assistant-settings__deepseek-switches assistant-settings__deepseek-switches--nested">
                      <label title="所有归档建议都交给 DeepSeek 再判断一遍，更细但更慢。">
                        <input
                          type="radio"
                          name="deepseek-daily-classification-mode"
                          checked={preferences.deepseekDailyClassificationMode === 'all'}
                          onChange={() =>
                            updateDeepSeekPreference(
                              { deepseekDailyClassificationMode: 'all' },
                              { persist: true }
                            )
                          }
                        />
                        <span>全部归类</span>
                      </label>
                      <label title="只让 DeepSeek 处理不太确定的归档建议，速度更快。">
                        <input
                          type="radio"
                          name="deepseek-daily-classification-mode"
                          checked={
                            preferences.deepseekDailyClassificationMode === 'low-confidence-only'
                          }
                          onChange={() =>
                            updateDeepSeekPreference(
                              { deepseekDailyClassificationMode: 'low-confidence-only' },
                              { persist: true }
                            )
                          }
                        />
                        <span>仅不太稳</span>
                      </label>
                    </div>
                  ) : null}
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
                    <strong>致谢 云枢智元</strong>
                    <p>大模型 Token 中转，低至官方价 2 折起</p>
                    <p>
                      <a href="https://yunshulink.com/" target="_blank" rel="noreferrer">
                        官网：https://yunshulink.com/
                      </a>
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
                        复制
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
                        复制
                      </button>
                    </p>
                  </aside>
                </>
              ) : null}
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--pet"
              data-settings-section="pet"
            >
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
            <fieldset
              className="assistant-settings__group assistant-settings__group--transcription"
              data-settings-section="transcription"
            >
              <legend>视频音频转写速度</legend>
              <p>控制本地 whisper.cpp / whisper-cli.exe 转写视频音频能使用多少 CPU 线程；限制越低，电脑越不容易卡，但转写会更慢。</p>
              <label>
                <input
                  type="radio"
                  name="video-audio-transcription-thread-limit"
                  checked={preferences.videoAudioTranscriptionThreadLimit === 'unlimited'}
                  onChange={() =>
                    persistPreferencePatch({ videoAudioTranscriptionThreadLimit: 'unlimited' })
                  }
                />
                <span>无限制（最快，占用最高）</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="video-audio-transcription-thread-limit"
                  checked={preferences.videoAudioTranscriptionThreadLimit === 1}
                  onChange={() =>
                    persistPreferencePatch({ videoAudioTranscriptionThreadLimit: 1 })
                  }
                />
                <span>限制为 1 线程（省电）</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="video-audio-transcription-thread-limit"
                  checked={preferences.videoAudioTranscriptionThreadLimit === 2}
                  onChange={() =>
                    persistPreferencePatch({ videoAudioTranscriptionThreadLimit: 2 })
                  }
                />
                <span>限制为 2 线程（平衡）</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="video-audio-transcription-thread-limit"
                  checked={preferences.videoAudioTranscriptionThreadLimit === 4}
                  onChange={() =>
                    persistPreferencePatch({ videoAudioTranscriptionThreadLimit: 4 })
                  }
                />
                <span>限制为 4 线程（较快）</span>
              </label>
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--archive"
              data-settings-section="archive"
            >
              <legend>bilimi 收藏策略</legend>
              <p>说明：设置一个待分类视频最多可同时保存到几个合适的 bilimi 收藏夹。</p>
              <p>1. 用户原收藏夹不会被移动或删除，也不计入数量。</p>
              <p>2. 优先保存到 bilimi 中系统推荐生成和用户自定义创建的收藏夹。</p>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'off'}
                  onChange={() =>
                    persistPreferencePatch({ favoriteArchiveMultiMode: 'off' })
                  }
                />
                <span>最多同时保存到 1 个 bilimi 收藏夹</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'two'}
                  onChange={() =>
                    persistPreferencePatch({ favoriteArchiveMultiMode: 'two' })
                  }
                />
                <span>最多同时保存到 2 个 bilimi 收藏夹</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="favorite-archive-multi-mode"
                  checked={preferences.favoriteArchiveMultiMode === 'three'}
                  onChange={() =>
                    persistPreferencePatch({ favoriteArchiveMultiMode: 'three' })
                  }
                />
                <span>最多同时保存到 3 个 bilimi 收藏夹</span>
              </label>
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--learning"
              data-settings-section="learning"
            >
              <legend>整理策略</legend>
              <div className="assistant-settings__inline-options">
                {ARCHIVE_STRATEGY_OPTIONS.map((option) => (
                  <label key={option.value}>
                    <input
                      type="radio"
                      name="favorite-archive-strategy"
                      checked={preferences.favoriteArchiveStrategy === option.value}
                      onChange={() =>
                        persistPreferencePatch({ favoriteArchiveStrategy: option.value })
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.favoriteCorrectionLearningEnabled}
                  onChange={(event) =>
                    persistPreferencePatch({
                      favoriteCorrectionLearningEnabled: event.currentTarget.checked
                    })
                  }
                />
                <span>记录纠错学习</span>
              </label>
              <small
                className="assistant-settings__option-help"
                title={FAVORITE_CORRECTION_LEARNING_HELP}
              >
                {FAVORITE_CORRECTION_LEARNING_HELP}
              </small>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.favoriteCorrectionLearningClassificationEnabled}
                  onChange={(event) =>
                    persistPreferencePatch({
                      favoriteCorrectionLearningClassificationEnabled: event.currentTarget.checked
                    })
                  }
                />
                <span>纠错学习参与分类</span>
              </label>
              <small
                className="assistant-settings__option-help"
                title={FAVORITE_CORRECTION_CLASSIFICATION_HELP}
              >
                {FAVORITE_CORRECTION_CLASSIFICATION_HELP}
              </small>
              <div className="assistant-settings__subsection assistant-settings__subsection--records">
                <div className="assistant-settings__subsection-heading">
                  <strong>纠错学习记录（{preferences.favoriteCorrectionRecords.length}）</strong>
                  <button
                    type="button"
                    onClick={clearCorrectionRecords}
                    disabled={preferences.favoriteCorrectionRecords.length === 0}
                  >
                    清空纠错记录
                  </button>
                </div>
                {preferences.favoriteCorrectionRecords.length > 0 ? (
                  <div className="assistant-settings__learning-list">
                    {preferences.favoriteCorrectionRecords.map(
                      (record: FavoriteCorrectionRecord) => {
                        const originalLedger = getLedgerDisplayName(
                          preferences.favoriteLedgers,
                          record.originalLedgerId
                        )
                        const userLedgers = joinSettingValues(
                          record.userLedgerIds.map((ledgerId) =>
                            getLedgerDisplayName(preferences.favoriteLedgers, ledgerId)
                          )
                        )
                        const summaryText = `原建议：${originalLedger}；用户选择：${userLedgers}；时间：${formatSettingsDate(record.confirmedAt ?? record.createdAt)}`

                        return (
                          <article
                            key={record.id}
                            className="assistant-settings__learning-item"
                          >
                            <div className="assistant-settings__learning-head">
                              <span className="assistant-settings__learning-summary">
                                <strong title={record.title}>{record.title}</strong>
                                <small title={summaryText}>{summaryText}</small>
                              </span>
                              <span className="assistant-settings__learning-actions">
                                <button
                                  type="button"
                                  aria-label={`删除纠错 ${record.title}`}
                                  onClick={() => deleteCorrectionRecord(record.id)}
                                >
                                  删除
                                </button>
                              </span>
                            </div>
                            <div className="assistant-settings__learning-detail">
                              <span title={record.author?.trim() || '未记录'}>UP：{record.author?.trim() || '未记录'}</span>
                              <span title={joinSettingValues(record.tags)}>标签：{joinSettingValues(record.tags)}</span>
                              <span title={record.sourceScene}>来源场景：{record.sourceScene}</span>
                              <span title={record.sourceFolderTitle?.trim() || '未记录'}>来源收藏夹：{record.sourceFolderTitle?.trim() || '未记录'}</span>
                              <span title={joinSettingValues(record.matchedKeywords)}>命中关键词：{joinSettingValues(record.matchedKeywords)}</span>
                              <span title={String(record.score ?? '未记录')}>匹配分：{record.score ?? '未记录'}</span>
                              <span title={String(record.confidence ?? '未记录')}>分类把握：{record.confidence ?? '未记录'}</span>
                              <span title={String(record.scoreGap ?? '未记录')}>领先第二候选：{record.scoreGap ?? '未记录'}</span>
                            </div>
                          </article>
                        )
                      }
                    )}
                  </div>
                ) : (
                  <p className="assistant-settings__empty">暂无纠错记录</p>
                )}
              </div>
              <div className="assistant-settings__subsection">
                <div className="assistant-settings__subsection-heading">
                  <strong>关键词建议（{pendingKeywordSuggestions.length}）</strong>
                </div>
                {pendingKeywordSuggestions.length > 0 ? (
                  <div className="assistant-settings__keyword-list">
                    {pendingKeywordSuggestions.map((suggestion) => {
                      const targetLabel = getLedgerDisplayName(
                        preferences.favoriteLedgers,
                        suggestion.ledgerId
                      )
                      const keywordLabel =
                        suggestion.keyword?.trim() ||
                        suggestion.replacement?.trim() ||
                        suggestion.id
                      const isPending = suggestion.status === 'pending'

                      return (
                        <article key={suggestion.id} className="assistant-settings__keyword-item">
                          <div className="assistant-settings__keyword-summary">
                            <strong title={KEYWORD_SUGGESTION_ACTION_LABELS[suggestion.action]}>
                              {KEYWORD_SUGGESTION_ACTION_LABELS[suggestion.action]}
                            </strong>
                            <span title={targetLabel}>目标收藏夹：{targetLabel}</span>
                            <span title={suggestion.keyword?.trim() || '未记录'}>
                              关键词：{suggestion.keyword?.trim() || '未记录'}
                            </span>
                            <span title={suggestion.replacement?.trim() || '未记录'}>
                              替换词：{suggestion.replacement?.trim() || '未记录'}
                            </span>
                            <small title={suggestion.reason}>理由：{suggestion.reason}</small>
                          </div>
                          <div className="assistant-settings__keyword-actions">
                            <button
                              type="button"
                              aria-label={`采纳建议 ${keywordLabel}`}
                              disabled={!isPending}
                              onClick={() => acceptKeywordSuggestion(suggestion)}
                            >
                              <span>采纳</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`忽略建议 ${keywordLabel}`}
                              disabled={!isPending}
                              onClick={() =>
                                updateKeywordSuggestionStatus(suggestion.id, 'ignored')
                              }
                            >
                              <span>忽略</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`删除建议 ${keywordLabel}`}
                              onClick={() =>
                                updateKeywordSuggestionStatus(suggestion.id, 'deleted')
                              }
                            >
                              <span>删除</span>
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="assistant-settings__empty">暂无关键词建议</p>
                )}
              </div>
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--review-actions"
              data-settings-section="review-actions"
            >
              <legend>批阅动作设置</legend>
              <strong className="assistant-settings__review-action-title">赐：一键三连</strong>
              <label>
                <input
                  type="radio"
                  name="default-coin-count"
                  checked={preferences.defaultCoinCount === 1}
                  onChange={() =>
                    persistPreferencePatch({ defaultCoinCount: 1 })
                  }
                />
                <span>默认投 1 枚硬币（再点一次可补投 1 枚）</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="default-coin-count"
                  checked={preferences.defaultCoinCount === 2}
                  onChange={() =>
                    persistPreferencePatch({ defaultCoinCount: 2 })
                  }
                />
                <span>默认投 2 枚硬币</span>
              </label>
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <strong className="assistant-settings__review-action-title">表：发送弹幕</strong>
              <label>
                <input
                  type="radio"
                  name="comment-submit-mode"
                  checked={preferences.commentSubmitMode === 'random'}
                  onChange={() =>
                    persistPreferencePatch({ commentSubmitMode: 'random' })
                  }
                />
                <span>随机生成一条并直接发送</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="comment-submit-mode"
                  checked={preferences.commentSubmitMode === 'choose'}
                  onChange={() =>
                    persistPreferencePatch({ commentSubmitMode: 'choose' })
                  }
                />
                <span>生成 3 条候选，选择后发送（也可以复制后发评论）</span>
              </label>
            </fieldset>
            </div>
          </section>
        ) : (
          <>
            <div className="floating-assistant-view" hidden={activeView !== 'noteArchive'}>
              <VideoNoteArchivePanel
                archives={videoNoteArchives}
                onClose={() => {
                  setNotesWorkspaceView('notes')
                  setActiveTab('notes', { view: 'notes' })
                }}
                onOpenSource={(url) => window.open(url)}
                onUpdateVersion={updateVideoNoteArchiveVersion}
                onDeleteEntry={deleteVideoNoteArchiveEntry}
                onDeleteVersion={deleteVideoNoteArchiveVersion}
                deepSeekEnabled={preferences.deepseekEnabled}
                onGeneratePoster={generateNotePoster}
                onArchivePosterSummary={archiveNotePosterSummary}
              />
            </div>
            <div className="floating-assistant-view" hidden={activeView === 'noteArchive'}>
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
                showCloseButton={false}
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
                videoNoteArchives={videoNoteArchives}
                videoNoteLoading={videoNoteLoading}
                transcriptionProgress={transcriptionProgress}
                transcriptionQueue={transcriptionQueue}
                runningAction={runningAction}
                actionsLocked={actionsLocked}
                feedback={feedback}
                onOpenVideoNoteArchive={() => {
                  void loadVideoNoteArchives()
                  setNotesWorkspaceView('noteArchive')
                  setActiveView('noteArchive')
                }}
                initialTab={activeView === 'notes' ? 'notes' : 'review'}
                showTabs={false}
                videoNotesResultTab={videoNotesResultTab}
                onVideoNotesResultTabChange={setVideoNotesResultTab}
                defaultCoinCount={preferences.defaultCoinCount}
                commentSubmitMode={preferences.commentSubmitMode}
                onPreferenceChange={persistPreferencePatch}
              />
            </div>
          </>
        )}

        {!isSidebarMode ? (
          <button
            className="floating-assistant-workspace__fold"
            type="button"
            onClick={closeAssistant}
          >
            合折
          </button>
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
      <div className="assistant-sidebar-embed" aria-label="bilimi 应用侧栏">
        {workspace}
      </div>
    )
  }

  return (
    <main className="floating-assistant-shell" aria-label="bilimi 悬浮助手">
      {workspace}
    </main>
  )
}
