import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekArchiveMode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekTask,
  FavoriteCorrectionRecord,
  FavoriteArchiveProtectionRecord,
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
  PET_HOVER_SHORTCUT_LIMIT,
  PET_SORTABLE_HOVER_SHORTCUTS,
  normalizePetHoverShortcuts,
  type PetHoverShortcutId
} from '@shared/petHoverShortcuts'
import { createNotePosterText } from '@shared/videoNoteArchive'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { upsertFavoriteArchiveProtectionRecords } from '@shared/favoriteArchiveProtection'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeVideoClassificationRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback,
  withFavoriteLedgersForAccount
} from '../state/assistantState'
import {
  createPreferenceSaveScheduler,
  type PreferenceSaveScheduler
} from '../state/preferenceSaveScheduler'
import { CommentChooser } from './CommentChooser'
import { CommentIntentDialog } from './CommentIntentDialog'
import { ControlledFavoriteLedgerPanel } from './ControlledFavoriteLedgerPanel'
import { LocalDataSettings } from './LocalDataSettings'
import { MemorialPanel } from './MemorialPanel'
import type { VideoNotesResultTab } from '../notes/VideoNotesPanel'
import {
  VideoNoteArchivePanel,
  type VideoNoteArchiveSelection
} from '../notes/VideoNoteArchivePanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import type { AssistantPetHint } from './petState'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { PET_COLLAPSE_FAREWELL_LINES, pickPetLine } from './petInteractionLines'
import { publishDeepSeekTask, subscribeDeepSeekTasks } from './deepSeekTaskSignal'

const CURRENT_TITLE = '等待视频加载'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/[^/?#]+/i
const BILIBILI_PAGE_PATTERN = /bilibili\.com/i
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const VIDEO_NOTE_ARCHIVE_SELECTION_SESSION_KEY = 'bilimi.videoNoteArchive.selection'
const DEEPSEEK_KEY_STATUS_LABELS = {
  savedSecure: '已保存 · 系统加密保护',
  savedPlain: '已保存 · 本地明文保存',
  unreadable: '无法读取 · 请重新填写',
  unsaved: '尚未保存'
} as const

type DeepSeekKeyFieldStatus = keyof typeof DEEPSEEK_KEY_STATUS_LABELS
const EMPTY_VIDEO_NOTE_ARCHIVE_SELECTION: VideoNoteArchiveSelection = {
  archiveId: null,
  versionId: null,
  activeResultTab: null
}
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

function isVideoNoteArchiveResultTab(value: unknown): value is VideoNoteArchiveSelection['activeResultTab'] {
  return value === null || value === 'plain' || value === 'timed' || value === 'summary'
}

function normalizeVideoNoteArchiveSelection(value: unknown): VideoNoteArchiveSelection {
  if (!value || typeof value !== 'object') {
    return EMPTY_VIDEO_NOTE_ARCHIVE_SELECTION
  }

  const candidate = value as Partial<Record<keyof VideoNoteArchiveSelection, unknown>>
  return {
    archiveId: typeof candidate.archiveId === 'string' ? candidate.archiveId : null,
    versionId: typeof candidate.versionId === 'string' ? candidate.versionId : null,
    activeResultTab: isVideoNoteArchiveResultTab(candidate.activeResultTab)
      ? candidate.activeResultTab
      : null
  }
}

function loadSessionVideoNoteArchiveSelection(): VideoNoteArchiveSelection {
  try {
    const rawValue = window.sessionStorage.getItem(VIDEO_NOTE_ARCHIVE_SELECTION_SESSION_KEY)
    return rawValue
      ? normalizeVideoNoteArchiveSelection(JSON.parse(rawValue))
      : EMPTY_VIDEO_NOTE_ARCHIVE_SELECTION
  } catch {
    return EMPTY_VIDEO_NOTE_ARCHIVE_SELECTION
  }
}

function saveSessionVideoNoteArchiveSelection(selection: VideoNoteArchiveSelection): void {
  try {
    window.sessionStorage.setItem(
      VIDEO_NOTE_ARCHIVE_SELECTION_SESSION_KEY,
      JSON.stringify(selection)
    )
  } catch {
    // Storage can be unavailable in restricted renderer contexts; in-memory state still works.
  }
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

function createActionSuccessHint(action: AssistantAction, resultMessage: string): string {
  const agreedTarget = resultMessage.match(/与本地判断一致，保留在「([^」]+)」/)?.[1]
  if (agreedTarget) {
    return `主人，DeepSeek复核过啦～与原建议一致，存入「${agreedTarget}」。`
  }

  const adjustedTargets = resultMessage.match(/建议从「([^」]+)」改归「([^」]+)」，已按二判结果执行/)
  if (adjustedTargets) {
    return `主人，DeepSeek重新判断有调整哦～已从「${adjustedTargets[1]}」改存到「${adjustedTargets[2]}」。`
  }

  const targetLabel = resultMessage.match(/归类存入\s+([^\n。]+)/)?.[1]?.trim()

  if (!targetLabel) return ACTION_SUCCESS_HINTS[action]

  if (action === '赏') {
    return `主人，做好啦～已点赞，归类存入「${targetLabel}」。`
  }

  if (action === '藏') {
    return `主人，收好啦～已归类存入「${targetLabel}」。`
  }

  if (action === '赐') {
    return `厚赏完成～已一键三连，替主人归类存入「${targetLabel}」。`
  }

  return ACTION_SUCCESS_HINTS[action]
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
type DeepSeekConnectionStatus = 'pending' | 'connected' | 'failed'

type GlobalStatusItem = {
  label: string
  detail: string
  tone: GlobalStatusTone
}

export function favoriteWorkspaceReadinessMessage(args: {
  hasBilibiliPageOpen: boolean
  hasMissingFavoriteLedgers: boolean
  activeTab: AssistantWorkspaceTab
}) {
  if (!args.hasBilibiliPageOpen && args.hasMissingFavoriteLedgers) {
    return '请先登录 B 站，并到掌库备册。'
  }
  if (!args.hasBilibiliPageOpen) return '请先登录 B 站。'
  if (args.hasMissingFavoriteLedgers) {
    return args.activeTab === 'ledger'
      ? '当前只有本地默认收藏夹模板，请点击“备册”创建并绑定 bilimi 收藏夹。'
      : '请到掌库备册后再开始整理。'
  }
  return '准备就绪。'
}

export function favoriteOrganizationStatus(
  snapshot: OldFavoriteWorkspaceSnapshot | null
): GlobalStatusItem | null {
  if (!snapshot) return null

  if (snapshot.scan.phase === 'failed') {
    return {
      label: '整理异常',
      detail: snapshot.scan.reason?.trim() || '扫描未完成，请打开收藏整理后重试。',
      tone: 'error'
    }
  }

  if (snapshot.status === 'scanning') {
    return {
      label: '整理扫描中',
      detail: `正在${snapshot.scan.phase === 'tags' ? '补充视频标签' : '扫描旧收藏'}，请勿重复启动。`,
      tone: 'running'
    }
  }

  if (snapshot.status === 'executing') {
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    return {
      label: '整理执行中',
      detail: total > 0 ? `正在同步到 B 站：${completed} / ${total}。` : '正在同步到 B 站。',
      tone: 'running'
    }
  }

  if (snapshot.status === 'reconciling') {
    return {
      label: '等待对账',
      detail: '远端结果需要核实；请在收藏整理中对账，系统不会重复提交未知结果。',
      tone: 'warn'
    }
  }

  const unclassifiedCount = snapshot.planReadiness?.unclassifiedAidCount ?? 0
  if (snapshot.status === 'completed') {
    return unclassifiedCount > 0
      ? { label: '整理完成，仍有待处理', detail: `本轮完成，仍有 ${unclassifiedCount} 条待处理。`, tone: 'warn' }
      : { label: '整理完成', detail: '本轮已完成；可以继续扫描新增旧收藏。', tone: 'ok' }
  }

  if (snapshot.status === 'frozen') {
    return { label: '等待执行', detail: '分类计划已确认，等待同步到 B 站。', tone: 'warn' }
  }

  return {
    label: '等待确认',
    detail: unclassifiedCount > 0
      ? `归档预览中，仍有 ${unclassifiedCount} 条待处理。`
      : '归档预览已就绪，等待确认执行。',
    tone: 'warn'
  }
}

const DEEPSEEK_TASK_DEFAULT_DETAIL: Record<DeepSeekTask['kind'], string> = {
  comment: '趣评生成',
  classification: '分类二判',
  summary: '文稿总结',
  'archive-organize': '旧藏整理',
  'pet-chat': '宠物对话',
  'connection-test': '连接测试'
}

function normalizeDeepSeekConnectionStatus(value: unknown): DeepSeekConnectionStatus {
  return value === 'connected' || value === 'failed' ? value : 'pending'
}

function favoriteLedgerBackupGap(ledgers: FavoriteLedger[]) {
  const enabledLedgers = ledgers.filter((ledger) => ledger.enabled && ledger.syncState !== 'local-draft')
  const enabledLedgersWithoutFolder = enabledLedgers.filter(
    (ledger) => !ledger.bilibiliFolderId?.trim()
  )

  return {
    enabledCount: enabledLedgers.length,
    enabledWithoutFolderCount: enabledLedgersWithoutFolder.length,
    backedEnabledCount: enabledLedgers.length - enabledLedgersWithoutFolder.length
  }
}

export function hasMissingFavoriteLedgerBindings(ledgers: FavoriteLedger[], favoriteLedgerStatus: FavoriteLedgerStatus | null) {
  const backupGap = favoriteLedgerBackupGap(ledgers)
  return Boolean(favoriteLedgerStatus?.missingLedgerIds.length) ||
    backupGap.enabledCount === 0 || backupGap.enabledWithoutFolderCount > 0
}

export function resolveFavoriteOrganizationLamp(args: {
  snapshot: OldFavoriteWorkspaceSnapshot | null
  defaultFavoriteSystemEnabled: boolean
  ledgers: FavoriteLedger[]
  favoriteLedgerStatus: FavoriteLedgerStatus | null
}): GlobalStatusItem {
  const organizationStatus = favoriteOrganizationStatus(args.snapshot)
  if (organizationStatus) return organizationStatus

  if (!args.defaultFavoriteSystemEnabled) {
    return {
      label: '整理空闲',
      detail: '默认收藏夹体系已关闭；暂存和已启用的自建收藏夹仍可用于本地归档预览。',
      tone: 'idle'
    }
  }

  const backupGap = favoriteLedgerBackupGap(args.ledgers)
  if (args.favoriteLedgerStatus?.backupConflictLedgerIds?.length) {
    return {
      label: '备册异常',
      detail: '发现同名 bilimi 收藏夹，无法安全备册；请先在 B 站手动处理重复收藏夹。',
      tone: 'error'
    }
  }
  if (args.favoriteLedgerStatus?.missingLedgerIds.length) {
    return {
      label: '未备册',
      detail: `还有 ${args.favoriteLedgerStatus.missingLedgerIds.length} 个 bilimi 收藏夹未备册。\n${FAVORITE_LEDGER_BACKUP_HINT}`,
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

  if (args.favoriteLedgerStatus?.ok) {
    return {
      label: '整理空闲',
      detail: 'bilimi 收藏夹已备齐，可以开始整理旧藏。',
      tone: 'ok'
    }
  }

  return {
    label: '整理空闲',
    detail: '暂未检查备册状态。',
    tone: 'idle'
  }
}

export function defaultFavoriteSystemToggleAvailable(accountMid: string | undefined) {
  return Boolean(accountMid)
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
  '记录卡片“转移”和 DeepSeek 改变系统原建议后实际执行成功的归档调整；系统自动批量迁移不会登记。'

function archiveAdjustmentMethodLabel(record: FavoriteCorrectionRecord): string {
  return record.source === 'user' ? '用户手动' : 'DeepSeek 整理'
}

function archiveAdjustmentSceneLabel(record: FavoriteCorrectionRecord): string {
  return record.sourceScene === 'archive-preview' ? '归档预览' : '日常收藏'
}

const KEYWORD_SUGGESTION_STATUS_LABELS: Record<FavoriteKeywordSuggestionStatus, string> = {
  pending: '待处理',
  accepted: '已采纳',
  ignored: '已忽略',
  deleted: '已删除'
}

export const SETTINGS_JUMP_OPTIONS = [
  { value: 'diagnostics', label: '诊断' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'learning', label: '整理策略' },
  { value: 'pet', label: '宠物设置' },
  { value: 'transcription', label: '视频音频转写速度' },
  { value: 'archive', label: '收藏整理' },
  { value: 'review-actions', label: '批阅动作' },
  { value: 'favorites', label: '收藏夹体系' },
  { value: 'bilibili-connection', label: 'B 站连接方式' },
  { value: 'local-data', label: '本地数据与迁移' },
  { value: 'close', label: '关闭设置' }
] as const
const SETTINGS_SCROLL_SYNC_OFFSET = 32

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

function formatDeepSeekFeatureLines(preferences: AssistantPreferences): string[] {
  const reviewMode =
    preferences.deepseekDailyClassificationMode === 'low-confidence-only'
      ? '仅不太稳'
      : '全部归类'

  return [
    preferences.deepseekCommentEnabled
      ? '趣味评论：开启，会生成候选弹幕，可复制发布为评论。'
      : '趣味评论：关闭，不会生成候选弹幕。',
    preferences.deepseekAutoSummaryEnabled
      ? '自动总结：开启，会在视频转写后生成文稿总结。'
      : '自动总结：关闭，不会在视频转写后生成文稿总结。',
    preferences.deepseekPetChatEnabled
      ? '宠物对话：开启，小咪会调用 DeepSeek 对话。'
      : '宠物对话：关闭，小咪不会调用 DeepSeek 对话。',
    preferences.deepseekDailyClassificationEnabled
      ? `批阅辅助：开启（${reviewMode}），会用 DeepSeek 复核批阅分类。`
      : '批阅辅助：关闭，不会使用 DeepSeek 复核批阅分类。',
    preferences.deepseekArchiveOrganizationEnabled
      ? '旧藏整理：开启，可在归档预览中手动执行 DeepSeek 整理。'
      : '旧藏整理：关闭，无法在归档预览中执行 DeepSeek 整理。'
  ]
}

function formatDeepSeekFeatureList(preferences: AssistantPreferences): string {
  return [
    preferences.deepseekEnabled && preferences.deepseekApiKeyStored
      ? 'DeepSeek 已连接。'
      : 'DeepSeek 未连接。',
    ...(preferences.deepseekEnabled && preferences.deepseekApiKeyStored
      ? [`当前模型：${preferences.deepseekModel || '未配置'}`]
      : []),
    ...formatDeepSeekFeatureLines(preferences)
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

  if (/^(主人|小咪|厚赏完成)/.test(trimmed)) {
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
    .replace(/^DeepSeek API request failed:\s*/, 'DeepSeek API 请求失败：')
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

function deepSeekKeyStatusConfigured(status: unknown): boolean {
  return Boolean(
    status &&
      typeof status === 'object' &&
      'configured' in status &&
      (status as { configured?: unknown }).configured
  )
}

function deepSeekKeyStatusUsesPlainStorage(status: unknown): boolean {
  if (!status || typeof status !== 'object') {
    return false
  }

  const protection = String((status as { protection?: unknown }).protection ?? '').toLowerCase()
  if (protection === 'plaintext') {
    return true
  }

  const storage = String(
    (status as { storage?: unknown; storageType?: unknown; backend?: unknown }).storage ??
      (status as { storageType?: unknown }).storageType ??
      (status as { backend?: unknown }).backend ??
      ''
  ).toLowerCase()

  return ['plain', 'plaintext', 'local-plain', 'local_plain', 'file'].includes(storage)
}

function deepSeekKeyFieldStatusFromKeyStatus(status: unknown): DeepSeekKeyFieldStatus {
  if (status && typeof status === 'object' && (status as { protection?: unknown }).protection === 'error') {
    return 'unreadable'
  }

  if (!deepSeekKeyStatusConfigured(status)) {
    return 'unsaved'
  }

  return deepSeekKeyStatusUsesPlainStorage(status) ? 'savedPlain' : 'savedSecure'
}

function arePreferenceValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
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
  const lastRuntimeFeedbackId = useRef<number | undefined>(undefined)
  const runtimeFeedbackSnapshotLoaded = useRef(false)
  const startupDeepSeekValidationAttempted = useRef(false)
  const deepSeekConnectionValidationInFlight = useRef(false)
  const deepSeekConnectionValidationSaveRequired = useRef(false)
  const snapshotLoadGeneration = useRef(0)
  const snapshotChangeLoadScheduled = useRef(false)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const preferencesRef = useRef(preferences)
  const committedPreferencesRef = useRef(preferences)
  const [favoriteLedgerStatus, setFavoriteLedgerStatus] = useState<FavoriteLedgerStatus | null>(null)
  const [favoriteOrganizationSnapshot, setFavoriteOrganizationSnapshot] =
    useState<OldFavoriteWorkspaceSnapshot | null>(null)
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
    items: [],
    sessionCompletedCount: 0
  })
  const [deepSeekApiKeyDraft, setDeepSeekApiKeyDraft] = useState('')
  const [deepSeekKeyFieldStatus, setDeepSeekKeyFieldStatus] =
    useState<DeepSeekKeyFieldStatus>('unsaved')
  const [deepSeekConnectionStatus, setDeepSeekConnectionStatus] =
    useState<DeepSeekConnectionStatus>('pending')
  const [settingsDiagnosticReport, setSettingsDiagnosticReport] =
    useState<StartupDiagnosticReport | null>(null)
  const [settingsDiagnosticRunning, setSettingsDiagnosticRunning] = useState(false)
  const [settingsDiagnosticMessage, setSettingsDiagnosticMessage] = useState('')
  const [settingsDiagnosticsExpanded, setSettingsDiagnosticsExpanded] = useState(true)
  const [settingsLearningMessage, setSettingsLearningMessage] = useState('')
  const [settingsKeywordSuggestionView, setSettingsKeywordSuggestionView] =
    useState<'pending' | 'processed'>('pending')
  const [settingsJumpValue, setSettingsJumpValue] = useState<SettingsJumpValue>('diagnostics')
  const [localDataInfo, setLocalDataInfo] = useState<{ path: string; accounts: Array<{ uid: string; retained: boolean }> } | null>(null)
  const [localDataUnavailable, setLocalDataUnavailable] = useState(false)
  const [globalFeedbackMessage, setGlobalFeedbackMessage] = useState('')
  const [localDeepSeekTasks, setLocalDeepSeekTasks] = useState<DeepSeekTask[]>([])
  const [remoteDeepSeekTasks, setRemoteDeepSeekTasks] = useState<DeepSeekTask[]>([])
  const settingsBodyRef = useRef<HTMLDivElement | null>(null)
  const mounted = useRef(false)

  useEffect(() => subscribeDeepSeekTasks(setRemoteDeepSeekTasks), [])

  const lastPreferenceChangeAt = useRef(0)
  const lastPreferenceSaveAt = useRef(0)
  const inFlightPreferenceSaveRef = useRef<{
    preferences: AssistantPreferences
    startedAt: number
  } | null>(null)
  const preferenceSaveSchedulerRef = useRef<PreferenceSaveScheduler<AssistantPreferences> | null>(
    null
  )
  const transcriptionQueueRef = useRef<VideoAudioTranscriptionQueueSnapshot>({
    items: [],
    sessionCompletedCount: 0
  })
  const transcriptionQueueRevisionRef = useRef(0)
  const workspaceRequestsEnabledRef = useRef(workspaceRequestsEnabled)
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const [activeView, setActiveView] = useState<AssistantWorkspaceView>(activeTab)
  const [ledgerWorkspaceOpened, setLedgerWorkspaceOpened] = useState(activeTab === 'ledger')
  const [requestedLedgerId, setRequestedLedgerId] = useState<string>()
  const [notesWorkspaceView, setNotesWorkspaceView] =
    useState<Extract<AssistantWorkspaceView, 'notes' | 'noteArchive'>>('notes')
  const [videoNotesResultTab, setVideoNotesResultTab] =
    useState<VideoNotesResultTab | null>(null)
  const [videoNoteArchiveSelection, setVideoNoteArchiveSelection] =
    useState<VideoNoteArchiveSelection>(() => loadSessionVideoNoteArchiveSelection())
  const isSidebarMode = mode === 'sidebar'

  useEffect(() => {
    if (activeView !== 'settings' || !window.bilimiDesktop?.getLocalDataInfo) return
    void window.bilimiDesktop.getLocalDataInfo()
      .then((info) => { setLocalDataInfo(info); setLocalDataUnavailable(false) })
      .catch(() => setLocalDataUnavailable(true))
  }, [activeView])

  const globalTranscriptionStatus = useMemo<GlobalStatusItem>(() => {
    const runningItem = transcriptionQueue.items.find((item) => item.status === 'running')
    if (runningItem) {
      const percent = formatGlobalProgressPercent(runningItem.progress)
      const pendingCount = transcriptionQueue.items.filter((item) => item.status === 'pending').length
      const progressLabel = percent === null ? '转写中' : `转写 ${percent}%`
      return {
        label: pendingCount > 0 ? `${progressLabel} · 排队 ${pendingCount}` : progressLabel,
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

    const failedItem = transcriptionQueue.items.findLast((item) => item.status === 'failed')
    if (failedItem) {
      const failureReason = failedItem.errorMessage?.trim() || '转写过程中遇到未知错误。'
      return {
        label: '转写失败',
        detail: `${failedItem.title}：${failureReason} 打开札记可重试。`,
        tone: 'error'
      }
    }

    if (transcriptionQueue.sessionCompletedCount > 0) {
      return {
        label: `暂无转写 · 成功 ${transcriptionQueue.sessionCompletedCount}`,
        detail: `本次启动已成功转写 ${transcriptionQueue.sessionCompletedCount} 个视频，文稿已保存到档案库。`,
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
    if (!preferences.deepseekEnabled) {
      return {
        label: 'DeepSeek 未启用',
        detail: formatDeepSeekFeatureList(preferences),
        tone: 'idle'
      }
    }

    if (!preferences.deepseekApiKeyStored) {
      return {
        label: 'DeepSeek 待配置',
        detail: formatDeepSeekFeatureList(preferences),
        tone: 'warn'
      }
    }

    const backgroundSummaryTasks: DeepSeekTask[] = transcriptionQueue.items
      .filter((item) => item.status === 'running' && item.progress?.step === 'summarizing-deepseek')
      .map((item) => ({
        id: `transcription-summary:${item.id}`,
        kind: 'summary',
        detail: `文稿总结：${item.title}`
      }))
    const activeDeepSeekTasks = [
      ...localDeepSeekTasks,
      ...remoteDeepSeekTasks,
      ...backgroundSummaryTasks
    ].filter(
      (task, index, tasks) => tasks.findIndex((candidate) => candidate.id === task.id) === index
    )
    if (activeDeepSeekTasks.length > 0) {
      const validatingConnection = activeDeepSeekTasks.every(
        (task) => task.kind === 'connection-test'
      )
      return {
        label: validatingConnection ? 'DeepSeek 验证中' : 'DeepSeek 工作中',
        detail: [
          validatingConnection ? 'DeepSeek 验证中' : 'DeepSeek 工作中',
          `当前模型：${preferences.deepseekModel || '未配置'}`,
          `正在执行 ${activeDeepSeekTasks.length} 项任务：`,
          ...activeDeepSeekTasks.map(
            (task) => `• ${task.detail?.trim() || DEEPSEEK_TASK_DEFAULT_DETAIL[task.kind]}`
          ),
          '',
          ...formatDeepSeekFeatureLines(preferences)
        ].join('\n'),
        tone: 'running'
      }
    }

    if (deepSeekConnectionStatus === 'failed') {
      return {
        label: 'DeepSeek 连接失败',
        detail: [
          '配置已保存，但最近一次真实连接测试失败，请检查密钥、模型和服务地址。',
          ...formatDeepSeekFeatureLines(preferences)
        ].join('\n'),
        tone: 'error'
      }
    }

    if (deepSeekConnectionStatus === 'pending') {
      return {
        label: 'DeepSeek 待测试',
        detail: [
          '配置已保存，尚未完成本次运行的连接验证。',
          `当前模型：${preferences.deepseekModel || '未配置'}`,
          ...formatDeepSeekFeatureLines(preferences)
        ].join('\n'),
        tone: 'warn'
      }
    }

    return {
      label: 'DeepSeek 已连接',
      detail: formatDeepSeekFeatureList(preferences),
      tone: 'ok'
    }
  }, [
    preferences.deepseekApiKeyStored,
    preferences.deepseekAutoSummaryEnabled,
    preferences.deepseekCommentEnabled,
    preferences.deepseekDailyClassificationEnabled,
    preferences.deepseekArchiveOrganizationEnabled,
    preferences.deepseekDailyClassificationMode,
    preferences.deepseekEnabled,
    preferences.deepseekModel,
    preferences.deepseekPetChatEnabled,
    deepSeekConnectionStatus,
    localDeepSeekTasks,
    remoteDeepSeekTasks,
    transcriptionQueue
  ])

  const globalLedgerStatus = useMemo<GlobalStatusItem>(() => {
    const accountMid = snapshot?.accountMid ?? ''
    return resolveFavoriteOrganizationLamp({
      snapshot: favoriteOrganizationSnapshot,
      defaultFavoriteSystemEnabled:
        preferences.favoriteAccountPreferences?.[accountMid]?.defaultFavoriteSystemEnabled ?? true,
      ledgers: preferences.favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? preferences.favoriteLedgers,
      favoriteLedgerStatus
    })
  }, [
    favoriteLedgerStatus,
    favoriteOrganizationSnapshot,
    snapshot?.accountMid,
    preferences.favoriteAccountPreferences,
    preferences.favoriteLedgers
  ])

  function tellPet(tone: PetFeedbackTone, message: string) {
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: PET_FEEDBACK_TONES[tone],
      message: createPetHintMessage(message)
    })
  }

  function startDeepSeekTask(task: DeepSeekTask) {
    setLocalDeepSeekTasks((tasks) => [...tasks.filter((current) => current.id !== task.id), task])
    const finishBroadcast = publishDeepSeekTask(task)
    return () => {
      setLocalDeepSeekTasks((tasks) => tasks.filter((current) => current.id !== task.id))
      finishBroadcast()
    }
  }

  function setGlobalFeedback(message: string) {
    const trimmed = message.trim()
    if (trimmed) {
      setGlobalFeedbackMessage(trimmed)
    }
  }

  function publishDeepSeekConnectionStatus(status: DeepSeekConnectionStatus) {
    setDeepSeekConnectionStatus(status)
  }

  function setActiveTab(tab: AssistantWorkspaceTab, options?: { view?: AssistantWorkspaceView }) {
    setFeedback(null)
    const nextView = options?.view ?? (tab === 'notes' ? notesWorkspaceView : tab)
    if (nextView === 'ledger') setLedgerWorkspaceOpened(true)
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

  const loadSnapshot = useCallback(({ resetVideoNote = false } = {}) => {
    const loadGeneration = snapshotLoadGeneration.current + 1
    snapshotLoadGeneration.current = loadGeneration
    const nextLoad = (async () => {
      try {
      const nextSnapshot =
        (await window.bilimiDesktop?.requestAssistantSnapshot?.()) ?? createFallbackSnapshot()

      if (!mounted.current || loadGeneration !== snapshotLoadGeneration.current) {
        return
      }

      if (didActiveVideoChange(snapshotRef.current, nextSnapshot)) {
        setCommentChooserOpen(false)
        setAiCommentDrafts([])
      }

      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      if (!runtimeFeedbackSnapshotLoaded.current) {
        runtimeFeedbackSnapshotLoaded.current = true
        lastRuntimeFeedbackId.current = nextSnapshot.runtimeFeedbackId
      } else if (
        nextSnapshot.runtimeFeedback &&
        nextSnapshot.runtimeFeedbackId !== undefined &&
        nextSnapshot.runtimeFeedbackId !== lastRuntimeFeedbackId.current
      ) {
        lastRuntimeFeedbackId.current = nextSnapshot.runtimeFeedbackId
        setGlobalFeedback(nextSnapshot.runtimeFeedback)
      }
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
        if (!snapshotArrivedSoonAfterLocalChange) {
          committedPreferencesRef.current = snapshotPreferences
        }
        preferencesRef.current = nextPreferences
        return nextPreferences
      })
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)

      if (resetVideoNote) {
        setVideoNote(null)
      }
      } catch (error) {
        if (!mounted.current || loadGeneration !== snapshotLoadGeneration.current) {
          return
        }

        const fallback = createFallbackSnapshot()
        snapshotRef.current = fallback
        setSnapshot(fallback)
        committedPreferencesRef.current = fallback.preferences
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
    })()
    return nextLoad
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadDeepSeekKeyFieldStatus() {
      if (!window.bilimiDesktop?.loadDeepSeekApiKeyStatus) {
        setDeepSeekKeyFieldStatus(preferences.deepseekApiKeyStored ? 'savedSecure' : 'unsaved')
        return
      }

      try {
        const keyStatus = await window.bilimiDesktop.loadDeepSeekApiKeyStatus()

        if (!cancelled && mounted.current) {
          setDeepSeekKeyFieldStatus(deepSeekKeyFieldStatusFromKeyStatus(keyStatus))
        }
      } catch {
        if (!cancelled && mounted.current) {
          setDeepSeekKeyFieldStatus('unreadable')
        }
      }
    }

    void loadDeepSeekKeyFieldStatus()

    return () => {
      cancelled = true
    }
  }, [preferences.deepseekApiKeyStored])

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
    if (
      mode !== 'sidebar' ||
      !snapshot ||
      startupDeepSeekValidationAttempted.current ||
      deepSeekConnectionValidationInFlight.current ||
      !preferences.deepseekEnabled ||
      !preferences.deepseekApiKeyStored ||
      !window.bilimiDesktop?.testDeepSeekConnection
    ) {
      return
    }

    startupDeepSeekValidationAttempted.current = true
    deepSeekConnectionValidationInFlight.current = true
    const finishDeepSeekTask = startDeepSeekTask({
      id: 'startup-connection-test',
      kind: 'connection-test',
      detail: '连接验证：启动时自动检查'
    })

    const saveBeforeValidation = deepSeekConnectionValidationSaveRequired.current
    deepSeekConnectionValidationSaveRequired.current = false

    void (saveBeforeValidation
      ? persistPreferences(preferencesRef.current)
      : Promise.resolve())
      .then(() => window.bilimiDesktop!.testDeepSeekConnection!())
      .then((result) => {
        publishDeepSeekConnectionStatus(result.ok ? 'connected' : 'failed')
      })
      .catch(() => {
        publishDeepSeekConnectionStatus('failed')
      })
      .finally(() => {
        deepSeekConnectionValidationInFlight.current = false
        finishDeepSeekTask()
      })
  }, [mode, preferences.deepseekApiKeyStored, preferences.deepseekEnabled, snapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantSnapshotChanged?.(() => {
      if (snapshotChangeLoadScheduled.current) return
      snapshotChangeLoadScheduled.current = true
      queueMicrotask(() => {
        snapshotChangeLoadScheduled.current = false
        if (mounted.current) {
          void loadSnapshot({ resetVideoNote: true })
          void loadVideoNoteArchives({ silent: true })
        }
      })
    })
  }, [loadSnapshot, loadVideoNoteArchives])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencesChanged?.((nextPreferences) => {
      const normalizedNextPreferences = createInitialAssistantPreferences(nextPreferences)

      setPreferences((currentPreferences) => {
        const inFlightPreferenceSave = inFlightPreferenceSaveRef.current
        const saveScheduler = preferenceSaveSchedulerRef.current
        const hasActiveLocalPreferenceSave =
          Boolean(inFlightPreferenceSave) || Boolean(saveScheduler?.hasActiveSave())
        const isStaleInFlightSidebarWidth =
          Boolean(inFlightPreferenceSave) &&
          inFlightPreferenceSave?.preferences.assistantSidebarWidthPx ===
            normalizedNextPreferences.assistantSidebarWidthPx &&
          currentPreferences.assistantSidebarWidthPx !==
            normalizedNextPreferences.assistantSidebarWidthPx &&
          lastPreferenceChangeAt.current > inFlightPreferenceSave.startedAt

        if (isStaleInFlightSidebarWidth) {
          preferencesRef.current = currentPreferences
          return currentPreferences
        }

        const comparisonPreferences = committedPreferencesRef.current
        committedPreferencesRef.current = normalizedNextPreferences

        if (!hasActiveLocalPreferenceSave) {
          lastPreferenceChangeAt.current = Date.now()
          preferencesRef.current = normalizedNextPreferences
          return normalizedNextPreferences
        }

        const mergedEntries = (
          Object.keys(normalizedNextPreferences) as Array<keyof AssistantPreferences>
        ).map((key) => [
          key,
          arePreferenceValuesEqual(currentPreferences[key], comparisonPreferences[key])
            ? normalizedNextPreferences[key]
            : currentPreferences[key]
        ])
        const mergedPreferences = createInitialAssistantPreferences(
          Object.fromEntries(mergedEntries) as Partial<AssistantPreferences>
        )
        lastPreferenceChangeAt.current = Date.now()
        preferencesRef.current = mergedPreferences

        const hasUnsavedMergedChanges = !arePreferenceValuesEqual(
          mergedPreferences,
          normalizedNextPreferences
        )

        if (hasUnsavedMergedChanges) {
          if (
            !saveScheduler?.updatePending(() => mergedPreferences) &&
            saveScheduler?.hasActiveSave()
          ) {
            saveScheduler.schedule(mergedPreferences)
          }
        }
        return mergedPreferences
      })
    })
  }, [])

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

  function applyTranscriptionQueueSnapshot(snapshot: VideoAudioTranscriptionQueueSnapshot) {
    transcriptionQueueRevisionRef.current += 1
    transcriptionQueueRef.current = snapshot
    setTranscriptionQueue(snapshot)
  }

  useEffect(() => {
    return window.bilimiDesktop?.onVideoAudioTranscriptionQueueChanged?.((snapshot) => {
      const hadRunning = transcriptionQueueRef.current.items.some((item) => item.status === 'running')
      const hasRunning = snapshot.items.some((item) => item.status === 'running')

      applyTranscriptionQueueSnapshot(snapshot)
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
  const activeFavoriteLedgers = preferences.favoriteAccountPreferences?.[resolvedSnapshot.accountMid ?? '']?.favoriteLedgers ??
    preferences.favoriteLedgers
  const hasMissingFavoriteLedgers = hasMissingFavoriteLedgerBindings(activeFavoriteLedgers, favoriteLedgerStatus)
  const readinessFeedbackMessage = useMemo(() => {
    return favoriteWorkspaceReadinessMessage({
      hasBilibiliPageOpen,
      hasMissingFavoriteLedgers,
      activeTab
    })
  }, [activeTab, hasBilibiliPageOpen, hasMissingFavoriteLedgers])
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
          if (!window.bilimiDesktop?.patchPreferences && !window.bilimiDesktop?.savePreferences) {
            return nextPreferences
          }

          const saveStartedAt = Date.now()
          inFlightPreferenceSaveRef.current = {
            preferences: nextPreferences,
            startedAt: saveStartedAt
          }

          try {
            const basePreferences = committedPreferencesRef.current
            const patch = Object.fromEntries(
              Object.entries(nextPreferences).filter(
                ([key, value]) => value !== basePreferences[key as keyof AssistantPreferences]
              )
            ) as Partial<AssistantPreferences>
            const saved = window.bilimiDesktop.patchPreferences
              ? await window.bilimiDesktop.patchPreferences(patch)
              : await window.bilimiDesktop.savePreferences(nextPreferences)
            const savedPreferences = createInitialAssistantPreferences(saved)
            const newerLocalChangeExists = lastPreferenceChangeAt.current > saveStartedAt

            if (!newerLocalChangeExists) {
              committedPreferencesRef.current = savedPreferences
              preferencesRef.current = savedPreferences

              if (mounted.current) {
                setPreferences(savedPreferences)
              }
            }

            lastPreferenceSaveAt.current = Date.now()
            return savedPreferences
          } finally {
            if (inFlightPreferenceSaveRef.current?.startedAt === saveStartedAt) {
              inFlightPreferenceSaveRef.current = null
            }
          }
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

  function restoreKeywordSuggestionToPending(suggestion: FavoriteKeywordSuggestion) {
    updateKeywordSuggestionStatus(suggestion.id, 'pending')
    setSettingsLearningMessage('已撤回到待处理，收藏夹关键词不自动回滚。')
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

  function chooseCloseBehavior(closeBehavior: AssistantPreferences['closeBehavior']) {
    tellPet(
      'success',
      closeBehavior === 'minimize-to-tray'
        ? '点关闭时会先收进托盘，小咪还在。'
        : '点关闭时会退出启动器；小咪会先确认一下。'
    )
    persistPreferencePatch({ closeBehavior })
  }

  function toggleRememberCloseChoice(rememberCloseChoice: boolean) {
    tellPet(
      'success',
      rememberCloseChoice ? '已记住关闭选择。' : '以后每次关闭都会询问。'
    )
    persistPreferencePatch({ rememberCloseChoice })
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

    if (
      'deepseekEnabled' in patch ||
      'deepseekModel' in patch ||
      'deepseekBaseUrl' in patch
    ) {
      publishDeepSeekConnectionStatus('pending')
    }

    if (options.persist) {
      getPreferenceSaveScheduler().schedule(nextPreferences)
    }
  }

  function toggleDeepSeekEnabled(enabled: boolean) {
    const previousScrollTop = enabled ? settingsBodyRef.current?.scrollTop : undefined

    if (!enabled) {
      startupDeepSeekValidationAttempted.current = false
    } else {
      deepSeekConnectionValidationSaveRequired.current = true
    }

    updateDeepSeekPreference(
      enabled && !preferencesRef.current.deepseekFeatureDefaultsInitialized
        ? {
            deepseekEnabled: true,
            deepseekCommentEnabled: true,
            deepseekAutoSummaryEnabled: true,
            deepseekPetChatEnabled: true,
            deepseekDailyClassificationEnabled: true,
            deepseekArchiveOrganizationEnabled: true,
            deepseekDailyClassificationMode: 'all',
            deepseekFeatureDefaultsInitialized: true
          }
        : { deepseekEnabled: enabled },
      { persist: true }
    )

    if (previousScrollTop !== undefined) {
      window.requestAnimationFrame(() => {
        if (settingsBodyRef.current) {
          settingsBodyRef.current.scrollTop = previousScrollTop
        }
      })
    }
  }

  function jumpToSettingsSection(section: SettingsJumpValue) {
    setSettingsJumpValue(section)
    const selector = `[data-settings-section="${section}"]`
    const target = settingsBodyRef.current?.querySelector(selector) ?? document.querySelector(selector)
    if (target && 'scrollIntoView' in target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  function openSettingsSection(section: SettingsJumpValue) {
    setActiveTab('settings')
    setSettingsJumpValue(section)
    window.setTimeout(() => jumpToSettingsSection(section), 0)
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
      if (
        section &&
        section.getBoundingClientRect().top - bodyTop <= SETTINGS_SCROLL_SYNC_OFFSET
      ) {
        nextValue = option.value
      }
    }

    if (nextValue !== settingsJumpValue) {
      setSettingsJumpValue(nextValue)
    }
  }

  async function saveDeepSeekSettings(options: { announceSuccess?: boolean } = {}): Promise<boolean> {
    const keyDraft = deepSeekApiKeyDraft.trim()
    const settingsSnapshot = preferencesRef.current
    let nextPreferences = settingsSnapshot
    let keyWasSaved = false

    tellPet('progress', '小咪正在保存 DeepSeek 设置。')

    if (keyDraft) {
      if (!window.bilimiDesktop?.saveDeepSeekApiKey) {
        setGlobalFeedback('DeepSeek 密钥保存失败，请重试。')
        tellPet('error', 'DeepSeek 密钥保存失败，请重试。')
        return false
      }

      let keyStatus: unknown
      try {
        keyStatus = await window.bilimiDesktop.saveDeepSeekApiKey(keyDraft)
      } catch {
        setGlobalFeedback('DeepSeek 密钥保存失败，请重试。')
        tellPet('error', 'DeepSeek 密钥保存失败，请重试。')
        return false
      }

      if (keyStatus) {
        keyWasSaved = true
        setDeepSeekKeyFieldStatus(deepSeekKeyFieldStatusFromKeyStatus(keyStatus))
        nextPreferences = createInitialAssistantPreferences({
          ...settingsSnapshot,
          deepseekApiKeyStored: deepSeekKeyStatusConfigured(keyStatus)
        })
      }
    }

    try {
      await persistPreferences(nextPreferences)
    } catch {
      if (keyWasSaved) {
        setGlobalFeedback('DeepSeek 密钥已保存，但其他设置保存失败，请重试。')
        tellPet('error', 'DeepSeek 密钥已保存，但其他设置保存失败，请重试。')
      } else {
        setGlobalFeedback('DeepSeek 设置保存失败，请重试。')
        tellPet('error', 'DeepSeek 设置保存失败，请重试。')
      }
      return false
    }

    if (keyWasSaved) {
      setDeepSeekApiKeyDraft('')
    }

    if (options.announceSuccess !== false) {
      setGlobalFeedback('DeepSeek 设置已保存。')
      tellPet('success', 'DeepSeek 设置保存好啦。')
    }
    return true
  }

  async function saveAndTestDeepSeekConnection() {
    if (!window.bilimiDesktop?.testDeepSeekConnection) {
      setGlobalFeedback('DeepSeek 测试功能未加载，请重启应用后再试。')
      tellPet('error', 'DeepSeek 测试功能还没加载好。')
      return
    }

    tellPet('progress', '小咪正在测试 DeepSeek 连接。')
    const finishDeepSeekTask = startDeepSeekTask({
      id: `connection-test:${Date.now()}:${Math.random()}`,
      kind: 'connection-test',
      detail: '连接测试：当前配置'
    })
    try {
      const saved = await saveDeepSeekSettings({ announceSuccess: false })
      if (!saved) {
        return
      }
      const result = await window.bilimiDesktop.testDeepSeekConnection()
      const statusMessage = localizeDeepSeekStatusMessage(result.message)
      const modelStatus = result.ok
        ? `请求模型：${result.requestedModel ?? preferencesRef.current.deepseekModel}；服务端返回模型：${result.responseModel ?? '未披露'}。`
        : ''
      publishDeepSeekConnectionStatus(result.ok ? 'connected' : 'failed')
      setGlobalFeedback(
        result.ok
          ? `${statusMessage}${modelStatus}`
          : `配置已保存，但连接测试失败：${statusMessage}`
      )
      tellPet(result.ok ? 'success' : 'error', statusMessage)
    } catch {
      const statusMessage = '配置已保存，但连接测试失败：DeepSeek 连接失败。'
      publishDeepSeekConnectionStatus('failed')
      setGlobalFeedback(statusMessage)
      tellPet('error', statusMessage)
    } finally {
      finishDeepSeekTask()
    }
  }

  async function resetDeepSeekSettings() {
    if (!window.confirm('重置会关闭 DeepSeek 并删除已保存的 API 密钥，确定继续吗？')) {
      return
    }

    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: true,
      deepseekFeatureDefaultsInitialized: true,
      deepseekDailyClassificationMode: 'all',
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL
    })

    try {
      await window.bilimiDesktop?.clearDeepSeekApiKey?.()
      await persistPreferences(nextPreferences)
      setDeepSeekApiKeyDraft('')
      setDeepSeekKeyFieldStatus('unsaved')
      publishDeepSeekConnectionStatus('pending')
      setGlobalFeedback('DeepSeek 设置已重置。')
      tellPet('success', 'DeepSeek 设置已经重置，小咪回到本地提示模式啦。')
    } catch {
      setGlobalFeedback('DeepSeek 设置重置失败，请重试。')
      tellPet('error', 'DeepSeek 设置重置失败，请重试。')
    }
  }

  async function resetAssistantSettings() {
    if (!window.confirm([
      '确认重置全部设置？',
      '',
      '将恢复默认设置并清除已保存的 DeepSeek API 密钥。',
      '视频札记、档案、收藏夹册目和已整理记录不会删除。'
    ].join('\n'))) {
      return
    }

    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      petStyle: 'big-head',
      petHoverShortcuts: undefined,
      hidePetDuringVideoFullscreen: false,
      closeBehavior: 'minimize-to-tray',
      rememberCloseChoice: false,
      favoriteArchiveMultiMode: 'off',
      defaultCoinCount: 2,
      commentSubmitMode: 'choose',
      videoAudioTranscriptionThreadLimit: 'unlimited',
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: true,
      deepseekFeatureDefaultsInitialized: true,
      deepseekDailyClassificationMode: 'all',
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      assistantSidebarWidthPx: null
    })

    setDeepSeekApiKeyDraft('')
    setDeepSeekKeyFieldStatus('unsaved')
    await window.bilimiDesktop?.clearDeepSeekApiKey?.()
    await persistPreferences(nextPreferences)
    publishDeepSeekConnectionStatus('pending')
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
    let copied = false

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        copied = true
      } catch {
        // Electron's Web Clipboard API can reject when the window is not focused.
      }
    }

    if (!copied && window.bilimiDesktop?.writeClipboardText) {
      try {
        await window.bilimiDesktop.writeClipboardText(value)
        copied = true
      } catch {
        copied = false
      }
    }

    if (copied) {
      setGlobalFeedback(`已复制${label}。`)
      tellPet('success', `${label}已复制好啦。`)
      return
    }

    setGlobalFeedback(`${label}复制失败，请手动复制。`)
    tellPet('error', `${label}复制失败，请主人手动复制。`)
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
      const deepSeekDiagnostic = report.items.find((item) => item.id === 'deepseek')

      if (deepSeekDiagnostic?.status === 'ok') {
        publishDeepSeekConnectionStatus('connected')
      } else if (deepSeekDiagnostic) {
        publishDeepSeekConnectionStatus(
          preferencesRef.current.deepseekApiKeyStored ? 'failed' : 'pending'
        )
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
    const finishDeepSeekTask = startDeepSeekTask({
      id: `comment:${Date.now()}:${Math.random()}`,
      kind: 'comment',
      detail: `趣评生成：${resolvedVideoTitle}`
    })

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

      publishDeepSeekConnectionStatus('connected')
      setAiCommentDrafts(result.comments)
      setCommentIntentOpen(false)
      submitOrChooseCommentDrafts(result.comments)
    } catch (error) {
      setAiCommentDrafts([])
      setCommentIntentOpen(false)
      submitOrChooseCommentDrafts(commentDrafts)
    } finally {
      finishDeepSeekTask()
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
        result.ok
          ? createActionSuccessHint(action, result.message)
          : createActionErrorHint(action, result)
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

      // Clear stale editor targeting when the next workspace request has no ledger target.
      setRequestedLedgerId(payload.ledgerId)

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
    const startedAtRevision = transcriptionQueueRevisionRef.current
    const snapshot = (await window.bilimiDesktop?.loadVideoAudioTranscriptionQueue?.()) ?? {
      items: [],
      sessionCompletedCount: 0
    }
    if (startedAtRevision !== transcriptionQueueRevisionRef.current) {
      return transcriptionQueueRef.current
    }

    applyTranscriptionQueueSnapshot(snapshot)
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
      applyTranscriptionQueueSnapshot(nextQueue)
      clearCurrentVideoMissingFeedback()
    }
    return nextQueue
  }

  async function cancelQueuedVideoAudioTranscription(id: string) {
    const previousItem = transcriptionQueueRef.current.items.find((item) => item.id === id)
    const snapshot = await window.bilimiDesktop?.cancelVideoAudioTranscription?.(id)
    if (snapshot) {
      applyTranscriptionQueueSnapshot(snapshot)
      const canceledItem = snapshot.items.find((item) => item.id === id && item.status === 'canceled')
      if (
        canceledItem &&
        (previousItem?.status === 'pending' || previousItem?.status === 'running')
      ) {
        setGlobalFeedback('已取消转写')
        tellPet('done', `已取消「${canceledItem.title}」的转写。`)
      }
    }
  }

  async function retryQueuedVideoAudioTranscription(id: string) {
    const snapshot = await window.bilimiDesktop?.retryVideoAudioTranscription?.(id)
    if (snapshot) {
      applyTranscriptionQueueSnapshot(snapshot)
    }
  }

  async function generateNotePoster(note: VideoNote) {
    tellPet('progress', '小咪正在整理 DeepSeek 总结。')
    const finishDeepSeekTask = startDeepSeekTask({
      id: `summary:${note.id}:${Date.now()}:${Math.random()}`,
      kind: 'summary',
      detail: `文稿总结：${note.source.title}`
    })
    try {
      const result = await window.bilimiDesktop?.generateDeepSeek?.({ kind: 'note-poster', note })
      if (!result || result.kind !== 'note-poster') {
        tellPet('error', 'DeepSeek 总结没有生成成功。')
        throw new Error('Poster generation failed.')
      }

      publishDeepSeekConnectionStatus('connected')
      tellPet('success', 'DeepSeek 总结做好啦。')
      return result.poster
    } finally {
      finishDeepSeekTask()
    }
  }

  async function archiveNotePosterSummary(note: VideoNote, poster: NotePosterSummary) {
    const archives = await window.bilimiDesktop?.saveVideoNoteArchiveVersion?.(
      note,
      createNotePosterText(poster)
    )

    if (archives) {
      setVideoNoteArchives(archives)
    }

    return archives
  }

  async function loadVideoNoteArchives({ silent = false } = {}) {
    if (!silent) {
      tellPet('progress', '小咪正在打开档案库。')
    }

    const archives = (await window.bilimiDesktop?.loadVideoNoteArchives?.()) ?? []
    setVideoNoteArchives(archives)

    if (!silent) {
      tellPet('success', '档案库打开啦，想看的文稿都在这里。')
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
      setVideoNotesResultTab('plain')
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

  function handleVideoNoteArchiveSelectionChange(selection: VideoNoteArchiveSelection) {
    setVideoNoteArchiveSelection(selection)
    saveSessionVideoNoteArchiveSelection(selection)
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
      const accountMid = resolvedSnapshot.accountMid
      await persistPreferences({
        ...(accountMid
          ? withFavoriteLedgersForAccount(preferencesRef.current, accountMid, favoriteLedgers)
          : { ...preferencesRef.current, favoriteLedgers })
      })
    }

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
  }

  async function syncFavoriteLedgers(
    favoriteLedgers: AssistantPreferences['favoriteLedgers'],
    options?: FavoriteLedgerSaveOptions
  ) {
    return saveFavoriteLedgers(favoriteLedgers.map((ledger) =>
      ledger.syncState === 'local-draft' ? { ...ledger, syncState: undefined } : ledger
    ), options)
  }

  async function chooseBilibiliConnectionMode(mode: AssistantPreferences['bilibiliConnectionMode']) {
    const previous = preferencesRef.current
    const next = createInitialAssistantPreferences({ ...previous, bilibiliConnectionMode: mode })
    applyPreferenceSnapshot(next)
    try {
      if (!window.bilimiDesktop?.patchPreferences) {
        throw new Error('当前版本无法应用 B 站连接方式')
      }
      const saved = await window.bilimiDesktop.patchPreferences({ bilibiliConnectionMode: mode })
      applyPreferenceSnapshot(createInitialAssistantPreferences(saved))
      setSettingsLearningMessage('B 站连接方式已应用，所有 B 站标签已重新加载。')
    } catch (error) {
      applyPreferenceSnapshot(previous)
      setSettingsLearningMessage(`B 站连接方式未生效：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function saveFavoriteLedgerRules(
    favoriteLedgers: AssistantPreferences['favoriteLedgers']
  ) {
    const accountMid = resolvedSnapshot.accountMid
    await persistPreferences(accountMid
      ? withFavoriteLedgersForAccount(preferencesRef.current, accountMid, favoriteLedgers)
      : { ...preferencesRef.current, favoriteLedgers })
    if (accountMid) {
      await window.bilimiDesktop?.commandOldFavoriteWorkspaceV1?.(accountMid, {
        type: 'reclassify-favorite-configuration'
      })
    }
    return createDefaultResult('收藏夹规则已保存。')
  }

  async function setDefaultFavoriteSystemEnabled(enabled: boolean) {
    const accountMid = resolvedSnapshot.accountMid
    if (!accountMid) return
    const current = preferencesRef.current.favoriteAccountPreferences?.[accountMid]
    await persistPreferencePatch({
      favoriteAccountPreferences: {
        ...(preferencesRef.current.favoriteAccountPreferences ?? {}),
        [accountMid]: {
          defaultFavoriteSystemEnabled: enabled,
          favoriteLedgers: current?.favoriteLedgers ?? preferencesRef.current.favoriteLedgers
        }
      }
    })
    await window.bilimiDesktop?.commandOldFavoriteWorkspaceV1?.(accountMid, { type: 'reclassify-favorite-configuration' })
  }

  const refreshOrganizationState = useCallback(async () => {
    const accountMid = resolvedSnapshot.accountMid
    if (accountMid && window.bilimiDesktop?.openOldFavoriteWorkspaceV1) {
      const workspace = await window.bilimiDesktop.openOldFavoriteWorkspaceV1(accountMid)
      if (workspace && !('recovery' in workspace)) setFavoriteOrganizationSnapshot(workspace)
    }
    await loadSnapshot()
  }, [loadSnapshot, resolvedSnapshot.accountMid])

  async function openFavoritePage() {
    tellPet('progress', '小咪正在打开 B 站收藏夹。')
    const result =
      (await window.bilimiDesktop?.openBilibiliFavorites?.()) ??
      createDefaultResult('已打开 B 站收藏夹。')

    tellPet(result.ok ? 'success' : 'error', result.message)
    return result
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

  function jumpToStatusArea(tab: AssistantWorkspaceTab) {
    if (tab === 'settings') {
      openSettingsSection('deepseek')
      return
    }

    setActiveTab(tab)
  }

  const deepSeekKeywordSuggestions = preferences.favoriteKeywordSuggestions.filter(
    (suggestion) => suggestion.source === 'deepseek'
  )
  const pendingKeywordSuggestions = deepSeekKeywordSuggestions.filter(
    (suggestion) => suggestion.status === 'pending'
  )
  const processedKeywordSuggestions = deepSeekKeywordSuggestions.filter(
    (suggestion) => suggestion.status !== 'pending'
  )
  const visibleKeywordSuggestions =
    settingsKeywordSuggestionView === 'pending'
      ? pendingKeywordSuggestions
      : processedKeywordSuggestions

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
              title={displayedGlobalFeedbackMessage}
            >
              {displayedGlobalFeedbackMessage}
            </p>
            <div className="floating-assistant-global-status__lights" aria-label="后台状态灯">
              {[
                { ...globalDeepSeekStatus, ariaLabel: 'DeepSeek状态', targetTab: 'settings' },
                { ...globalTranscriptionStatus, ariaLabel: '转写音频状态', targetTab: 'notes' },
                { ...globalLedgerStatus, ariaLabel: '整理状态', targetTab: 'ledger' }
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="floating-assistant-global-status__light"
                  data-tone={item.tone}
                  aria-label={item.ariaLabel}
                  title={item.detail}
                  onClick={() => jumpToStatusArea(item.targetTab as AssistantWorkspaceTab)}
                >
                  <span className="floating-assistant-global-status__dot" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {ledgerWorkspaceOpened ? (
          <div className="floating-assistant-view" hidden={activeView !== 'ledger'}>
            <ControlledFavoriteLedgerPanel
            currentAccountMid={resolvedSnapshot.accountMid}
            ledgers={preferences.favoriteAccountPreferences?.[resolvedSnapshot.accountMid ?? '']?.favoriteLedgers ?? preferences.favoriteLedgers}
            missingLedgerIds={favoriteLedgerStatus?.missingLedgerIds ?? []}
            defaultFavoriteSystemEnabled={preferences.favoriteAccountPreferences?.[resolvedSnapshot.accountMid ?? '']?.defaultFavoriteSystemEnabled ?? true}
            onEnsureLedgers={ensureFavoriteLedgers}
            onSaveLedgers={saveFavoriteLedgerRules}
            onSyncLedgers={syncFavoriteLedgers}
            onOpenFavoritePage={openFavoritePage}
            onRefreshOrganizationState={refreshOrganizationState}
            onOrganizationSnapshotChange={setFavoriteOrganizationSnapshot}
            deepSeekArchiveAvailable={
              preferences.deepseekEnabled &&
              preferences.deepseekApiKeyStored &&
              preferences.deepseekArchiveOrganizationEnabled
            }
            openLedgerId={requestedLedgerId}
            />
          </div>
        ) : null}

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
                    <label title="允许在归档预览中手动使用 DeepSeek 整理旧藏。">
                      <input
                        type="checkbox"
                        checked={preferences.deepseekArchiveOrganizationEnabled}
                        onChange={(event) =>
                          updateDeepSeekPreference(
                            {
                              deepseekArchiveOrganizationEnabled: event.currentTarget.checked
                            },
                            { persist: true }
                          )
                        }
                      />
                      <span>旧藏整理</span>
                    </label>
                  </div>
                  <div className="assistant-settings__deepseek-review-control">
                    <label title="让 DeepSeek 复核日常批阅的分类结果。">
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
                      <span>批阅辅助</span>
                    </label>
                    <select
                      aria-label="批阅辅助范围"
                      disabled={!preferences.deepseekDailyClassificationEnabled}
                      value={preferences.deepseekDailyClassificationMode}
                      onChange={(event) =>
                        updateDeepSeekPreference(
                          {
                            deepseekDailyClassificationMode: event.currentTarget.value as
                              | 'all'
                              | 'low-confidence-only'
                          },
                          { persist: true }
                        )
                      }
                    >
                      <option value="all">全部归类</option>
                      <option value="low-confidence-only">仅不太稳</option>
                    </select>
                  </div>
                  <label>
                    <span>DeepSeek API 密钥</span>
                    <input
                      type="password"
                      value={deepSeekApiKeyDraft}
                      placeholder={DEEPSEEK_KEY_STATUS_LABELS[deepSeekKeyFieldStatus]}
                      aria-invalid={deepSeekKeyFieldStatus === 'unreadable' ? 'true' : undefined}
                      onChange={(event) => {
                        setDeepSeekApiKeyDraft(event.currentTarget.value)
                        publishDeepSeekConnectionStatus('pending')
                      }}
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
                    <button
                      type="button"
                      disabled={[...localDeepSeekTasks, ...remoteDeepSeekTasks].some(
                        (task) => task.kind === 'connection-test'
                      )}
                      onClick={() => void saveAndTestDeepSeekConnection()}
                    >
                      {[...localDeepSeekTasks, ...remoteDeepSeekTasks].some(
                        (task) => task.kind === 'connection-test'
                      )
                        ? '保存测试中'
                        : '保存并测试'}
                    </button>
                    <button
                      type="button"
                      disabled={[...localDeepSeekTasks, ...remoteDeepSeekTasks].some(
                        (task) => task.kind === 'connection-test'
                      )}
                      onClick={() => void resetDeepSeekSettings()}
                    >
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
                    <p>API 密钥：创建令牌后，令牌分组请选择 deepseek（官方），复制密钥到这里使用。</p>
                    <p className="assistant-settings__recommendation-divider">推荐模型：</p>
                    <p className="assistant-settings__copy-row">
                      <span>（日常便宜）deepseek-v4-flash</span>
                      <button
                        className="assistant-settings__copy-button"
                        type="button"
                        aria-label="复制日常便宜模型"
                        onClick={() =>
                          void copyDeepSeekRecommendation('deepseek-v4-flash', '日常便宜模型')
                        }
                      >
                        复制
                      </button>
                    </p>
                    <p className="assistant-settings__copy-row">
                      <span>（精准略贵）deepseek-v4-pro</span>
                      <button
                        className="assistant-settings__copy-button"
                        type="button"
                        aria-label="复制精准略贵模型"
                        onClick={() =>
                          void copyDeepSeekRecommendation('deepseek-v4-pro', '精准略贵模型')
                        }
                      >
                        复制
                      </button>
                    </p>
                    <p className="assistant-settings__recommendation-divider">
                      <span>服务器地址：</span>
                      <span className="assistant-settings__copy-row assistant-settings__copy-row--inline">
                        <span>https://api.yunshulink.com/v1</span>
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
                      </span>
                    </p>
                  </aside>
                </>
              ) : null}
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
                <span>记录归档调整</span>
              </label>
              <small
                className="assistant-settings__option-help"
                title={FAVORITE_CORRECTION_LEARNING_HELP}
              >
                {FAVORITE_CORRECTION_LEARNING_HELP}
              </small>
              {settingsLearningMessage ? (
                <p className="assistant-settings__status" role="status">
                  {settingsLearningMessage}
                </p>
              ) : null}
              <div className="assistant-settings__subsection assistant-settings__subsection--records">
                <div className="assistant-settings__subsection-heading">
                  <strong>归档调整记录（{preferences.favoriteCorrectionRecords.length}）</strong>
                  <button
                    type="button"
                    onClick={clearCorrectionRecords}
                    disabled={preferences.favoriteCorrectionRecords.length === 0}
                  >
                    清空调整记录
                  </button>
                </div>
                {preferences.favoriteCorrectionRecords.length > 0 ? (
                  <div
                    className="assistant-settings__record-track assistant-settings__learning-list"
                    role="list"
                    aria-label="归档调整记录"
                  >
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
                        const summaryText = `调整前：${originalLedger}；调整后：${userLedgers}；时间：${formatSettingsDate(record.confirmedAt ?? record.createdAt)}`

                        return (
                          <article
                            key={record.id}
                            className="assistant-settings__record-card assistant-settings__learning-item"
                            role="listitem"
                          >
                            <div className="assistant-settings__learning-head">
                              <span className="assistant-settings__learning-summary">
                                <strong title={record.title}>{record.title}</strong>
                                <small title={summaryText}>{summaryText}</small>
                              </span>
                              <span className="assistant-settings__learning-actions">
                                <button
                                  type="button"
                                  aria-label={`删除调整 ${record.title}`}
                                  onClick={() => deleteCorrectionRecord(record.id)}
                                >
                                  删除
                                </button>
                              </span>
                            </div>
                            <div className="assistant-settings__learning-detail">
                              <span title={record.author?.trim() || '未记录'}>UP：{record.author?.trim() || '未记录'}</span>
                              <span title={joinSettingValues(record.tags)}>标签：{joinSettingValues(record.tags)}</span>
                              <span title={archiveAdjustmentMethodLabel(record)}>调整方式：{archiveAdjustmentMethodLabel(record)}</span>
                              <span title={archiveAdjustmentSceneLabel(record)}>发生位置：{archiveAdjustmentSceneLabel(record)}</span>
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
                  <p className="assistant-settings__empty">
                    暂无归档调整记录。卡片转移和已执行的 DeepSeek 调整会记录在这里，系统自动批量迁移不会登记。
                  </p>
                )}
              </div>
              <div className="assistant-settings__subsection">
                <div className="assistant-settings__subsection-heading">
                  <strong>DeepSeek 建议（{pendingKeywordSuggestions.length}）</strong>
                  <span className="assistant-settings__view-toggle" role="group" aria-label="DeepSeek 建议视图">
                    <button
                      type="button"
                      aria-pressed={settingsKeywordSuggestionView === 'pending'}
                      onClick={() => setSettingsKeywordSuggestionView('pending')}
                    >
                      待处理
                    </button>
                    <button
                      type="button"
                      aria-pressed={settingsKeywordSuggestionView === 'processed'}
                      onClick={() => setSettingsKeywordSuggestionView('processed')}
                    >
                      已处理
                    </button>
                  </span>
                </div>
                {visibleKeywordSuggestions.length > 0 ? (
                  <div
                    className="assistant-settings__record-track assistant-settings__keyword-list"
                    role="list"
                    aria-label={
                      settingsKeywordSuggestionView === 'pending'
                        ? '待处理 DeepSeek 建议'
                        : '已处理 DeepSeek 建议'
                    }
                  >
                    {visibleKeywordSuggestions.map((suggestion) => {
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
                        <article
                          key={suggestion.id}
                          className="assistant-settings__record-card assistant-settings__keyword-item"
                          role="listitem"
                        >
                          <div className="assistant-settings__keyword-summary">
                            <div className="assistant-settings__keyword-head">
                              <strong title={KEYWORD_SUGGESTION_ACTION_LABELS[suggestion.action]}>
                                {KEYWORD_SUGGESTION_ACTION_LABELS[suggestion.action]}
                              </strong>
                              {!isPending ? (
                                <button
                                  type="button"
                                  className="assistant-settings__keyword-restore"
                                  aria-label={`撤回建议 ${keywordLabel}`}
                                  onClick={() => restoreKeywordSuggestionToPending(suggestion)}
                                >
                                  撤回
                                </button>
                              ) : null}
                            </div>
                            <span title={KEYWORD_SUGGESTION_STATUS_LABELS[suggestion.status]}>
                              状态：{KEYWORD_SUGGESTION_STATUS_LABELS[suggestion.status]}
                            </span>
                            <span title={targetLabel}>目标收藏夹：{targetLabel}</span>
                            <span title={suggestion.keyword?.trim() || '未记录'}>
                              关键词：<span>{suggestion.keyword?.trim() || '未记录'}</span>
                            </span>
                            <span title={suggestion.replacement?.trim() || '未记录'}>
                              替换词：<span>{suggestion.replacement?.trim() || '未记录'}</span>
                            </span>
                            <small title={suggestion.reason}>理由：{suggestion.reason}</small>
                          </div>
                          {isPending ? (
                            <div className="assistant-settings__keyword-actions">
                              <button
                                type="button"
                                aria-label={`采纳建议 ${keywordLabel}`}
                                onClick={() => acceptKeywordSuggestion(suggestion)}
                              >
                                <span>采纳</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`忽略建议 ${keywordLabel}`}
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
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="assistant-settings__empty">
                    暂无 DeepSeek 建议
                  </p>
                )}
              </div>
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
                <label className="assistant-settings__hover-shortcut-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.showPetAssistantShortcut}
                    onChange={(event) =>
                      persistPreferencePatch({
                        showPetAssistantShortcut: event.currentTarget.checked
                      })
                    }
                  />
                  <span>显示打开小咪按钮</span>
                </label>
                {PET_SORTABLE_HOVER_SHORTCUTS.map((shortcut) => {
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
            <fieldset
              className="assistant-settings__group assistant-settings__group--favorites"
              data-settings-section="favorites"
            >
              <legend>默认收藏夹体系</legend>
              <label>
                <input
                  type="checkbox"
                  aria-label="启用默认收藏夹"
                  disabled={!defaultFavoriteSystemToggleAvailable(resolvedSnapshot.accountMid)}
                  title={defaultFavoriteSystemToggleAvailable(resolvedSnapshot.accountMid) ? undefined : '登录 B 站后可为当前账号设置默认收藏夹体系'}
                  checked={preferences.favoriteAccountPreferences?.[resolvedSnapshot.accountMid ?? '']?.defaultFavoriteSystemEnabled ?? true}
                  onChange={(event) => void setDefaultFavoriteSystemEnabled(event.currentTarget.checked)}
                />
                <span>启用默认收藏夹</span>
              </label>
              <p className="assistant-settings__favorites-help">默认开启；未备册也可先按默认逻辑目标等待标签完成后分类预览。</p>
              <p className="assistant-settings__favorites-help">谨慎关闭；建议先参考默认收藏夹 DIY 新建几个自己的收藏夹。关闭后普通默认收藏夹不参与分类、DeepSeek 或备册，暂存仍会保留为安全区。</p>
              <p className="assistant-settings__favorites-help">已同步的默认收藏夹只会在后续显式同步时进入删除确认。</p>
            </fieldset>
            <fieldset
              className="assistant-settings__group assistant-settings__group--bilibili-connection"
              data-settings-section="bilibili-connection"
            >
              <legend>B 站连接方式</legend>
              <p>只影响 bilimi 内的 B 站网页、API、图片和视频会话，不会修改 Windows 或 Clash 的代理设置，也不会影响 DeepSeek、转写下载或其他应用网络。</p>
              <p>自动模式跟随 Windows 当前系统代理；未启用系统代理时通常与直连没有区别。切换会重新加载 B 站标签，不会撤销已提交操作；正在进行的网络请求可能需要重试。</p>
              {([
                ['auto', '自动（推荐）', '默认跟随系统代理；不会自行测速或自动切换。'],
                ['direct', '始终直连', '只让 bilimi 的 B 站会话绕过系统代理。']
              ] as const).map(([mode, label, help]) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="bilibili-connection-mode"
                    checked={preferences.bilibiliConnectionMode === mode}
                    onChange={() => void chooseBilibiliConnectionMode(mode)}
                  />
                  <span>{label}</span>
                  <small>{help}</small>
                </label>
              ))}
              {settingsLearningMessage.startsWith('B 站连接方式') ? <p role="status">{settingsLearningMessage}</p> : null}
            </fieldset>
            {localDataInfo ? <fieldset
              className="assistant-settings__group assistant-settings__group--local-data"
              data-settings-section="local-data"
            >
              <LocalDataSettings
                userDataPath={localDataInfo.path}
                accounts={localDataInfo.accounts}
                currentAccountUid={resolvedSnapshot.accountMid}
                calculateUsage={async () => window.bilimiDesktop.calculateLocalDataUsage?.() ?? {
                  totalBytes: 0,
                  calculatedAt: new Date().toISOString(),
                  categories: { accountPersistent: { bytes: 0 }, deviceShared: { bytes: 0 }, cache: { bytes: 0 }, temporaryAudio: { bytes: 0 }, logs: { bytes: 0 } }
                }}
                onOpenPath={() => { void window.bilimiDesktop.openLocalDataPath?.() }}
                onExport={async (scope, includeSharedSettings, uids) => { await window.bilimiDesktop.exportLocalData?.({ scope, includeSharedSettings, ...(uids?.length ? { uids } : {}) }) }}
                onImport={async () => {
                  const preview = await window.bilimiDesktop.previewLocalDataImport?.()
                  return preview ? { token: preview.token, accounts: preview.accounts ?? [] } : undefined
                }}
                onApplyImport={async (previewToken, mode) => { await window.bilimiDesktop.applyLocalDataImport?.(previewToken, mode) }}
                onPreviewCleanup={async (level, uid) => window.bilimiDesktop.previewLocalDataCleanup?.(level, uid) ?? { affectsBilibiliServerData: false }}
                onApplyCleanup={async (level, uid) => { await window.bilimiDesktop.applyLocalDataCleanup?.(level, uid) }}
                onFullClear={async () => {
                  await window.bilimiDesktop.previewLocalDataCleanup?.('all-user-data', undefined, '全部清除')
                  await window.bilimiDesktop.applyLocalDataCleanup?.('all-user-data', undefined, '全部清除')
                }}
              />
            </fieldset> : <fieldset
              className="assistant-settings__group assistant-settings__group--local-data"
              data-settings-section="local-data"
            >
              <legend>本地数据与迁移</legend>
              <p role="status">{localDataUnavailable ? '本地数据服务暂不可用，请稍后重试。' : '正在读取本地数据服务…'}</p>
            </fieldset>}
            <fieldset
              className="assistant-settings__group assistant-settings__group--close"
              data-settings-section="close"
            >
              <legend>关闭设置</legend>
              <label>
                <input
                  type="radio"
                  name="main-window-close-behavior"
                  checked={preferences.closeBehavior === 'minimize-to-tray'}
                  onChange={() => chooseCloseBehavior('minimize-to-tray')}
                />
                <span>最小化到系统托盘</span>
                <small>点关闭时保留后台运行，托盘入口和小咪还在。</small>
              </label>
              <label>
                <input
                  type="radio"
                  name="main-window-close-behavior"
                  checked={preferences.closeBehavior === 'exit-launcher'}
                  onChange={() => chooseCloseBehavior('exit-launcher')}
                />
                <span>退出启动器</span>
                <small>点关闭时结束启动器和悬浮小咪。</small>
              </label>
              <div className="assistant-settings__pet-divider" aria-hidden="true" />
              <label title="关闭行为为退出启动器时生效；关闭后可在这里重新打开。">
                <input
                  type="checkbox"
                  checked={preferences.rememberCloseChoice}
                  onChange={(event) => toggleRememberCloseChoice(event.currentTarget.checked)}
                />
                <span>记住关闭选择</span>
                <small>勾选后直接执行上方选择；未勾选时每次询问。</small>
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
                selectedArchiveId={videoNoteArchiveSelection.archiveId}
                selectedVersionId={videoNoteArchiveSelection.versionId}
                activeResultTab={videoNoteArchiveSelection.activeResultTab}
                onSelectionChange={handleVideoNoteArchiveSelectionChange}
              />
            </div>
            <div className="floating-assistant-view" hidden={activeView === 'noteArchive'}>
              <MemorialPanel
                recommendation={recommendation}
                commentDrafts={commentDrafts}
                deepSeekEnabled={preferences.deepseekEnabled}
                deepSeekCommentEnabled={preferences.deepseekCommentEnabled}
                deepSeekAutoSummaryEnabled={preferences.deepseekAutoSummaryEnabled}
                deepSeekSummaryGenerating={
                  [...localDeepSeekTasks, ...remoteDeepSeekTasks].some(
                    (task) => task.kind === 'summary'
                  ) ||
                  transcriptionQueue.items.some(
                    (item) =>
                      item.status === 'running' &&
                      item.progress?.step === 'summarizing-deepseek'
                  )
                }
                videoCategory={videoCategory}
                videoTitle={resolvedVideoTitle}
                videoAuthor={resolvedVideoAuthor}
                hasCurrentVideo={hasCurrentVideo}
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
