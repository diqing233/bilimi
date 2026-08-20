import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteLedger,
  FavoriteLedgerClassificationDiagnostic,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  FavoriteKeywordSuggestion,
  FavoriteRepositoryCommand,
  PendingFavoriteQueueItem,
  VideoNote,
  VideoNoteExtractionResult,
  VideoAudioTranscriptionQueueSnapshot
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runVisualFavoriteFallback } from './features/actions/visualFavoriteFallback'
import { executeAssistantAction } from './features/actions/actionExecutor'
import { buildFavoriteApiAdjustmentScript } from './features/actions/favoriteApiAutomation'
import { BiliWebview } from './features/browser/BiliWebview'
import {
  buildVideoContentContextScript,
  classifyVideoContent,
  type VideoContentContext
} from './features/recommendation/videoClassifier'
import { planFavoriteArchiveTargets, type FavoriteArchiveTarget } from './features/recommendation/archivePlanning'
import {
  isFavoriteLedgerRemoteWritable,
  planFavoriteReviewWriteTargets
} from './features/recommendation/favoriteWriteTargetPlan'
import {
  applyImmediatePreferencePatch,
  createInitialAssistantPreferences,
  effectiveFavoriteLedgersForAccount,
  favoriteLedgersForAccount,
  withFavoriteLedgersForAccount
} from './features/state/assistantState'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult
} from './features/notes/videoNoteExtractor'
import {
  buildMultipartVideoSnapshotScript,
  normalizeMultipartVideoSnapshot,
  type MultipartVideoSnapshot
} from './features/notes/videoNoteMultipart'
import {
  buildReadCurrentVideoTimeScript,
  buildSeekVideoTimeScript
} from './features/notes/videoNoteTimeAutomation'
import {
  buildCreateFavoriteLedgerPhysicalShardScript,
  buildEnsureFavoriteLedgersScript,
  buildFavoriteLedgerStatusScript,
  buildFavoriteLedgerWriteCapacityScript,
  buildSaveFavoriteLedgersScript,
} from './features/favorites/favoriteLedgerApi'
import { createFavoriteRepositoryPageTarget } from './features/favorites/favoriteRepositoryPageTarget'
import {
  createOldFavoriteWorkspacePageBridge,
  type OldFavoriteWorkspacePageCommand
} from './features/favorites/oldFavoriteWorkspacePageBridge'
import { createLocalVideoNoteDraft } from './features/notes/videoNoteSummarizer'
import { parseManualTranscript } from './features/notes/transcriptNormalizer'
import { recordAssistantPreferenceFeedback } from './features/state/assistantState'
import {
  applyIndexedFavoriteLedgerEnabledPatch,
  createFavoriteLedgerEnabledIndex
} from './features/state/favoriteLedgerEnabledPatch'
import type {
  AssistantRuntimeRequest,
  AssistantSnapshot,
  OldFavoriteBatchCommitResult,
  FavoriteRepositoryPageTarget
} from './features/assistant/assistantRuntimeTypes'
import { AssistantSidebar } from './features/assistant/AssistantSidebar'
import { FavoriteLibraryDrawer, type FavoriteLibraryDrawerHandle } from './features/favorites/FavoriteLibraryDrawer'
import { PET_VIDEO_OPENING_LINES, pickPetLine } from './features/assistant/petInteractionLines'
import { publishDeepSeekTask } from './features/assistant/deepSeekTaskSignal'
import { composeMemorialComments } from './features/comments/commentComposer'
import { createCorrectionDraft } from './features/recommendation/correctionLearning'
import type { FavoriteRepositoryConfirmedReviewInput } from '@shared/favoriteRepository'

const HOME_TAB_ID = 'home'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/([^/?#]+)/i
export const VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS = 900
const IS_TEST_RUNTIME = import.meta.env.MODE === 'test'
const DAILY_DEEPSEEK_PRE_ACTION_WAIT_MS = IS_TEST_RUNTIME ? 0 : 1200
const DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS = IS_TEST_RUNTIME ? 50 : 60_000
const AUTOMATED_PAGE_HINT_COOLDOWN_MS = 750
let browserTabIdIndex = 0
const NO_CURRENT_VIDEO_RESULT: AssistantAutomationResult = {
  ok: false,
  steps: [],
  missingTargets: ['current-video'],
  message: '暂无视频，请先打开一个视频。'
}
const LOGIN_REQUIRED_RESULT: AssistantAutomationResult = {
  ok: false,
  steps: ['auth:check'],
  missingTargets: ['bilibili-login'],
  message: '请先登录 Bilibili 后再操作。'
}

type FavoriteLedgerBindingFailureCandidate = {
  id: string
  title: string
  memberCount: number
  shardNumber?: number
  bindingFailureReason: string
  bindingFailureDetail: string
}

type FavoriteLedgerBindingRegistrationResult = {
  failures: Array<{ ledgerId: string; candidates: FavoriteLedgerBindingFailureCandidate[] }>
  successfulBindings: Array<{ ledgerId: string; remoteFolderId: string; remoteTitle: string; memberCount: number; shardNumber: number }>
}

function createConfirmedReviewFavoriteInput(args: {
  accountMid: string
  video: VideoContentContext
  targetLedgerIds: string[]
  favoriteLedgers: FavoriteLedger[]
  result: AssistantAutomationResult
  occurredAt: string
  operationId: string
  classificationSource: 'system-high' | 'system-low' | 'deepseek' | 'manual'
}): FavoriteRepositoryConfirmedReviewInput | null {
  const aid = Number(args.video.aid)
  const accountMid = args.accountMid.trim()
  const remoteFolderIdsByLedgerId = args.result.favoriteFolderIdsByLedgerId
  const targetLedgerIds = Array.from(new Set(args.targetLedgerIds.map((id) => id.trim()).filter(Boolean)))

  if (
    !/^\d+$/.test(accountMid) ||
    !Number.isSafeInteger(aid) ||
    aid <= 0 ||
    !args.result.ok ||
    !args.result.steps.includes('api:favorite:add') ||
    !remoteFolderIdsByLedgerId ||
    targetLedgerIds.length === 0 ||
    targetLedgerIds.some((ledgerId) => !String(remoteFolderIdsByLedgerId[ledgerId] ?? '').trim())
  ) {
    return null
  }

  const localDesiredFolderIds = targetLedgerIds.map((ledgerId) => `bilimi-logical:${ledgerId}`)
  const remoteObservedPhysicalFolderIds = targetLedgerIds.map(
    (ledgerId) => String(remoteFolderIdsByLedgerId[ledgerId]).trim()
  )
  const title = args.video.title?.trim() || `Video ${aid}`
  const tags = Array.from(new Set((args.video.tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
  const folderTitlesAtTime = targetLedgerIds.map(
    (ledgerId) => args.favoriteLedgers.find((ledger) => ledger.id === ledgerId)?.displayName?.trim() || ledgerId
  )
  const videoPayload = {
    aid,
    title,
    tags,
    ...(tags.length > 0 ? { tagEvidence: 'confirmed' as const } : {}),
    ...(args.video.author?.trim() ? { author: args.video.author.trim() } : {}),
    ...(args.video.description?.trim() ? { description: args.video.description.trim() } : {}),
    ...(args.video.bvid?.trim() ? { bvid: args.video.bvid.trim() } : {}),
    ...(Number.isSafeInteger(Number(args.video.cid)) && Number(args.video.cid) > 0
      ? { cid: Number(args.video.cid) }
      : {}),
    ...(args.video.category?.trim() ? { category: args.video.category.trim() } : {}),
    favoriteAt: args.occurredAt,
    updatedAt: args.occurredAt
  }

  return {
    operationId: args.operationId,
    occurredAt: args.occurredAt,
    aid,
    video: videoPayload,
    targets: targetLedgerIds.map((ledgerId, index) => ({
      logicalFolderId: localDesiredFolderIds[index],
      remoteFolderId: remoteObservedPhysicalFolderIds[index],
      title: folderTitlesAtTime[index]
    })),
    classificationSource: args.classificationSource,
    event: {
      kind: 'entered',
      titleAtTime: title,
      folderTitlesAtTime,
      detail: '批阅收藏已由 B 站接口确认并写入收藏库。'
    }
  }
}

function createConfirmedDailyReviewCommands(args: {
  accountMid: string
  aid: number
  title: string
  previousTargetLedgerIds: string[]
  targetLedgerIds: string[]
  favoriteLedgers: FavoriteLedger[]
  initialResult: AssistantAutomationResult
  adjustmentResult: AssistantAutomationResult
  occurredAt: string
  operationId: string
}): { commands: FavoriteRepositoryCommand[]; confirmedInput?: FavoriteRepositoryConfirmedReviewInput; evidenceComplete: boolean } {
  const accountMid = args.accountMid.trim()
  const targetLedgerIds = Array.from(new Set(args.targetLedgerIds.map((id) => id.trim()).filter(Boolean)))
  const removedLedgerIds = Array.from(
    new Set(
      args.previousTargetLedgerIds
        .map((id) => id.trim())
        .filter((id) => id && !targetLedgerIds.includes(id))
    )
  )
  const remoteFolderIdsByLedgerId = {
    ...(args.initialResult.favoriteFolderIdsByLedgerId ?? {}),
    ...(args.adjustmentResult.favoriteFolderIdsByLedgerId ?? {})
  }
  const evidencedLedgerIds = [...targetLedgerIds, ...removedLedgerIds]
  const localDesiredFolderIds = targetLedgerIds.map((ledgerId) => `bilimi-logical:${ledgerId}`)
  const adjustmentFolderIdsByLedgerId = args.adjustmentResult.favoriteFolderIdsByLedgerId ?? {}
  const evidenceComplete = evidencedLedgerIds.every(
    (ledgerId) => String(adjustmentFolderIdsByLedgerId[ledgerId] ?? '').trim()
  )

  if (
    !/^\d+$/.test(accountMid) ||
    !Number.isSafeInteger(args.aid) ||
    args.aid <= 0 ||
    !args.adjustmentResult.ok ||
    !args.adjustmentResult.steps.includes('api:favorite:adjust') ||
    targetLedgerIds.length === 0
  ) {
    return { commands: [], evidenceComplete }
  }

  if (!evidenceComplete) {
    return {
      evidenceComplete: false,
      commands: [{
        id: `${args.operationId}:position`,
        accountMid,
        issuedAt: args.occurredAt,
        type: 'set-favorite-position',
        payload: {
          adjustmentKind: 'deepseek',
          audit: { operation: 'review', bilibiliSync: { attempted: true, status: 'result-unknown' } },
          aid: args.aid,
          localDesiredFolderIds,
          remoteObservedPhysicalFolderIds: Array.from(
            new Set(
              evidencedLedgerIds
                .map((ledgerId) => String(remoteFolderIdsByLedgerId[ledgerId] ?? '').trim())
                .filter(Boolean)
            )
          ),
          remoteObservedLogicalFolderIds: Array.from(
            new Set(
              evidencedLedgerIds
                .filter((ledgerId) => String(remoteFolderIdsByLedgerId[ledgerId] ?? '').trim())
                .map((ledgerId) => `bilimi-logical:${ledgerId}`)
            )
          ),
          positionState: 'result-unknown',
          observedAt: args.occurredAt,
          updatedAt: args.occurredAt,
          reason: 'daily-review remote adjustment evidence incomplete'
        }
      }]
    }
  }

  const folderTitlesAtTime = targetLedgerIds.map(
    (ledgerId) => args.favoriteLedgers.find((ledger) => ledger.id === ledgerId)?.displayName?.trim() || ledgerId
  )
  const previousTitles = args.previousTargetLedgerIds.map(
    (ledgerId) => args.favoriteLedgers.find((ledger) => ledger.id === ledgerId)?.displayName?.trim() || ledgerId
  )

  return {
    evidenceComplete: true,
    commands: [],
    confirmedInput: {
      operationId: args.operationId,
      occurredAt: args.occurredAt,
      aid: args.aid,
      targets: targetLedgerIds.map((ledgerId, index) => ({
        logicalFolderId: localDesiredFolderIds[index],
        remoteFolderId: String(adjustmentFolderIdsByLedgerId[ledgerId]).trim(),
        title: folderTitlesAtTime[index]
      })),
      classificationSource: 'deepseek',
      event: {
        kind: 'daily-review',
        titleAtTime: args.title,
        folderTitlesAtTime,
        detail: `DeepSeek 批阅二审将归属从「${previousTitles.join('、')}」调整为「${folderTitlesAtTime.join('、')}」。`
      }
    }
  }
}

type StartupPermissionGateProps = {
  onContinue: () => void
}

function StartupPermissionGate({ onContinue }: StartupPermissionGateProps) {
  return (
    <main className="startup-permission" aria-label="启动前权限检查">
      <section className="startup-permission__panel">
        <p className="startup-permission__eyebrow">bilimi</p>
        <h1>启动前权限检查</h1>
        <p className="startup-permission__lead">
          Windows 可能会询问是否允许 bilimi 访问网络。请点击允许，建议至少允许专用网络，
          否则登录、B 站页面操作、音频转写和 AI 功能可能无法正常工作。
        </p>
        <div className="startup-permission__actions">
          <button type="button" onClick={onContinue}>
            打开 bilimi
          </button>
        </div>
      </section>
    </main>
  )
}

function createTabTitle(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const lastSegment = parsedUrl.pathname.split('/').filter(Boolean).at(-1)

    return lastSegment || parsedUrl.hostname
  } catch {
    return url
  }
}

function createTabId(): string {
  browserTabIdIndex += 1
  return `tab-${Date.now()}-${browserTabIdIndex}`
}

function normalizeVideoTitle(title?: string): string | undefined {
  const normalized = title?.replace(BILIBILI_TITLE_SUFFIX, '').trim()
  return normalized || undefined
}

function normalizeActiveTabVideoTitle(tab?: BrowserTabModel): string | undefined {
  if (!tab || tab.title === '首页' || tab.title === createTabTitle(tab.url)) {
    return undefined
  }

  return normalizeVideoTitle(tab.title)
}

function readBilibiliVideoKey(url: string): string | undefined {
  return url.match(BILIBILI_VIDEO_URL_PATTERN)?.[1]
}

function normalizeBilibiliVideoSourceUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (!BILIBILI_VIDEO_URL_PATTERN.test(parsed.href)) return undefined
    const part = parsed.searchParams.get('p')?.trim()
    return `${parsed.origin}${parsed.pathname}${part ? `?p=${part}` : ''}`
  } catch {
    return undefined
  }
}

function isBilibiliVideoUrl(url?: string): boolean {
  return Boolean(url && BILIBILI_VIDEO_URL_PATTERN.test(url))
}

function pickRandomCommentDraft(drafts: string[]) {
  const index = Math.min(drafts.length - 1, Math.floor(Math.random() * drafts.length))
  return drafts[index] ?? ''
}

type TrustedPlayerActivationResult = AssistantAutomationResult & {
  clickPoint?: { x: number; y: number } | null
  paused?: boolean | null
}

function buildTrustedPlayerActivationScript(): string {
  return `
    (() => {
      const __bilimiTrustedPlayerActivation = true;
      void __bilimiTrustedPlayerActivation;
      const result = {
        ok: false,
        steps: [],
        missingTargets: [],
        message: '',
        clickPoint: null,
        paused: null
      };
      const isLikelyHidden = (node) => {
        const style = window.getComputedStyle?.(node);
        return style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0';
      };
      const hasVisibleRect = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return Boolean(rect && rect.width > 20 && rect.height > 20);
      };
      const centerOf = (node) => {
        const rect = node?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      };
      const video = Array.from(document.querySelectorAll('video')).find(hasVisibleRect) || null;
      const player =
        video?.closest?.('.bpx-player-container,.bpx-player,.bilibili-player,#bilibili-player,[class*="player"]') ||
        Array.from(document.querySelectorAll('.bpx-player-container,.bpx-player,.bilibili-player,#bilibili-player,[class*="player"]')).find(hasVisibleRect) ||
        video;
      const clickPoint = centerOf(video) || centerOf(player);

      if (!clickPoint) {
        result.missingTargets.push('player-click-target');
        result.message = '尚有 player-click-target 未能寻见。';
        return result;
      }


      result.clickPoint = clickPoint;
      result.paused = typeof video?.paused === 'boolean' ? video.paused : null;
      result.steps.push('player:locate');
      result.ok = true;
      result.message = '播放器已定位。';
      return result;
    })()
  `
}

function buildRestorePlayerPlaybackStateScript(paused?: boolean | null): string {
  const payload = JSON.stringify({ paused })

  return `
    (() => {
      const __bilimiRestorePlayerPlaybackState = true;
      void __bilimiRestorePlayerPlaybackState;
      const payload = ${payload};
      const video = document.querySelector('video');

      if (!video || typeof payload.paused !== 'boolean') {
        return {
          ok: true,
          steps: ['player:playback:unchecked'],
          missingTargets: [],
          message: '播放状态无需恢复。'
        };
      }

      if (Boolean(video.paused) === payload.paused) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        };
      }

      if (payload.paused) {
        video.pause?.();
      } else {
        const playResult = video.play?.();
        if (playResult?.catch) {
          playResult.catch(() => undefined);
        }
      }

      return {
        ok: true,
        steps: ['player:playback:restore'],
        missingTargets: [],
        message: '播放状态已恢复。'
      };
    })()
  `
}

function pendingQueueItemFromCurrentVideo(
  context: VideoContentContext,
  targetLedgerId: string,
  now = new Date().toISOString()
): PendingFavoriteQueueItem | null {
  const aid = Number(context.aid)

  if (!Number.isFinite(aid)) {
    return null
  }

  return {
    aid,
    title: context.title || '未命名视频',
    source: 'new-favorite',
    originalTargetLedgerId: targetLedgerId,
    suggestedLedgerIds: [],
    candidateLedgerNames: [],
    reason: '新收藏暂时没有明确分类',
    createdAt: now,
    updatedAt: now,
    status: 'pending'
  }
}

function ledgerDisplayName(ledgers: FavoriteLedger[], ledgerId: string) {
  return ledgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? ledgerId
}

function reviewWriteFallbackFeedback(args: {
  ledgers: FavoriteLedger[]
  suggestedLedgerIds: string[]
  writeLedgerIds: string[]
}): string | undefined {
  const suggestedLedgerId = args.suggestedLedgerIds[0]
  const writtenLedgerId = args.writeLedgerIds[0]
  if (!suggestedLedgerId || !writtenLedgerId || suggestedLedgerId === writtenLedgerId) return undefined

  const suggestedLedger = args.ledgers.find((ledger) => ledger.id === suggestedLedgerId)
  if (!suggestedLedger || isFavoriteLedgerRemoteWritable(suggestedLedger)) return undefined

  const suggestionState = suggestedLedger.bindingState === 'unbound' ? '未绑定' : '未备册'
  const writtenLabel = writtenLedgerId === 'inbox'
    ? '暂存'
    : ledgerDisplayName(args.ledgers, writtenLedgerId)
  return `预分类建议：${suggestedLedger.displayName}（${suggestionState}）\n已写入：${writtenLabel}`
}

function uniqueLedgerIds(ledgerIds: string[]) {
  return Array.from(new Set(ledgerIds.filter((ledgerId) => ledgerId.trim()).map((ledgerId) => ledgerId.trim())))
}

function diagnosticsForTargets(
  targets: FavoriteArchiveTarget[],
  fallbackDiagnostic?: FavoriteLedgerClassificationDiagnostic
) {
  const diagnostics = targets.flatMap((target) =>
    target.diagnostic ? [{ ledgerId: target.ledgerId, ...target.diagnostic }] : []
  )

  if (diagnostics.length === 0 && fallbackDiagnostic) {
    return [{ ledgerId: 'inbox', ...fallbackDiagnostic }]
  }

  return diagnostics
}

function shouldReviewDailyClassification(
  mode: AssistantPreferences['deepseekDailyClassificationMode'],
  diagnostics: Array<FavoriteLedgerClassificationDiagnostic & { ledgerId: string }>
) {
  if (mode === 'all') {
    return true
  }

  if (diagnostics.length === 0) {
    return true
  }

  return diagnostics.some(
    (diagnostic) =>
      diagnostic.lowConfidence ||
      diagnostic.confidence === 'low' ||
      diagnostic.scoreGap < 2.5 ||
      diagnostic.negativeRules.length > 0 ||
      (diagnostic.strongSignals.length === 0 && diagnostic.weakSignals.length > 0)
  )
}

function actionUsesFavorite(action: AssistantAction) {
  return action === '赏' || action === '藏' || action === '赐'
}

function mergeKeywordSuggestions(
  existing: FavoriteKeywordSuggestion[],
  incoming: FavoriteKeywordSuggestion[]
) {
  const existingIds = new Set(existing.map((suggestion) => suggestion.id))
  const existingSignatures = new Set(existing.map((suggestion) => [
    suggestion.action,
    suggestion.ledgerId,
    suggestion.keyword?.trim().toLocaleLowerCase() ?? '',
    suggestion.replacement?.trim().toLocaleLowerCase() ?? ''
  ].join('::')))
  const nextIncomingSuggestions: FavoriteKeywordSuggestion[] = []

  for (const suggestion of incoming) {
    const signature = [
      suggestion.action,
      suggestion.ledgerId,
      suggestion.keyword?.trim().toLocaleLowerCase() ?? '',
      suggestion.replacement?.trim().toLocaleLowerCase() ?? ''
    ].join('::')
    if (existingIds.has(suggestion.id) || existingSignatures.has(signature)) {
      continue
    }
    existingIds.add(suggestion.id)
    existingSignatures.add(signature)
    nextIncomingSuggestions.push(suggestion)
  }

  return [...existing, ...nextIncomingSuggestions]
}

type DailyClassificationReviewResult = Extract<
  DeepSeekGenerateResult,
  { kind: 'favorite-daily-classify-review' }
>

type DailyDeepSeekCorrection = {
  originalLedgerId: string
  targetLedgerIds: string[]
  reason: string
  keywordSuggestions: FavoriteKeywordSuggestion[]
}

function sameLedgerSet(left: string[], right: string[]) {
  const leftSet = new Set(uniqueLedgerIds(left))
  const rightSet = new Set(uniqueLedgerIds(right))

  return leftSet.size === rightSet.size && Array.from(leftSet).every((ledgerId) => rightSet.has(ledgerId))
}

function appliedDeepSeekConstraintNames(
  favoriteLedgers: FavoriteLedger[],
  reviewResult?: DailyClassificationReviewResult
) {
  return uniqueLedgerIds(reviewResult?.appliedConstraintLedgerIds ?? [])
    .filter((ledgerId) => favoriteLedgers.some((ledger) => ledger.id === ledgerId && ledger.enabled))
    .map((ledgerId) => ledgerDisplayName(favoriteLedgers, ledgerId))
}

function dailyReviewFeedback(input: {
  favoriteLedgers: FavoriteLedger[]
  localTargetLedgerIds: string[]
  reviewResult?: DailyClassificationReviewResult
}) {
  const localNames = input.localTargetLedgerIds
    .map((ledgerId) => ledgerDisplayName(input.favoriteLedgers, ledgerId))
    .join('、')
  const constraintNames = appliedDeepSeekConstraintNames(input.favoriteLedgers, input.reviewResult)
  const reviewAgreed = Boolean(input.reviewResult && !input.reviewResult.invalid)
  const constraintDetail = constraintNames.length
    ? `DeepSeek 约束生效：「${constraintNames.join('、')}」`
    : '本次未命中收藏夹约束'
  const conclusion = reviewAgreed
    ? `与本地判断一致，保留在「${localNames}」`
    : `本次沿用本地判断「${localNames}」`
  const prefix = reviewAgreed ? 'DeepSeek 二判完成' : 'DeepSeek 二判未完成'
  return constraintNames.length
    ? `${prefix}：${constraintDetail}；${conclusion}。`
    : `${prefix}：${conclusion}；${constraintDetail}。`
}

function dailyCorrectionFromReview(args: {
  favoriteLedgers: FavoriteLedger[]
  localTargetLedgerId: string
  localTargetLedgerIds: string[]
  reviewResult?: DailyClassificationReviewResult
}): DailyDeepSeekCorrection | undefined {
  if (
    !args.reviewResult?.corrected ||
    args.reviewResult.invalid ||
    args.reviewResult.targetLedgerIds.length === 0
  ) {
    return undefined
  }

  const usableTargetLedgerIds = uniqueLedgerIds(args.reviewResult.targetLedgerIds).filter(
    (ledgerId) =>
      ledgerId === 'inbox' ||
      args.favoriteLedgers.some((ledger) => ledger.id === ledgerId && ledger.enabled)
  )

  if (
    usableTargetLedgerIds.length === 0 ||
    sameLedgerSet(usableTargetLedgerIds, args.localTargetLedgerIds)
  ) {
    return undefined
  }

  return {
    originalLedgerId: args.localTargetLedgerId,
    targetLedgerIds: usableTargetLedgerIds,
    reason: args.reviewResult.reason,
    keywordSuggestions: args.reviewResult.keywordSuggestions
  }
}

function withResultMessagePrefix(
  result: AssistantAutomationResult,
  prefix: string,
  extra?: Pick<AssistantAutomationResult, 'missingTargets' | 'steps'>
): AssistantAutomationResult {
  const normalizedPrefix = prefix.trim()

  return {
    ...result,
    steps: extra?.steps ? [...result.steps, ...extra.steps] : result.steps,
    missingTargets: extra?.missingTargets
      ? [...result.missingTargets, ...extra.missingTargets]
      : result.missingTargets,
    message: result.message ? `${normalizedPrefix}\n${result.message}` : normalizedPrefix
  }
}

async function waitForDelay(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function waitForDailyReviewBeforeAction(
  reviewPromise: Promise<DailyClassificationReviewResult | undefined>
): Promise<
  | { status: 'ready'; result?: DailyClassificationReviewResult }
  | { status: 'pending' }
> {
  const pending = 'daily-review-pending' as const
  const result: DailyClassificationReviewResult | undefined | typeof pending = await Promise.race([
    reviewPromise,
    waitForDelay(DAILY_DEEPSEEK_PRE_ACTION_WAIT_MS).then(() => pending)
  ])

  if (result === pending) {
    return { status: 'pending' }
  }

  return { status: 'ready', result }
}

async function withTimeout<T>(
  promise: Promise<T>,
  delayMs: number,
  fallback: T
): Promise<T> {
  return Promise.race([promise, waitForDelay(delayMs).then(() => fallback)])
}

export default function App() {
  const [tabs, setTabs] = useState<BrowserTabModel[]>([
    {
      id: HOME_TAB_ID,
      title: '首页',
      url: BILIBILI_HOME_URL
    }
  ])
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID)
  const [favoriteLibraryOpen, setFavoriteLibraryOpen] = useState(false)
  const [favoriteLibraryResizing, setFavoriteLibraryResizing] = useState(false)
  const [assistantSidebarResizing, setAssistantSidebarResizing] = useState(false)
  const favoriteLibraryDrawerRef = useRef<FavoriteLibraryDrawerHandle>(null)
  const favoriteLibraryOpenRef = useRef(favoriteLibraryOpen)
  favoriteLibraryOpenRef.current = favoriteLibraryOpen
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const [webviews, setWebviews] = useState<Record<string, Electron.WebviewTag>>({})
  const [archiveSeekByTabId, setArchiveSeekByTabId] = useState<Record<string, { seconds: number; aid?: number; cid?: number }>>({})
  const webviewRefs = useRef<Record<string, Electron.WebviewTag>>({})
  const favoriteRepositoryPageTargetRef = useRef<ReturnType<typeof createFavoriteRepositoryPageTarget> | null>(null)
  const favoriteRepositoryTargetStates = useRef(new Map<number, FavoriteRepositoryPageTarget>())
  const activeTabChangeMounted = useRef(false)
  const lastPetVideoKey = useRef<string | undefined>(undefined)
  const assistantRuntimeFeedbackRef = useRef<{ id: number; message: string } | undefined>(undefined)
  const assistantSnapshotCacheRef = useRef<{
    accountMid: string
    favoriteLedgerStatus: FavoriteLedgerStatus | null
    videoContentContext: VideoContentContext
    videoContextUrl?: string
  }>({ accountMid: '', favoriteLedgerStatus: null, videoContentContext: {} })
  const videoNoteSourceCacheRef = useRef<{
    url?: string
    value?: VideoNoteExtractionResult | null
    pending?: Promise<VideoNoteExtractionResult | null>
  }>({})
  const favoriteLedgerStatusCacheRef = useRef<{
    accountMid: string
    ledgerSignature: string
    checkedAt: number
    status: FavoriteLedgerStatus
  } | null>(null)
  // A status read can outlive a main-process preference broadcast (for example,
  // deleting an unbound remote draft while its Bilibili inventory request is in
  // flight). Only the generation that started the read may publish its result.
  const favoriteLedgerStatusGenerationRef = useRef(0)
  const pendingFavoriteShardBindingsRef = useRef(new Map<string, {
    folder: { id: string; title: string; shardNumber: number }
  }>())
  const favoriteLedgerPreflightPromisesRef = useRef(new Map<string, Promise<FavoriteLedgerStatus>>())
  const favoriteLedgerEnsurePromisesRef = useRef(new Map<string, Promise<AssistantAutomationResult>>())
  const suppressPageInteractionHintsUntilRef = useRef(0)
  const petHiddenForVideoFullscreen = useRef(false)
  const videoFullscreenPetCloseTimer = useRef<number | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences(
      IS_TEST_RUNTIME ? { permissionOnboardingCompleted: true } : undefined
    )
  )
  const preferencesRef = useRef(preferences)
  const favoriteLedgerEnabledIndexRef = useRef(createFavoriteLedgerEnabledIndex(preferences))
  const renderedPreferencesRef = useRef(preferences)
  if (renderedPreferencesRef.current !== preferences) {
    renderedPreferencesRef.current = preferences
    preferencesRef.current = preferences
    favoriteLedgerEnabledIndexRef.current = createFavoriteLedgerEnabledIndex(preferences)
  }
  const [preferencesLoaded, setPreferencesLoaded] = useState(IS_TEST_RUNTIME)
  const activeWebview = useMemo(() => webviews[activeTabId] ?? null, [activeTabId, webviews])
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  )

  useEffect(() => {
    return window.bilimiDesktop?.onOpenFavoriteLibraryDrawer?.((command) => {
      if (command === 'toggle' && favoriteLibraryOpenRef.current && !favoriteLibraryDrawerRef.current?.isCollapsed()) {
        setFavoriteLibraryOpen(false)
        return
      }
      favoriteLibraryDrawerRef.current?.expand()
      setFavoriteLibraryOpen(true)
    })
  }, [])

  const commitTabs = useCallback(
    (updater: (currentTabs: BrowserTabModel[]) => BrowserTabModel[]) => {
      const nextTabs = updater(tabsRef.current)
      tabsRef.current = nextTabs
      setTabs(nextTabs)
    },
    []
  )

  const selectActiveTab = useCallback((nextActiveTabId: string) => {
    if (activeTabIdRef.current !== nextActiveTabId) {
      assistantSnapshotCacheRef.current.accountMid = ''
    }
    activeTabIdRef.current = nextActiveTabId
    setActiveTabId(nextActiveTabId)
  }, [])

  function getActiveTabSnapshot(): BrowserTabModel | undefined {
    return tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ?? tabsRef.current[0]
  }
  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      if (!window.bilimiDesktop?.loadPreferences) {
        if (!cancelled) {
          setPreferences(
            createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
          )
          setPreferencesLoaded(true)
        }
        return
      }

      try {
        const next = await window.bilimiDesktop.loadPreferences()

        if (!cancelled) {
          if (next) {
            const normalized = createInitialAssistantPreferences(next)
            const favoriteLedgersChanged =
              JSON.stringify(next.favoriteLedgers) !== JSON.stringify(normalized.favoriteLedgers) ||
              JSON.stringify(next.favoriteAccountPreferences) !== JSON.stringify(normalized.favoriteAccountPreferences)
            const saved = favoriteLedgersChanged && window.bilimiDesktop.savePreferences
              ? await window.bilimiDesktop.savePreferences(normalized)
              : normalized
            setPreferences(createInitialAssistantPreferences(saved))
          } else {
            setPreferences(
              createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
            )
          }
          setPreferencesLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setPreferences(
            createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
          )
          setPreferencesLoaded(true)
        }
      }
    }

    void loadPreferences()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencesChanged?.((nextPreferences) => {
      const normalized = createInitialAssistantPreferences(nextPreferences)
      preferencesRef.current = normalized
      favoriteLedgerStatusGenerationRef.current += 1
      favoriteLedgerStatusCacheRef.current = null
      assistantSnapshotCacheRef.current.favoriteLedgerStatus = null
      setPreferences(normalized)
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencePatchChanged?.((patch) => {
      if (patch.favoriteLedgers !== undefined || patch.favoriteAccountPreferences !== undefined) {
        favoriteLedgerStatusGenerationRef.current += 1
        favoriteLedgerStatusCacheRef.current = null
        assistantSnapshotCacheRef.current.favoriteLedgerStatus = null
      }
      const next = applyImmediatePreferencePatch(preferencesRef.current, patch)
      preferencesRef.current = next
      setPreferences(next)
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onFavoriteLedgerEnabledChanged?.((patch) => {
      applyIndexedFavoriteLedgerEnabledPatch(favoriteLedgerEnabledIndexRef.current, patch)
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onBilibiliSessionReloadRequested?.(() => {
      for (const webview of Object.values(webviewRefs.current)) {
        webview.reload?.()
      }
    })
  }, [])

  async function completeStartupPermissionGate() {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferences,
      permissionOnboardingCompleted: true
    })

    setPreferences(nextPreferences)
    if (window.bilimiDesktop?.savePreferences) {
      const saved = window.bilimiDesktop.patchPreferences
        ? await window.bilimiDesktop.patchPreferences({ permissionOnboardingCompleted: true })
        : await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  const notifyAssistantSnapshotChanged = useCallback(() => {
    window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
  }, [])

  const clearVideoFullscreenPetCloseTimer = useCallback(() => {
    if (videoFullscreenPetCloseTimer.current === null) {
      return
    }

    window.clearTimeout(videoFullscreenPetCloseTimer.current)
    videoFullscreenPetCloseTimer.current = null
  }, [])

  const restorePetAfterVideoFullscreen = useCallback(() => {
    petHiddenForVideoFullscreen.current = false
    clearVideoFullscreenPetCloseTimer()

    void Promise.resolve(window.bilimiDesktop?.wakeAssistantPet?.()).finally(() => {
      window.bilimiDesktop?.setAssistantPetHint?.({
        tone: 'hint',
        message: '全屏看完感觉怎么样？要不要和小咪互动一下？'
      })
    })
  }, [clearVideoFullscreenPetCloseTimer])

  const handleHtmlFullscreenChange = useCallback(
    (tabId: string, fullscreen: boolean) => {
      if (tabId !== activeTabIdRef.current || !preferences.hidePetDuringVideoFullscreen) {
        return
      }

      if (fullscreen) {
        if (petHiddenForVideoFullscreen.current) {
          return
        }

        petHiddenForVideoFullscreen.current = true
        window.bilimiDesktop?.setAssistantPetHint?.({
          tone: 'sleepy',
          message: '主人先安心全屏看，小咪不挡画面，待会儿回来找你～'
        })
        clearVideoFullscreenPetCloseTimer()
        videoFullscreenPetCloseTimer.current = window.setTimeout(() => {
          videoFullscreenPetCloseTimer.current = null
          window.bilimiDesktop?.closeAssistantPet?.()
        }, VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
        return
      }

      if (petHiddenForVideoFullscreen.current) {
        restorePetAfterVideoFullscreen()
      }
    },
    [
      clearVideoFullscreenPetCloseTimer,
      preferences.hidePetDuringVideoFullscreen,
      restorePetAfterVideoFullscreen
    ]
  )

  useEffect(() => {
    if (!preferences.hidePetDuringVideoFullscreen && petHiddenForVideoFullscreen.current) {
      restorePetAfterVideoFullscreen()
    }
  }, [preferences.hidePetDuringVideoFullscreen, restorePetAfterVideoFullscreen])

  useEffect(() => clearVideoFullscreenPetCloseTimer, [clearVideoFullscreenPetCloseTimer])

  const handleWebviewReady = useCallback((tabId: string, webview: Electron.WebviewTag) => {
    webviewRefs.current[tabId] = webview

    setWebviews((current) => {
      if (current[tabId] === webview) {
        return current
      }

      return {
        ...current,
        [tabId]: webview
      }
    })
  }, [])

  const handleFavoriteRepositoryTargetState = useCallback((
    _tabId: string,
    state: FavoriteRepositoryPageTarget & { webview: Electron.WebviewTag }
  ) => {
    favoriteRepositoryTargetStates.current.set(state.webContentsId, {
      webContentsId: state.webContentsId,
      instanceId: state.instanceId,
      navigationEpoch: state.navigationEpoch
    })
  }, [])

  const openInternalTab = useCallback((url: string) => {
    const nextUrl = url.trim()

    if (!nextUrl) {
      return undefined
    }

    const nextTabId = createTabId()
    commitTabs((currentTabs) => {
      const nextTab = {
        id: nextTabId,
        title: createTabTitle(nextUrl),
        url: nextUrl
      }

      selectActiveTab(nextTab.id)
      return [...currentTabs, nextTab]
    })
    return nextTabId
  }, [commitTabs, selectActiveTab])

  const closeInternalTab = useCallback(
    (tabIdToClose: string) => {
      if (tabIdToClose === HOME_TAB_ID) {
        return
      }

      delete webviewRefs.current[tabIdToClose]

      setWebviews((currentWebviews) => {
        const { [tabIdToClose]: _closedWebview, ...remainingWebviews } = currentWebviews

        return remainingWebviews
      })

      commitTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((tab) => tab.id === tabIdToClose)

        if (tabIndex === -1) {
          return currentTabs
        }

        const nextTabs = currentTabs.filter((tab) => tab.id !== tabIdToClose)

        if (activeTabIdRef.current === tabIdToClose) {
          const fallbackTab = currentTabs[tabIndex - 1] ?? nextTabs[0]

          selectActiveTab(fallbackTab?.id ?? HOME_TAB_ID)
        }

        return nextTabs
      })
    },
    [commitTabs, selectActiveTab]
  )

  useEffect(() => {
    return window.bilimiDesktop?.onOpenInTab?.(openInternalTab)
  }, [openInternalTab])

  useEffect(() => window.bilimiDesktop?.onOpenVideoNoteArchiveSource?.(({ url, seconds, aid, cid }) => {
    const videoKey = readBilibiliVideoKey(url)
    const exactSourceUrl = normalizeBilibiliVideoSourceUrl(url)
    const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    const exactMatchingTab = exactSourceUrl
      ? (activeTab && normalizeBilibiliVideoSourceUrl(activeTab.url) === exactSourceUrl
          ? activeTab
          : tabsRef.current.find((tab) => normalizeBilibiliVideoSourceUrl(tab.url) === exactSourceUrl))
      : videoKey
        ? (activeTab && readBilibiliVideoKey(activeTab.url) === videoKey
          ? activeTab
          : tabsRef.current.find((tab) => readBilibiliVideoKey(tab.url) === videoKey))
        : undefined
    // A timestamped archive seek may reuse an already loaded same-video tab;
    // the CID/P selector below moves that tab to the requested part. A title
    // click without a seek keeps exact P matching and can open a new tab.
    const matchingTab = exactMatchingTab ?? (seconds !== undefined && videoKey
      ? (activeTab && readBilibiliVideoKey(activeTab.url) === videoKey
          ? activeTab
          : tabsRef.current.find((tab) => readBilibiliVideoKey(tab.url) === videoKey))
      : undefined)
    const tabId = matchingTab?.id ?? openInternalTab(url)
    if (!tabId) return
    if (matchingTab) selectActiveTab(tabId)
    if (seconds === undefined) return
    setArchiveSeekByTabId((current) => ({ ...current, [tabId]: { seconds, ...(aid === undefined ? {} : { aid }), ...(cid === undefined ? {} : { cid }) } }))
  }), [openInternalTab, selectActiveTab])

  useEffect(() => {
    if (!activeTabChangeMounted.current) {
      activeTabChangeMounted.current = true
      return
    }

    notifyAssistantSnapshotChanged()
  }, [activeTabId, notifyAssistantSnapshotChanged])

  const updateTabUrl = useCallback(
    (tabId: string, url: string) => {
      commitTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                title: tab.title === '首页' || tab.title === createTabTitle(tab.url) ? createTabTitle(url) : tab.title,
                url
              }
            : tab
        )
      )

      if (tabId === activeTabIdRef.current) {
        assistantSnapshotCacheRef.current.accountMid = ''
        videoNoteSourceCacheRef.current = {}
        assistantSnapshotCacheRef.current.videoContextUrl = url
        assistantSnapshotCacheRef.current.videoContentContext = {
          title: normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ?? createTabTitle(url)
        }
        const videoKey = readBilibiliVideoKey(url)

        if (videoKey && videoKey !== lastPetVideoKey.current) {
          lastPetVideoKey.current = videoKey
          window.bilimiDesktop?.setAssistantPetHint?.({
            tone: 'hint',
            message: pickPetLine(PET_VIDEO_OPENING_LINES)
          })
        }

        notifyAssistantSnapshotChanged()
      }
    },
    [commitTabs, notifyAssistantSnapshotChanged]
  )

  const updateTabTitle = useCallback(
    (tabId: string, title: string) => {
      commitTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                title
              }
            : tab
        )
      )

      if (tabId === activeTabIdRef.current) {
        videoNoteSourceCacheRef.current = {}
        assistantSnapshotCacheRef.current.videoContextUrl = getActiveTabSnapshot()?.url
        assistantSnapshotCacheRef.current.videoContentContext = {
          ...assistantSnapshotCacheRef.current.videoContentContext,
          title: normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ?? title
        }
        notifyAssistantSnapshotChanged()
      }
    },
    [commitTabs, notifyAssistantSnapshotChanged]
  )
  const handlePageInteractionHint = useCallback((message: string) => {
    if (Date.now() < suppressPageInteractionHintsUntilRef.current) return
    window.bilimiDesktop?.setAssistantPetHint?.({ tone: 'hint', message })
  }, [])

  function getCurrentActiveWebview() {
    return (
      activeWebview ??
      webviewRefs.current[activeTabId] ??
      (document.querySelector('webview[data-active="true"]') as Electron.WebviewTag | null)
    )
  }

  async function runFavoriteRepositoryPageOperation(
    accountMid: string,
    runId: string,
    target: FavoriteRepositoryPageTarget,
    action: 'append' | 'remove' | 'unfavorite' | 'read-members' | 'read-folder-inventory' | 'create-folder' | 'delete-folder' | 'rename-folder',
    input: { accountMid: string; operationKey: string; aid?: number; folderIds?: string[]; title?: string; folderId?: string }
  ) {
    favoriteRepositoryPageTargetRef.current ??= createFavoriteRepositoryPageTarget({
      getActiveWebview: getCurrentActiveWebview,
      findWebviewById: (webContentsId) => Object.values(webviewRefs.current).find(
        (webview) => webview.getWebContentsId?.() === webContentsId
      ),
      getNavigationEpoch: (webContentsId, instanceId) => {
        const current = favoriteRepositoryTargetStates.current.get(webContentsId)
        return current?.instanceId === instanceId ? current.navigationEpoch : undefined
      }
    })
    if (input.accountMid !== accountMid) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'account-mismatch' }
    }
    return favoriteRepositoryPageTargetRef.current.run(target, action, input)
  }

  async function bindFavoriteRepositoryPageTarget(accountMid: string) {
    const webview = getCurrentActiveWebview()
    const webContentsId = webview?.getWebContentsId?.()
    let target = typeof webContentsId === 'number' ? favoriteRepositoryTargetStates.current.get(webContentsId) : undefined
    if (!target && typeof webContentsId === 'number') {
      // A restored guest can finish loading before BiliWebview attaches its
      // listeners. Recreate state for this active guest only, then still
      // verify its account and navigation epoch before returning a target.
      target = {
        webContentsId,
        instanceId: webview.getAttribute('data-favorite-repository-instance-id') || `bili-webview-rehydrated:${webContentsId}`,
        navigationEpoch: 0
      }
      favoriteRepositoryTargetStates.current.set(webContentsId, target)
    }
    if (!target || webview?.isLoading?.() || !webview?.executeJavaScript) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
    try {
      const before = String(await webview.executeJavaScript(
        `(() => String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=(\\d+)/)?.[1] || '')()`, true
      )).trim()
      if (before !== accountMid || favoriteRepositoryTargetStates.current.get(webContentsId)?.navigationEpoch !== target.navigationEpoch) {
        return { status: 'unknown' as const, observedAccountMid: before, reason: 'account-mismatch' }
      }
      return { status: 'ok' as const, observedAccountMid: before, target }
    } catch {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
  }

  async function runOldFavoriteWorkspacePageCommand(
    accountMid: string,
    target: FavoriteRepositoryPageTarget,
    command: OldFavoriteWorkspacePageCommand
  ) {
    const bound = Object.values(webviewRefs.current).find(
      (webview) => webview.getWebContentsId?.() === target.webContentsId
    )
    const current = favoriteRepositoryTargetStates.current.get(target.webContentsId)
    if (!bound || !current || bound.isLoading?.() || !bound.executeJavaScript ||
      current.webContentsId !== target.webContentsId || current.instanceId !== target.instanceId ||
      current.navigationEpoch !== target.navigationEpoch) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
    const bridge = createOldFavoriteWorkspacePageBridge({
      execute: (_target, script) => bound.executeJavaScript(script, true)
    })
    const result = await bridge.run(target, command)
    const after = favoriteRepositoryTargetStates.current.get(target.webContentsId)
    if (!after || after.instanceId !== target.instanceId || after.navigationEpoch !== target.navigationEpoch) {
      return { status: 'unknown' as const, observedAccountMid: result.observedAccountMid, reason: 'target-navigated' }
    }
    return result
  }

  function refreshActiveTab() {
    getCurrentActiveWebview()?.reload?.()
  }

  async function readVideoContentContext(): Promise<VideoContentContext> {
    const currentActiveWebview = getCurrentActiveWebview()
    const activeTabSnapshot = getActiveTabSnapshot()
    const activeTabVideoTitle = normalizeActiveTabVideoTitle(activeTabSnapshot)

    if (!currentActiveWebview?.executeJavaScript) {
      const context = { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = context
      return context
    }

    try {
      const context = (await currentActiveWebview.executeJavaScript(
        buildVideoContentContextScript(),
        true
      )) as VideoContentContext
      const normalizedContext = activeTabVideoTitle ? { ...context, title: activeTabVideoTitle } : context
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = normalizedContext
      return normalizedContext
    } catch {
      const context = { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = context
      return context
    }
  }

  async function readVideoNoteSource(): Promise<VideoNoteExtractionResult | null> {
    const currentActiveWebview = getCurrentActiveWebview()
    const activeTabUrl = getActiveTabSnapshot()?.url

    if (!currentActiveWebview?.executeJavaScript) {
      return null
    }

    const cached = videoNoteSourceCacheRef.current
    if (cached.url === activeTabUrl) {
      if (cached.value !== undefined) return cached.value
      if (cached.pending) return cached.pending
    }

    const cachedContext = assistantSnapshotCacheRef.current.videoContextUrl === activeTabUrl
      ? assistantSnapshotCacheRef.current.videoContentContext
      : undefined
    if (cachedContext && (cachedContext.bvid || cachedContext.aid || cachedContext.cid)) {
      const sharedResult: VideoNoteExtractionResult = {
        source: {
          title: cachedContext.title?.trim() || activeTabUrl || '当前视频',
          author: cachedContext.author,
          description: cachedContext.description,
          tags: cachedContext.tags ?? [],
          bvid: cachedContext.bvid,
          aid: cachedContext.aid,
          cid: cachedContext.cid,
          url: activeTabUrl ?? 'about:blank'
        },
        transcript: [],
        transcriptSource: 'manual'
      }
      videoNoteSourceCacheRef.current = { url: activeTabUrl, value: sharedResult }
      return sharedResult
    }

    const pending = (async () => {
      try {
        const raw = await currentActiveWebview.executeJavaScript(
          buildVideoNoteExtractionScript(),
          true
        )
        return normalizeExtractedVideoNoteResult(
          raw as Parameters<typeof normalizeExtractedVideoNoteResult>[0]
        )
      } catch {
        return null
      }
    })()
    videoNoteSourceCacheRef.current = { url: activeTabUrl, pending }

    const result = await pending
    if (videoNoteSourceCacheRef.current.url === activeTabUrl && videoNoteSourceCacheRef.current.pending === pending) {
      videoNoteSourceCacheRef.current = { url: activeTabUrl, value: result }
    }

    if (result && getActiveTabSnapshot()?.url === activeTabUrl) {
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabUrl
      assistantSnapshotCacheRef.current.videoContentContext = {
        ...assistantSnapshotCacheRef.current.videoContentContext,
        title: result.source.title,
        author: result.source.author,
        description: result.source.description,
        tags: result.source.tags,
        bvid: result.source.bvid
      }
      notifyAssistantSnapshotChanged()
    }

    return result
  }

  async function readCurrentMultipartVideo(): Promise<MultipartVideoSnapshot | null> {
    const currentActiveWebview = getCurrentActiveWebview()
    if (!currentActiveWebview?.executeJavaScript) return null
    const raw = await currentActiveWebview.executeJavaScript(buildMultipartVideoSnapshotScript(), true)
    return normalizeMultipartVideoSnapshot(raw as Parameters<typeof normalizeMultipartVideoSnapshot>[0])
  }

  async function readCurrentVideoTime(): Promise<number> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      throw new Error('浏览框尚未备妥，无法读取时间点。')
    }

    return currentActiveWebview.executeJavaScript(
      buildReadCurrentVideoTimeScript(),
      true
    ) as Promise<number>
  }

  async function seekVideoTime(seconds: number): Promise<boolean> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      throw new Error('浏览框尚未备妥，无法跳转时间点。')
    }

    return currentActiveWebview.executeJavaScript(
      buildSeekVideoTimeScript(seconds),
      true
    ) as Promise<boolean>
  }

  async function runScript(script: string): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览案台尚未备妥。'
      }
    }

    return currentActiveWebview.executeJavaScript(script) as Promise<AssistantAutomationResult>
  }

  async function isBilibiliLoggedIn(): Promise<boolean> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return false
    }

    try {
      const loginState = await currentActiveWebview.executeJavaScript(
        `(() => {
          const cookie = String(document.cookie || '')
          const hasUserId = /(?:^|;\\s*)DedeUserID=\\d+/.test(cookie)
          const hasCsrf = /(?:^|;\\s*)bili_jct=[^;]+/.test(cookie)
          return { hasUserId, hasCsrf }
        })()`,
        true
      )

      if (loginState && typeof loginState === 'object') {
        if ('hasUserId' in loginState || 'hasCsrf' in loginState) {
          return Boolean(loginState.hasUserId && loginState.hasCsrf)
        }

        return true
      }

      return Boolean(String(loginState ?? '').trim())
    } catch {
      return false
    }
  }

  async function readBilibiliAccountMid(): Promise<string> {
    if (window.bilimiDesktop?.readBilibiliAccountMid) {
      try {
        const accountMid = (await window.bilimiDesktop.readBilibiliAccountMid()).trim()
        assistantSnapshotCacheRef.current.accountMid = accountMid
        return accountMid
      } catch {
        assistantSnapshotCacheRef.current.accountMid = ''
        return ''
      }
    }
    const currentActiveWebview = getCurrentActiveWebview()
    if (!currentActiveWebview?.executeJavaScript) return ''
    try {
      const accountMid = String(await currentActiveWebview.executeJavaScript(
        `(() => String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=([^;]+)/)?.[1] || '')()`,
        true
      )).trim()
      assistantSnapshotCacheRef.current.accountMid = accountMid
      return accountMid
    } catch {
      return ''
    }
  }

  async function requireBilibiliLogin(): Promise<AssistantAutomationResult | null> {
    return (await isBilibiliLoggedIn()) ? null : LOGIN_REQUIRED_RESULT
  }

  function favoriteLedgersForActiveAccount(accountMid: string): FavoriteLedger[] {
    const currentPreferences = preferencesRef.current
    return accountMid ? favoriteLedgersForAccount(currentPreferences, accountMid) : currentPreferences.favoriteLedgers
  }

  function preferencesWithFavoriteLedgers(
    currentPreferences: AssistantPreferences,
    accountMid: string,
    favoriteLedgers: FavoriteLedger[]
  ): AssistantPreferences {
    return accountMid
      ? withFavoriteLedgersForAccount(currentPreferences, accountMid, favoriteLedgers)
      : { ...currentPreferences, favoriteLedgers }
  }

  function mergeBackupResultIntoLocalLedgers(
    currentLedgers: FavoriteLedger[],
    resultLedgers: FavoriteLedger[]
  ): FavoriteLedger[] {
    const resultById = new Map(resultLedgers.map((ledger) => [ledger.id, ledger]))
    const currentIds = new Set(currentLedgers.map((ledger) => ledger.id))
    return [
      ...currentLedgers.map((ledger) => resultById.get(ledger.id) ?? ledger),
      ...resultLedgers.filter((ledger) => !currentIds.has(ledger.id))
    ]
  }

  async function projectFavoriteLedgersToFormalBindings(
    accountMid: string,
    favoriteLedgers: FavoriteLedger[]
  ) {
    const repositorySummary = accountMid && window.bilimiDesktop?.openFavoriteRepositoryAccount
      ? await window.bilimiDesktop.openFavoriteRepositoryAccount(accountMid).catch(() => null)
      : null
    const trustedRemoteFolderIds = new Map<string, string[]>()
    const trustedRemoteShardNumbers = new Map<string, Map<string, number>>()
    const repositoryShards = repositorySummary?.physicalShards ?? []
    for (const shard of repositoryShards) {
      if (shard.bindingState !== 'bound' || !shard.remoteFolderId) continue
      const ids = trustedRemoteFolderIds.get(shard.logicalLedgerId) ?? []
      if (!ids.includes(shard.remoteFolderId)) ids.push(shard.remoteFolderId)
      trustedRemoteFolderIds.set(shard.logicalLedgerId, ids)
      const shardNumbers = trustedRemoteShardNumbers.get(shard.logicalLedgerId) ?? new Map<string, number>()
      shardNumbers.set(shard.remoteFolderId, shard.shardNumber)
      trustedRemoteShardNumbers.set(shard.logicalLedgerId, shardNumbers)
    }
    // Older summaries may omit shard details, but an explicit zero means the
    // logical folder has no formal binding.  Never recover authority from a
    // stale logical-folder remote ID in that case.
    if (!repositoryShards.length && Number(repositorySummary?.physicalShardCount ?? 0) > 0) {
      for (const folder of repositorySummary?.folders ?? []) {
        if (folder.kind !== 'bilimi-logical' || folder.syncState !== 'bound' || !folder.logicalLedgerId || !folder.remoteFolderId) continue
        trustedRemoteFolderIds.set(folder.logicalLedgerId, [folder.remoteFolderId])
        trustedRemoteShardNumbers.set(folder.logicalLedgerId, new Map([[folder.remoteFolderId, 1]]))
      }
    }

    return {
      trustedRemoteFolderIds,
      trustedRemoteShardNumbers,
      ledgers: favoriteLedgers.map((ledger) => {
        // A right-side local deletion deliberately resets a default rule while
        // preserving its Bilibili folder. Until a later backup explicitly
        // confirms a binding, an older repository snapshot must not silently
        // restore that physical association.
        if (ledger.managedFolderDeletedByUser) {
          return ledger
        }
        const trustedFolderIds = trustedRemoteFolderIds.get(ledger.id) ?? []
        if (trustedFolderIds.length) {
          const legacyPendingRemoteFolderId = ledger.pendingRemoteBinding && !ledger.pendingRemoteFolderId && ledger.bilibiliFolderId && !trustedFolderIds.includes(ledger.bilibiliFolderId)
            ? ledger.bilibiliFolderId
            : undefined
          return {
            ...ledger,
            bilibiliFolderId: trustedFolderIds[0],
            bilibiliFolderIds: trustedFolderIds,
            bindingState: 'bound' as const,
            ...(legacyPendingRemoteFolderId ? {
              pendingRemoteBinding: true,
              pendingRemoteFolderId: legacyPendingRemoteFolderId,
              pendingRemoteFolderTitle: ledger.bilibiliFolderTitle
            } : {})
          }
        }
        // A shard creation has an authoritative Bilibili folder ID even while
        // the next inventory read has not caught up. Preserve it solely for a
        // retry of that exact ID; it is never considered write-authorized.
        if (ledger.pendingRemoteBinding) {
          const legacyPendingRemoteFolderId = ledger.pendingRemoteFolderId ?? ledger.bilibiliFolderId
          if (legacyPendingRemoteFolderId) {
            const formalFolderIds = (ledger.bilibiliFolderIds ?? []).filter((id) => id !== legacyPendingRemoteFolderId)
            return {
              ...ledger,
              ...(formalFolderIds.length ? { bilibiliFolderId: formalFolderIds[0], bilibiliFolderIds: formalFolderIds } : {}),
              pendingRemoteFolderId: legacyPendingRemoteFolderId,
              pendingRemoteFolderTitle: ledger.pendingRemoteFolderTitle ?? ledger.bilibiliFolderTitle
            }
          }
        }
        if (ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound' && ledger.bilibiliFolderId) {
          return ledger
        }
        // Settings carry user preference only. Remote writes require the repository's formal binding.
        const {
          bilibiliFolderId: _bilibiliFolderId,
          bilibiliFolderTitle: _bilibiliFolderTitle,
          bilibiliFolderVideoCount: _bilibiliFolderVideoCount,
          bindingState: _bindingState,
          ...unboundLedger
        } = ledger
        return unboundLedger
      })
    }
  }

  function favoriteLedgerBindingFailure(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error ?? '').trim()
    if (/remote folder inventory is unavailable|page bridge is unavailable/i.test(detail)) {
      return { reason: '无法读取当前 B 站收藏夹清单，请确认 B 站页面已打开并刷新后重试。', detail }
    }
    if (/remote account mismatch/i.test(detail)) {
      return { reason: '当前 B 站登录账号与待绑定账号不一致，请切换回原账号后重试。', detail }
    }
    if (/remote shard is absent from inventory/i.test(detail)) {
      return { reason: '远端收藏夹已不在本次清单中，请刷新 B 站收藏夹后重新确认。', detail }
    }
    if (/remote shard title is invalid/i.test(detail)) {
      return { reason: '远端收藏夹标题已变化，请刷新后重新确认要绑定的收藏夹。', detail }
    }
    if (/remote shard inventory is invalid/i.test(detail)) {
      return { reason: '远端收藏夹数据异常，请刷新 B 站收藏夹后重试。', detail }
    }
    if (/remote shard is already bound|logical shard conflicts/i.test(detail)) {
      return { reason: '该收藏夹已与其他工作夹或分册绑定，请先核对现有绑定。', detail }
    }
    return { reason: '正式绑定未完成，请刷新 B 站收藏夹后重新确认。', detail }
  }

  async function registerNewFavoriteLedgerBindings(
    accountMid: string,
    inputLedgers: FavoriteLedger[],
    resultLedgers: FavoriteLedger[],
    rebindRemoteFolderIds?: Record<string, string>,
    rebindRemoteFolders?: Record<string, Array<{ id: string; title: string; memberCount?: number; shardNumber?: number }>>,
    trustedRemoteShardNumbers?: ReadonlyMap<string, ReadonlyMap<string, number>>
  ): Promise<FavoriteLedgerBindingRegistrationResult> {
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const shardNumberFromTitle = (title: string, baseTitle: string): number | undefined => {
      const normalizedTitle = title.trim()
      const normalizedBaseTitle = baseTitle.trim()
      if (normalizedTitle === normalizedBaseTitle) return 1
      const match = normalizedTitle.match(new RegExp(`^${escapeRegExp(normalizedBaseTitle)}·([2-9]\\d*)$`))
      if (!match) return undefined
      const shardNumber = Number(match[1])
      return Number.isSafeInteger(shardNumber) && shardNumber >= 2 ? shardNumber : undefined
    }
    const inputRemoteFolderIds = new Map(inputLedgers.map((ledger) => [
      ledger.id,
      new Set([
        ledger.bilibiliFolderId,
        ...(ledger.bilibiliFolderIds ?? [])
      ].map((folderId) => folderId?.trim()).filter((folderId): folderId is string => Boolean(folderId)))
    ]))
    const registrations: Array<{
      ledger: FavoriteLedger
      remoteFolderId: string
      remoteTitle: string
      memberCount: number
      shardNumber: number
      // Only a folder selected in the explicit binding-confirmation dialog
      // receives permission to repair its displayed remote shard name.
      allowRemoteRename: boolean
    }> = []
    for (const ledger of resultLedgers) {
      // A discovered same-name candidate remains explicitly unbound until the
      // owner confirms it in the rebind dialog. Older successful create
      // responses may omit bindingState, so only an explicit unbound state is
      // excluded here.
      if (ledger.bindingState === 'unbound') continue
      const remoteFolderId = ledger.bilibiliFolderId?.trim()
      if (!remoteFolderId) continue
      const explicitlySelectedFolderId = rebindRemoteFolderIds?.[ledger.id]?.trim()
      const selectedFolders = rebindRemoteFolders?.[ledger.id]?.filter((folder) => folder.id.trim()) ?? []
      // A newly created remote folder has no matching input ID, even if a
      // locally deleted default rule still carries its former ID for display.
      // It must be registered in the same backup operation; otherwise the
      // next authoritative inventory projects it back as unbound.
      const knownInputRemoteFolderIds = inputRemoteFolderIds.get(ledger.id) ?? new Set<string>()
      if (selectedFolders.length || explicitlySelectedFolderId === remoteFolderId || !knownInputRemoteFolderIds.has(remoteFolderId)) {
        const folders = selectedFolders.length ? selectedFolders : [{ id: remoteFolderId, title: ledger.displayName }]
        const knownShardNumbers = trustedRemoteShardNumbers?.get(ledger.id) ?? new Map<string, number>()
        const occupiedShardNumbers = new Set(knownShardNumbers.values())
        for (const folder of folders) {
          const titledShardNumber = shardNumberFromTitle(folder.title, ledger.displayName)
          if (titledShardNumber === undefined) continue
          const existingShardNumber = knownShardNumbers.get(folder.id.trim())
          let shardNumber = existingShardNumber ?? folder.shardNumber ?? titledShardNumber
          if (titledShardNumber === 1 && !existingShardNumber && occupiedShardNumbers.has(1)) {
            shardNumber = 2
            while (occupiedShardNumbers.has(shardNumber)) shardNumber += 1
          }
          occupiedShardNumbers.add(shardNumber)
          registrations.push({
            ledger,
            remoteFolderId: folder.id.trim(),
            remoteTitle: folder.title.trim() || ledger.displayName,
            memberCount: Number.isSafeInteger(folder.memberCount) && folder.memberCount >= 0 ? folder.memberCount : 0,
            shardNumber,
            allowRemoteRename: selectedFolders.length > 0
          })
        }
      }
    }

    const failures: FavoriteLedgerBindingRegistrationResult['failures'] = []
    const successfulBindings: Array<{ ledgerId: string; remoteFolderId: string; remoteTitle: string; memberCount: number; shardNumber: number }> = []
    for (const { ledger, remoteFolderId, remoteTitle, memberCount, shardNumber, allowRemoteRename } of registrations) {
      if (!window.bilimiDesktop?.adoptFavoriteRepositoryLedgerBinding) {
        failures.push({
          ledgerId: ledger.id,
          candidates: [{
            id: remoteFolderId,
            title: remoteTitle,
            memberCount,
            bindingFailureReason: '收藏库绑定服务不可用，请重启应用后重试。',
            bindingFailureDetail: 'Favorite repository binding service is unavailable.'
          }]
        })
        continue
      }
      try {
        await window.bilimiDesktop.adoptFavoriteRepositoryLedgerBinding(accountMid, {
          logicalLedgerId: ledger.id, shardNumber,
          logicalTitle: ledger.displayName,
          remoteFolderId,
          remoteTitle,
          ...(allowRemoteRename ? { allowRemoteRename: true } : {})
        })
        successfulBindings.push({ ledgerId: ledger.id, remoteFolderId, remoteTitle, memberCount, shardNumber })
      } catch (error) {
        const failure = favoriteLedgerBindingFailure(error)
        failures.push({
          ledgerId: ledger.id,
          candidates: [{
            id: remoteFolderId,
            title: remoteTitle,
            memberCount,
            bindingFailureReason: failure.reason,
            bindingFailureDetail: failure.detail
          }]
        })
      }
    }
    return { failures, successfulBindings }
  }

  function ledgersAfterBindingRegistration(
    resultLedgers: FavoriteLedger[],
    bindingResult: FavoriteLedgerBindingRegistrationResult,
    formalLedgers: FavoriteLedger[] = []
  ): FavoriteLedger[] {
    const formalLedgerById = new Map(formalLedgers.map((ledger) => [ledger.id, ledger]))
    const successfulBindingsByLedger = new Map<string, FavoriteLedgerBindingRegistrationResult['successfulBindings']>()
    for (const binding of bindingResult.successfulBindings) {
      const current = successfulBindingsByLedger.get(binding.ledgerId) ?? []
      current.push(binding)
      successfulBindingsByLedger.set(binding.ledgerId, current)
    }
    return resultLedgers.map((ledger) => {
      const successful = successfulBindingsByLedger.get(ledger.id)
      if (!successful?.length) {
        if (!bindingResult.failures.some((failure) => failure.ledgerId === ledger.id)) return ledger
        const { bilibiliFolderId: _folderId, bilibiliFolderIds: _folderIds, bilibiliFolderTitle: _folderTitle, bilibiliFolderVideoCount: _videoCount, bindingState: _bindingState, ...unboundLedger } = ledger
        return { ...unboundLedger, bindingState: 'unbound' as const }
      }
      const successfulIds = successful.map((binding) => binding.remoteFolderId)
      const formalLedger = formalLedgerById.get(ledger.id)
      // A local-only deletion leaves the former remote ID on the rule only as
      // historical display data. A successful newly-created binding replaces
      // it; retaining that stale ID would make the next save point back to a
      // folder the user has deliberately released.
      const existingIds = formalLedger?.managedFolderDeletedByUser
        ? []
        : [...new Set([
            formalLedger?.bilibiliFolderId,
            ...(formalLedger?.bilibiliFolderIds ?? [])
          ].filter((folderId): folderId is string => Boolean(folderId) && !successfulIds.includes(folderId)))]
      const folderIds = [...existingIds, ...successfulIds]
      // The main process clears this durable default-deletion marker after the
      // same formal adoption. Keep the renderer's subsequent preference save
      // from restoring the stale marker.
      const { managedFolderDeletedByUser: _managedFolderDeletedByUser, ...ledgerWithoutDeletionMarker } = ledger
      return {
        ...ledgerWithoutDeletionMarker,
        bilibiliFolderId: folderIds[0],
        bilibiliFolderIds: folderIds,
        bilibiliFolderTitle: existingIds.length ? formalLedger?.bilibiliFolderTitle : successful[0].remoteTitle,
        bilibiliFolderVideoCount: (existingIds.length ? formalLedger?.bilibiliFolderVideoCount ?? 0 : 0) +
          successful.reduce((count, binding) => count + binding.memberCount, 0),
        bindingState: 'bound' as const
      }
    })
  }

  async function readFavoriteLedgerStatus(
    accountMid = assistantSnapshotCacheRef.current.accountMid,
    options: { force?: boolean } = {}
  ): Promise<FavoriteLedgerStatus> {
    const statusGeneration = favoriteLedgerStatusGenerationRef.current
    const favoriteLedgers = favoriteLedgersForActiveAccount(accountMid)
    const ledgerSignature = JSON.stringify(favoriteLedgers.map((ledger) => ({
      id: ledger.id,
      displayName: ledger.displayName,
      enabled: ledger.enabled,
      syncState: ledger.syncState,
      bindingState: ledger.bindingState,
      bilibiliFolderId: ledger.bilibiliFolderId
    })))
    const cached = favoriteLedgerStatusCacheRef.current
    if (!options.force && cached?.accountMid === accountMid && Date.now() - cached.checkedAt < 30_000) {
      assistantSnapshotCacheRef.current.favoriteLedgerStatus = cached.status
      return cached.status
    }
    const { ledgers: ledgersWithRepositoryCandidates } = await projectFavoriteLedgersToFormalBindings(
      accountMid,
      favoriteLedgers
    )
    const [dismissedRemoteDraftReminderIds, pendingRemoteDraftRediscoveryIds] = await Promise.all([
      window.bilimiDesktop?.getFavoriteLedgerRemoteDraftReminderDismissals?.(accountMid).catch(() => []) ?? [],
      window.bilimiDesktop?.getFavoriteLedgerRemoteDraftRediscoveryPending?.(accountMid).catch(() => []) ?? []
    ])
    const suppressedRemoteDraftFolderIds = [...new Set([
      ...dismissedRemoteDraftReminderIds,
      ...pendingRemoteDraftRediscoveryIds
    ])]
    const status = await runScript(
      buildFavoriteLedgerStatusScript(ledgersWithRepositoryCandidates, suppressedRemoteDraftFolderIds)
    ) as unknown as Partial<FavoriteLedgerStatus> & AssistantAutomationResult

    if (statusGeneration !== favoriteLedgerStatusGenerationRef.current) {
      return {
        ok: false,
        verified: false,
        ledgers: favoriteLedgersForActiveAccount(accountMid),
        missingLedgerIds: [],
        unboundLedgerIds: [],
        backupConflictLedgerIds: [],
        message: '收藏夹状态已更新，请重新核验。'
      }
    }

    if (Array.isArray(status.ledgers) && Array.isArray(status.missingLedgerIds)) {
      const recoveredLedgers = status.ledgers ?? ledgersWithRepositoryCandidates
      const missingLedgerIds = status.missingLedgerIds
      const recoveredStatus: FavoriteLedgerStatus = {
        ok: missingLedgerIds.length === 0 && !(status.unboundLedgerIds?.length),
        verified: true,
        ledgers: recoveredLedgers,
        missingLedgerIds,
        backupConflictLedgerIds: status.backupConflictLedgerIds ?? [],
        unboundLedgerIds: status.unboundLedgerIds ?? [],
        unboundCandidates: status.unboundCandidates ?? [],
        remoteOnlyDraftLedgerIds: status.remoteOnlyDraftLedgerIds ?? [],
        message: status.message
      }
      assistantSnapshotCacheRef.current.favoriteLedgerStatus = recoveredStatus
      const bindingsChanged = JSON.stringify(recoveredLedgers) !== JSON.stringify(favoriteLedgers)
      const nextPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, recoveredLedgers)
      })
      preferencesRef.current = nextPreferences
      setPreferences(nextPreferences)

      if (bindingsChanged && window.bilimiDesktop?.savePreferences) {
        const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
        const savedPreferences = createInitialAssistantPreferences(saved)
        preferencesRef.current = savedPreferences
        setPreferences(savedPreferences)
      }

      favoriteLedgerStatusCacheRef.current = {
        accountMid,
        ledgerSignature: JSON.stringify(recoveredLedgers.map((ledger) => ({
          id: ledger.id,
          displayName: ledger.displayName,
          enabled: ledger.enabled,
          syncState: ledger.syncState,
          bindingState: ledger.bindingState,
          bilibiliFolderId: ledger.bilibiliFolderId
        }))),
        checkedAt: Date.now(),
        status: recoveredStatus
      }

      return recoveredStatus
    }

    const fallbackStatus = {
      ok: false,
      verified: false,
      ledgers: favoriteLedgers,
      missingLedgerIds: [],
      message: status.message
    }
    assistantSnapshotCacheRef.current.favoriteLedgerStatus = fallbackStatus
    favoriteLedgerStatusCacheRef.current = {
      accountMid,
      ledgerSignature,
      checkedAt: Date.now(),
      status: fallbackStatus
    }
    return fallbackStatus
  }

  async function preflightFavoriteLedgerStatus(accountMid: string): Promise<FavoriteLedgerStatus> {
    const existing = favoriteLedgerPreflightPromisesRef.current.get(accountMid)
    if (existing) return existing

    const pending = readFavoriteLedgerStatus(accountMid, { force: true }).catch(() => ({
      ok: false,
      verified: false,
      ledgers: favoriteLedgersForActiveAccount(accountMid),
      missingLedgerIds: [],
      unboundLedgerIds: [],
      backupConflictLedgerIds: [],
      message: '收藏夹状态核验失败，本次不执行 B 站收藏写入。'
    } satisfies FavoriteLedgerStatus)).finally(() => {
      favoriteLedgerPreflightPromisesRef.current.delete(accountMid)
    })
    favoriteLedgerPreflightPromisesRef.current.set(accountMid, pending)
    return pending
  }

  async function ensureFavoriteLedgersForAccount(accountMid: string): Promise<AssistantAutomationResult> {
    const favoriteLedgers = accountMid
      ? effectiveFavoriteLedgersForAccount(preferencesRef.current, accountMid)
      : favoriteLedgersForActiveAccount(accountMid)
    const { ledgers: ledgersWithFormalBindings, trustedRemoteShardNumbers } = await projectFavoriteLedgersToFormalBindings(
      accountMid,
      favoriteLedgers
    )
    const [dismissedRemoteDraftReminderIds, pendingRemoteDraftRediscoveryIds] = await Promise.all([
      window.bilimiDesktop?.getFavoriteLedgerRemoteDraftReminderDismissals?.(accountMid).catch(() => []) ?? [],
      window.bilimiDesktop?.getFavoriteLedgerRemoteDraftRediscoveryPending?.(accountMid).catch(() => []) ?? []
    ])
    const suppressedRemoteDraftFolderIds = [...new Set([
      ...dismissedRemoteDraftReminderIds,
      ...pendingRemoteDraftRediscoveryIds
    ])]

    const result = await runScript(
      buildEnsureFavoriteLedgersScript(ledgersWithFormalBindings, {
        dismissedRemoteFolderIds: suppressedRemoteDraftFolderIds
      })
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      const bindingResult = await registerNewFavoriteLedgerBindings(
        accountMid,
        ledgersWithFormalBindings,
        result.ledgers,
        undefined,
        undefined,
        trustedRemoteShardNumbers
      )
      const persistedLedgers = ledgersAfterBindingRegistration(result.ledgers, bindingResult, ledgersWithFormalBindings)
      if (bindingResult.failures.length) {
        const nextPreferences = createInitialAssistantPreferences({
          ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, persistedLedgers)
        })
        preferencesRef.current = nextPreferences
        setPreferences(nextPreferences)
        if (window.bilimiDesktop?.savePreferences) {
          const savedPreferences = createInitialAssistantPreferences(await window.bilimiDesktop.savePreferences(nextPreferences))
          preferencesRef.current = savedPreferences
          setPreferences(savedPreferences)
        }
        return {
          ...result,
          ok: false,
          ledgers: persistedLedgers,
          unboundLedgerIds: bindingResult.failures.map((failure) => failure.ledgerId),
          unboundCandidates: bindingResult.failures,
          message: '收藏夹已在 B 站创建，但正式绑定未完成，请在备册时重新确认对应收藏夹。'
        }
      }
      const ledgersChanged = JSON.stringify(persistedLedgers) !== JSON.stringify(favoriteLedgers)
      const nextPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, persistedLedgers)
      })

      if (ledgersChanged) {
        const saved = window.bilimiDesktop?.savePreferences
          ? await window.bilimiDesktop.savePreferences(nextPreferences)
          : nextPreferences
        const savedPreferences = createInitialAssistantPreferences(saved)
        preferencesRef.current = savedPreferences
        setPreferences(savedPreferences)
      }

      const favoriteLedgerStatus: FavoriteLedgerStatus = {
        ok: result.ok,
        ledgers: persistedLedgers,
        missingLedgerIds: Array.isArray(result.missingTargets) ? result.missingTargets : [],
        backupConflictLedgerIds: Array.isArray(result.backupConflictLedgerIds)
          ? result.backupConflictLedgerIds
          : [],
        unboundLedgerIds: Array.isArray(result.unboundLedgerIds) ? result.unboundLedgerIds : [],
        unboundCandidates: Array.isArray(result.unboundCandidates) ? result.unboundCandidates : [],
        remoteOnlyDraftLedgerIds: Array.isArray(result.remoteOnlyDraftLedgerIds) ? result.remoteOnlyDraftLedgerIds : [],
        message: result.message
      }
      assistantSnapshotCacheRef.current.favoriteLedgerStatus = favoriteLedgerStatus
      favoriteLedgerStatusCacheRef.current = {
        accountMid,
        ledgerSignature: JSON.stringify(result.ledgers.map((ledger) => ({
          id: ledger.id,
          displayName: ledger.displayName,
          enabled: ledger.enabled,
          syncState: ledger.syncState,
          bindingState: ledger.bindingState,
          bilibiliFolderId: ledger.bilibiliFolderId
        }))),
        checkedAt: Date.now(),
        status: favoriteLedgerStatus
      }
      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
    }

    return result
  }

  async function ensureFavoriteLedgers(): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const accountMid = await readBilibiliAccountMid()
    const accountKey = accountMid || '__active-account__'
    const existing = favoriteLedgerEnsurePromisesRef.current.get(accountKey)
    if (existing) return existing

    const operation = ensureFavoriteLedgersForAccount(accountMid)
    favoriteLedgerEnsurePromisesRef.current.set(accountKey, operation)
    try {
      return await operation
    } finally {
      if (favoriteLedgerEnsurePromisesRef.current.get(accountKey) === operation) {
        favoriteLedgerEnsurePromisesRef.current.delete(accountKey)
      }
    }
  }

  async function ensureFavoriteLedger(
    logicalFolderId: string,
    options?: FavoriteLedgerSaveOptions
  ): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) return loginFailure

    const accountMid = await readBilibiliAccountMid()
    const ledgerId = logicalFolderId.trim().replace(/^bilimi-logical:/, '')
    const currentLedgers = favoriteLedgersForActiveAccount(accountMid)
    const targetLedger = currentLedgers.find((ledger) => ledger.id === ledgerId && ledger.enabled)
    if (!targetLedger) {
      return { ok: false, steps: [], missingTargets: [ledgerId], message: '当前分类未启用，无法备册。' }
    }
    if (targetLedger.isDefault && ledgerId !== 'inbox' && accountMid && preferencesRef.current.favoriteAccountPreferences?.[accountMid]?.defaultFavoriteSystemEnabled === false) {
      return {
        ok: false,
        steps: [],
        missingTargets: [ledgerId],
        message: '默认收藏夹体系已关闭，备册不会创建远端收藏夹。'
      }
    }

    const { ledgers: ledgersWithFormalBindings, trustedRemoteShardNumbers } = await projectFavoriteLedgersToFormalBindings(
      accountMid,
      [targetLedger]
    )
    const result = await runScript(
      buildEnsureFavoriteLedgersScript(ledgersWithFormalBindings, options)
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      const formalLedgerById = new Map(ledgersWithFormalBindings.map((ledger) => [ledger.id, ledger]))
      const resultLedgers = result.ledgers.map((ledger) => {
        const confirmedFolders = options?.rebindRemoteFolders?.[ledger.id] ?? []
        if (!confirmedFolders.length) return ledger
        const formalLedger = formalLedgerById.get(ledger.id)
        const formalFolderIds = [...new Set([
          formalLedger?.bilibiliFolderId,
          ...(formalLedger?.bilibiliFolderIds ?? [])
        ].filter((folderId): folderId is string => Boolean(folderId)))]
        const folderIds = [...new Set([...formalFolderIds, ...confirmedFolders.map((folder) => folder.id)])]
        return {
          ...ledger,
          bilibiliFolderId: folderIds[0],
          bilibiliFolderIds: folderIds,
          bilibiliFolderTitle: formalFolderIds.length
            ? formalLedger?.bilibiliFolderTitle
            : confirmedFolders[0].title,
          bilibiliFolderVideoCount: formalFolderIds.length
            ? formalLedger?.bilibiliFolderVideoCount
            : ledger.bilibiliFolderVideoCount
        }
      })
      const bindingResult = await registerNewFavoriteLedgerBindings(
        accountMid,
        ledgersWithFormalBindings,
        resultLedgers,
        options?.rebindRemoteFolderIds,
        options?.rebindRemoteFolders,
        trustedRemoteShardNumbers
      )
      const persistedLedgers = ledgersAfterBindingRegistration(resultLedgers, bindingResult, ledgersWithFormalBindings)
      if (bindingResult.failures.length) {
        const nextPreferences = createInitialAssistantPreferences({
          ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, persistedLedgers)
        })
        preferencesRef.current = nextPreferences
        setPreferences(nextPreferences)
        if (window.bilimiDesktop?.savePreferences) {
          const savedPreferences = createInitialAssistantPreferences(await window.bilimiDesktop.savePreferences(nextPreferences))
          preferencesRef.current = savedPreferences
          setPreferences(savedPreferences)
        }
        return {
          ...result,
          ok: false,
          ledgers: persistedLedgers,
          unboundLedgerIds: bindingResult.failures.map((failure) => failure.ledgerId),
          unboundCandidates: bindingResult.failures,
          message: '收藏夹已在 B 站创建，但正式绑定未完成，请在备册时重新确认对应收藏夹。'
        }
      }
      const persistedById = new Map(persistedLedgers.map((ledger) => [ledger.id, ledger]))
      const mergedLedgers = currentLedgers.map((ledger) => persistedById.get(ledger.id) ?? ledger)
      if (JSON.stringify(mergedLedgers) !== JSON.stringify(currentLedgers)) {
        const nextPreferences = createInitialAssistantPreferences({
          ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, mergedLedgers)
        })
        const saved = window.bilimiDesktop?.savePreferences
          ? await window.bilimiDesktop.savePreferences(nextPreferences)
          : nextPreferences
        const savedPreferences = createInitialAssistantPreferences(saved)
        preferencesRef.current = savedPreferences
        setPreferences(savedPreferences)
      }
      favoriteLedgerStatusCacheRef.current = undefined
      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
      return { ...result, ledgers: persistedLedgers }
    }

    return result
  }

  async function saveFavoriteLedgers(
    nextLedgers: FavoriteLedger[],
    options?: FavoriteLedgerSaveOptions
  ): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const accountMid = await readBilibiliAccountMid()
    const previousLedgers = favoriteLedgersForActiveAccount(accountMid)
    const backupTargetLedgerIdSet = new Set(options?.backupTargetLedgerIds ?? [])
    const remoteOperationLedgers = backupTargetLedgerIdSet.size
      ? nextLedgers.filter((ledger) => backupTargetLedgerIdSet.has(ledger.id))
      : nextLedgers
    const dismissedRemoteFolderIds = await window.bilimiDesktop?.getFavoriteLedgerRemoteDraftReminderDismissals?.(accountMid)
      .catch(() => []) ?? []
    const { ledgers: ledgersWithFormalBindings, trustedRemoteShardNumbers } = await projectFavoriteLedgersToFormalBindings(
      accountMid,
      remoteOperationLedgers
    )

    const result = await runScript(
      buildSaveFavoriteLedgersScript(ledgersWithFormalBindings, previousLedgers, {
        ...options,
        dismissedRemoteFolderIds
      })
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>
    const observedRemoteOnlyDrafts = Array.isArray(result.remoteOnlyDraftLedgerIds) && result.remoteOnlyDraftLedgerIds.length > 0
    const releaseObservedRemoteDraftRediscovery = async () => {
      if (!options?.rediscoverDeletedRemoteDrafts || !(result.ok === true || observedRemoteOnlyDrafts)) return
      await window.bilimiDesktop?.consumeFavoriteLedgerRemoteDraftRediscoveryPending?.(accountMid)
      favoriteLedgerStatusCacheRef.current = null
      await readFavoriteLedgerStatus(accountMid, { force: true })
    }

    if (Array.isArray(result.ledgers)) {
      const formalLedgerById = new Map(ledgersWithFormalBindings.map((ledger) => [ledger.id, ledger]))
      const resultLedgers = result.ledgers.map((ledger) => {
        const confirmedFolders = options?.rebindRemoteFolders?.[ledger.id] ?? []
        if (!confirmedFolders.length) return ledger
        const formalLedger = formalLedgerById.get(ledger.id)
        const formalFolderIds = [...new Set([
          formalLedger?.bilibiliFolderId,
          ...(formalLedger?.bilibiliFolderIds ?? [])
        ].filter((folderId): folderId is string => Boolean(folderId)))]
        const folderIds = [...new Set([...formalFolderIds, ...confirmedFolders.map((folder) => folder.id)])]
        return {
          ...ledger,
          bilibiliFolderId: folderIds[0],
          bilibiliFolderIds: folderIds,
          bilibiliFolderTitle: formalFolderIds.length
            ? formalLedger?.bilibiliFolderTitle
            : confirmedFolders[0].title,
          bilibiliFolderVideoCount: formalFolderIds.length
            ? formalLedger?.bilibiliFolderVideoCount
            : ledger.bilibiliFolderVideoCount
        }
      })
      const bindingResult = await registerNewFavoriteLedgerBindings(
        accountMid,
        ledgersWithFormalBindings,
        resultLedgers,
        options?.rebindRemoteFolderIds,
        options?.rebindRemoteFolders,
        trustedRemoteShardNumbers
      )
      const backupLedgers = ledgersAfterBindingRegistration(resultLedgers, bindingResult, ledgersWithFormalBindings)
      const persistedLedgers = options?.rediscoverDeletedRemoteDrafts || backupTargetLedgerIdSet.size
        ? mergeBackupResultIntoLocalLedgers(previousLedgers, backupLedgers)
        : backupLedgers
      if (bindingResult.failures.length) {
        const nextPreferences = createInitialAssistantPreferences({
          ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, persistedLedgers)
        })
        preferencesRef.current = nextPreferences
        setPreferences(nextPreferences)
        if (window.bilimiDesktop?.savePreferences) {
          const savedPreferences = createInitialAssistantPreferences(
            await window.bilimiDesktop.savePreferences(nextPreferences)
          )
          preferencesRef.current = savedPreferences
          setPreferences(savedPreferences)
        }
        await releaseObservedRemoteDraftRediscovery()
        window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
        return {
          ...result,
          ok: false,
          ledgers: persistedLedgers,
          unboundLedgerIds: bindingResult.failures.map((failure) => failure.ledgerId),
          unboundCandidates: bindingResult.failures,
          message: '收藏夹规则已保存，但正式绑定未完成，请重新确认远端收藏夹。'
        }
      }
      const nextPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferencesRef.current, accountMid, persistedLedgers)
      })
      preferencesRef.current = nextPreferences
      setPreferences(nextPreferences)

      if (window.bilimiDesktop?.savePreferences) {
        const savedPreferences = createInitialAssistantPreferences(
          await window.bilimiDesktop.savePreferences(nextPreferences)
        )
        preferencesRef.current = savedPreferences
        setPreferences(savedPreferences)
      }

      // A completed inventory can rediscover a locally removed remote-only
      // draft even if another selected ledger then fails to create or register.
      // Release only after that observation; a failure before the inventory
      // leaves the temporary suppression intact for the next explicit backup.
      await releaseObservedRemoteDraftRediscovery()
      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
      return { ...result, ledgers: persistedLedgers }
    }

    return Array.isArray(result.ledgers) && options?.rebindRemoteFolders
      ? { ...result, ledgers: result.ledgers.map((ledger) => {
        const confirmedFolders = options.rebindRemoteFolders?.[ledger.id] ?? []
        return confirmedFolders.length
          ? { ...ledger, bilibiliFolderId: confirmedFolders[0].id, bilibiliFolderIds: confirmedFolders.map((folder) => folder.id), bilibiliFolderTitle: confirmedFolders[0].title }
          : ledger
      }) }
      : result
  }

  async function openBilibiliFavorites(): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览框台尚未备妥，无法打开 B 站收藏夹。'
      }
    }

    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    try {
      const rawMid = await currentActiveWebview.executeJavaScript(
        `(() => {
          const match = String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=([^;]+)/)
          return match ? decodeURIComponent(match[1]) : ''
        })()`,
        true
      )
      const mid = String(rawMid ?? '').trim()

      if (!/^\d+$/.test(mid)) {
        return {
          ok: false,
          steps: ['favorite-page:read-user'],
          missingTargets: ['bilibili-user'],
          message: '未能读取 B 站用户 ID，无法打开收藏夹。'
        }
      }

      const favoriteUrl = `https://space.bilibili.com/${mid}/favlist`

      openInternalTab(favoriteUrl)

      return {
        ok: true,
        steps: ['favorite-page:read-user', 'favorite-page:open'],
        missingTargets: [],
        message: '已打开 B 站收藏夹。'
      }
    } catch (error) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['favorite-page'],
        message: `打开 B 站收藏夹未完成：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  async function runVisualFallback(
    context: Parameters<typeof runVisualFavoriteFallback>[1],
    options?: Parameters<typeof runVisualFavoriteFallback>[2]
  ): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览框台尚未备妥。'
      }
    }

    return runVisualFavoriteFallback(currentActiveWebview, context, options)
  }

  async function runTrustedDanmakuSubmitFallback(
    commentDraft: string
  ): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.sendInputEvent || !currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-input'],
        message: '浏览框尚未准备好真实键盘输入。'
      }
    }

    const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay))
    currentActiveWebview.focus?.()

    const sendKey = (
      keyCode: string,
      modifiers?: Electron.KeyboardInputEvent['modifiers']
    ) => {
      const keyDown: Electron.KeyboardInputEvent = modifiers
        ? { keyCode, modifiers, type: 'keyDown' }
        : { keyCode, type: 'keyDown' }
      const keyUp: Electron.KeyboardInputEvent = modifiers
        ? { keyCode, modifiers, type: 'keyUp' }
        : { keyCode, type: 'keyUp' }
      currentActiveWebview.sendInputEvent?.(keyDown)
      currentActiveWebview.sendInputEvent?.(keyUp)
    }

    const clickAt = (point: { x: number; y: number }) => {
      currentActiveWebview.sendInputEvent?.({ type: 'mouseMove', x: point.x, y: point.y })
      currentActiveWebview.sendInputEvent?.({
        button: 'left',
        clickCount: 1,
        type: 'mouseDown',
        x: point.x,
        y: point.y
      })
      currentActiveWebview.sendInputEvent?.({
        button: 'left',
        clickCount: 1,
        type: 'mouseUp',
        x: point.x,
        y: point.y
      })
    }

    const writeDanmakuDraftToClipboard = async () => {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(commentDraft)
          return true
        } catch {
          // Electron's Web Clipboard API can reject when the window is not focused.
        }
      }

      if (window.bilimiDesktop?.writeClipboardText) {
        try {
          await window.bilimiDesktop.writeClipboardText(commentDraft)
          return true
        } catch {
          return false
        }
      }

      return false
    }

    if (!(await writeDanmakuDraftToClipboard())) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-clipboard'],
        message: '弹幕文案写入剪贴板失败，请重新点击表再试。'
      }
    }

    const activationSteps: string[] = []
    let playbackPausedBeforeActivation: boolean | null = null
    try {
      const activation = (await currentActiveWebview.executeJavaScript(
        buildTrustedPlayerActivationScript(),
        true
      )) as TrustedPlayerActivationResult

      if (activation?.ok && activation.clickPoint) {
        playbackPausedBeforeActivation = activation.paused ?? null
        activationSteps.push(...activation.steps, 'player:activate-click')
        clickAt(activation.clickPoint)
        await wait(120)

        const playbackRestore = (await currentActiveWebview.executeJavaScript(
          buildRestorePlayerPlaybackStateScript(activation.paused),
          true
        )) as AssistantAutomationResult
        activationSteps.push(...(playbackRestore?.steps ?? []))
      }
    } catch {
      activationSteps.push('player:activate:skipped')
    }

    currentActiveWebview.focus?.()
    sendKey('Enter')
    activationSteps.push('danmaku:trusted-enter-open')
    await wait(160)

    currentActiveWebview.focus?.()
    sendKey('v', ['control'])
    const pasteSteps = ['danmaku:trusted-paste']
    await wait(120)

    const submitSteps = ['danmaku:trusted-enter']
    sendKey('Enter')
    await wait(120)
    if (playbackPausedBeforeActivation !== null) {
      try {
        const playbackRestore = (await currentActiveWebview.executeJavaScript(
          buildRestorePlayerPlaybackStateScript(playbackPausedBeforeActivation),
          true
        )) as AssistantAutomationResult
        submitSteps.push(...(playbackRestore?.steps ?? []))
      } catch {
        submitSteps.push('player:playback:restore-after-submit-skipped')
      }
    }

    return {
      ok: true,
      steps: [...activationSteps, ...pasteSteps, ...submitSteps],
      missingTargets: [],
      message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
    }
  }

  async function saveVideoNote(note: VideoNote): Promise<void> {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  function createAssistantSnapshot(
    favoriteLedgerStatus = assistantSnapshotCacheRef.current.favoriteLedgerStatus
  ): AssistantSnapshot {
    const activeTabSnapshot = getActiveTabSnapshot()
    const activeTabVideoTitle = normalizeActiveTabVideoTitle(activeTabSnapshot)
    const cachedContext = assistantSnapshotCacheRef.current.videoContextUrl === activeTabSnapshot?.url
      ? assistantSnapshotCacheRef.current.videoContentContext
      : {}
    const videoContentContext = activeTabVideoTitle
      ? { ...cachedContext, title: activeTabVideoTitle }
      : cachedContext

    return {
      accountMid: assistantSnapshotCacheRef.current.accountMid,
      preferences: preferencesRef.current,
      favoriteLedgerStatus,
      videoContentContext,
      activeTabUrl: activeTabSnapshot?.url,
      runtimeFeedback: assistantRuntimeFeedbackRef.current?.message,
      runtimeFeedbackId: assistantRuntimeFeedbackRef.current?.id,
      videoTitle:
        activeTabVideoTitle ??
        videoContentContext.title ??
        '等待视频加载'
    }
  }

  function ledgerNames(ledgerIds: string[]): string {
    return ledgerIds
      .map((ledgerId) => ledgerDisplayName(preferences.favoriteLedgers, ledgerId))
      .join('、')
  }

  function publishRuntimeFeedback(message: string) {
    assistantRuntimeFeedbackRef.current = {
      id: (assistantRuntimeFeedbackRef.current?.id ?? 0) + 1,
      message
    }
    window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
  }

  async function runAssistantRuntimeAction(
    action: AssistantAction,
    options?: {
      coinCount?: 1 | 2
      commentDraft?: string
      submitComment?: boolean
      pageClickOnly?: boolean
      confirmNewFavoriteShards?: boolean
    }
  ): Promise<AssistantAutomationResult> {
    const actionTabSnapshot = getActiveTabSnapshot()
    if (!isBilibiliVideoUrl(actionTabSnapshot?.url)) {
      return NO_CURRENT_VIDEO_RESULT
    }

    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const actionAccountMid = assistantSnapshotCacheRef.current.accountMid || await readBilibiliAccountMid()
    let actionFavoriteLedgers = actionAccountMid
      ? effectiveFavoriteLedgersForAccount(preferences, actionAccountMid)
      : preferences.favoriteLedgers
    let favoriteLedgerStatus = assistantSnapshotCacheRef.current.favoriteLedgerStatus
    const videoContentContext = await readVideoContentContext()
    const archiveTargets = planFavoriteArchiveTargets({
      context: videoContentContext,
      ledgers: actionFavoriteLedgers,
      multiArchiveMode: preferences.favoriteArchiveMultiMode
    })
    const localClassification = classifyVideoContent(videoContentContext, actionFavoriteLedgers)
    const localTargetLedgerId =
      archiveTargets[0]?.ledgerId ??
      localClassification.ledgerId
    const localTargetLedgerIds =
      archiveTargets.length > 0
        ? archiveTargets.map((target) => target.ledgerId)
        : [localTargetLedgerId]
    const localDiagnostics = diagnosticsForTargets(archiveTargets, localClassification.diagnostic)
    const localClassificationSource = localClassification.diagnostic?.confidence === 'high'
      ? 'system-high' as const
      : 'system-low' as const
    let targetLedgerId = localTargetLedgerId
    let targetLedgerIds = localTargetLedgerIds
    let resultMessagePrefix: string | undefined
    let preActionCorrectionTargets: string[] | undefined
    let deepSeekCorrection: DailyDeepSeekCorrection | undefined
    let postActionDailyReviewPromise: Promise<DailyClassificationReviewResult | undefined> | undefined
    const areFavoriteTargetsWriteAuthorized = (ledgerIds: string[]) =>
      ledgerIds.every((ledgerId) =>
        actionFavoriteLedgers.some(
          (ledger) => ledger.id === ledgerId && isFavoriteLedgerRemoteWritable(ledger)
        )
      )
    const isFavoriteWriteProvisioned = (
      status: FavoriteLedgerStatus | null | undefined,
      ledgerIds: string[]
    ) => {
      if (!status || status.verified === false || ledgerIds.length === 0) return false
      const unavailableLedgerIds = new Set([
        ...status.missingLedgerIds,
        ...(status.backupConflictLedgerIds ?? []),
        ...(status.unboundLedgerIds ?? [])
      ])
      return !ledgerIds.some((ledgerId) => unavailableLedgerIds.has(ledgerId)) &&
        areFavoriteTargetsWriteAuthorized(ledgerIds)
    }
    const hasMatchingLocalDraftTarget = () =>
      actionFavoriteLedgers
        .filter((ledger) => ledger.enabled && ledger.syncState === 'local-draft')
        .some((localDraftLedger) =>
          classifyVideoContent(
            videoContentContext,
            actionFavoriteLedgers.map((ledger) =>
              ledger.id === localDraftLedger.id
                ? { ...ledger, syncState: undefined }
                : ledger
            )
          ).ledgerId === localDraftLedger.id
        )
    const dailyDeepSeekReviewRequested =
      actionUsesFavorite(action) &&
      preferences.deepseekEnabled &&
      preferences.deepseekApiKeyStored &&
      preferences.deepseekDailyClassificationEnabled &&
      Boolean(window.bilimiDesktop?.generateDeepSeek) &&
      shouldReviewDailyClassification(preferences.deepseekDailyClassificationMode, localDiagnostics)
    let dailyDeepSeekReviewAllowed = false
    if (dailyDeepSeekReviewRequested) {
      favoriteLedgerStatus = actionAccountMid
        ? await preflightFavoriteLedgerStatus(actionAccountMid)
        : null
      if (actionAccountMid) {
        actionFavoriteLedgers = effectiveFavoriteLedgersForAccount(preferencesRef.current, actionAccountMid)
      }
      dailyDeepSeekReviewAllowed = isFavoriteWriteProvisioned(
        favoriteLedgerStatus,
        localTargetLedgerIds
      ) && !hasMatchingLocalDraftTarget()
    }

    if (dailyDeepSeekReviewRequested && dailyDeepSeekReviewAllowed) {
      const reviewRequest: DeepSeekGenerateRequest = {
        kind: 'favorite-daily-classify-review',
        video: videoContentContext,
        localClassification: {
          targetLedgerIds: localTargetLedgerIds,
          primaryLedgerId: localTargetLedgerId,
          displayNames: localTargetLedgerIds.map((ledgerId) =>
            ledgerDisplayName(actionFavoriteLedgers, ledgerId)
          ),
          reason: localClassification.matchedKeywords.length
            ? `本地命中：${localClassification.matchedKeywords.join('、')}`
            : undefined,
          diagnostics: localDiagnostics
        },
        ledgers: actionFavoriteLedgers.map((ledger) => {
          const parsedRules = parseFavoriteLedgerRules(ledger)
          return {
            id: ledger.id,
            displayName: ledger.displayName,
            keywords: parsedRules.localKeywords,
            deepSeekConstraint: parsedRules.deepSeekConstraint,
            ruleType: ledger.ruleType,
            enabled: ledger.enabled
          }
        })
      }
      const finishDeepSeekTask = publishDeepSeekTask({
        id: `classification:${videoContentContext.bvid ?? videoContentContext.aid ?? 'video'}:${Date.now()}:${Math.random()}`,
        kind: 'classification',
        detail: `分类二判：${videoContentContext.title || '当前视频'}`
      })
      const reviewPromise = window.bilimiDesktop
        .generateDeepSeek(reviewRequest)
        .then((reviewResult): DailyClassificationReviewResult | undefined =>
          reviewResult?.kind === 'favorite-daily-classify-review' ? reviewResult : undefined
        )
        .catch(() => undefined)
        .finally(finishDeepSeekTask)
      const reviewBeforeAction = await waitForDailyReviewBeforeAction(reviewPromise)

      if (reviewBeforeAction.status === 'pending') {
        postActionDailyReviewPromise = reviewPromise
      } else {
        const correction = dailyCorrectionFromReview({
          favoriteLedgers: actionFavoriteLedgers,
          localTargetLedgerId,
          localTargetLedgerIds,
          reviewResult: reviewBeforeAction.result
        })

        if (correction) {
          targetLedgerIds = correction.targetLedgerIds
          targetLedgerId = correction.targetLedgerIds[0]
          preActionCorrectionTargets = correction.targetLedgerIds
          deepSeekCorrection = correction
        } else {
          resultMessagePrefix = dailyReviewFeedback({
            favoriteLedgers: actionFavoriteLedgers,
            localTargetLedgerIds,
            reviewResult: reviewBeforeAction.result
          })
          if (reviewBeforeAction.result && !reviewBeforeAction.result.invalid) {
            const localNames = ledgerNames(localTargetLedgerIds)
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'happy',
              message: `主人，DeepSeek复核过啦～与原建议一致，存入「${localNames}」。`
            })
          }
        }
      }
    }
    if (actionUsesFavorite(action) && !dailyDeepSeekReviewRequested) {
      favoriteLedgerStatus = actionAccountMid
        ? await preflightFavoriteLedgerStatus(actionAccountMid)
        : null
      if (actionAccountMid) {
        actionFavoriteLedgers = effectiveFavoriteLedgersForAccount(preferencesRef.current, actionAccountMid)
      }
    }
    const pendingTargetLedger = actionUsesFavorite(action)
      ? targetLedgerIds
        .map((ledgerId) => actionFavoriteLedgers.find((ledger) => ledger.id === ledgerId))
        .find((ledger): ledger is FavoriteLedger => Boolean(ledger?.pendingRemoteBinding && (ledger.pendingRemoteFolderId ?? ledger.bilibiliFolderId)?.trim()))
      : undefined
    if (pendingTargetLedger && actionAccountMid) {
      const remoteFolderId = (pendingTargetLedger.pendingRemoteFolderId ?? pendingTargetLedger.bilibiliFolderId)!.trim()
      const remoteTitle = pendingTargetLedger.pendingRemoteFolderTitle || pendingTargetLedger.displayName
      try {
        if (!window.bilimiDesktop?.adoptFavoriteRepositoryLedgerBinding) {
          throw new Error('收藏库绑定服务不可用')
        }
        await window.bilimiDesktop.adoptFavoriteRepositoryLedgerBinding(actionAccountMid, {
          logicalLedgerId: pendingTargetLedger.id,
          logicalTitle: pendingTargetLedger.displayName,
          remoteFolderId,
          remoteTitle,
          shardNumber: Math.max(1, (pendingTargetLedger.bilibiliFolderIds ?? []).length)
        })
      } catch (error) {
        return {
          ok: false,
          steps: ['favorite:shard-binding-retry'],
          missingTargets: [`favorite-shard-binding:${pendingTargetLedger.id}`],
          message: `已创建的「${remoteTitle}」暂未完成正式绑定，本次不会重复创建或写入视频；请稍后重试。${error instanceof Error && error.message ? `原因：${error.message}` : ''}`
        }
      }
      const clearedPendingLedgers = actionFavoriteLedgers.map((ledger) =>
        ledger.id === pendingTargetLedger.id
          ? { ...ledger, pendingRemoteBinding: false, pendingRemoteFolderId: undefined, pendingRemoteFolderTitle: undefined }
          : ledger
      )
      const clearedPendingPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferencesRef.current, actionAccountMid, clearedPendingLedgers)
      })
      const savedClearedPendingPreferences = window.bilimiDesktop?.savePreferences
        ? createInitialAssistantPreferences(await window.bilimiDesktop.savePreferences(clearedPendingPreferences))
        : clearedPendingPreferences
      preferencesRef.current = savedClearedPendingPreferences
      setPreferences(savedClearedPendingPreferences)
      favoriteLedgerStatusCacheRef.current = null
      favoriteLedgerStatus = await preflightFavoriteLedgerStatus(actionAccountMid)
      actionFavoriteLedgers = effectiveFavoriteLedgersForAccount(preferencesRef.current, actionAccountMid)
    }
    const writeTargetPlan = actionUsesFavorite(action) && !preActionCorrectionTargets
      ? planFavoriteReviewWriteTargets({
          context: videoContentContext,
          ledgers: actionFavoriteLedgers,
          multiArchiveMode: preferences.favoriteArchiveMultiMode
        })
      : undefined
    const writeFallbackFeedback = writeTargetPlan && writeTargetPlan.writeLedgerIds.length > 0
      ? reviewWriteFallbackFeedback({
          ledgers: actionFavoriteLedgers,
          suggestedLedgerIds: writeTargetPlan.suggestedLedgerIds,
          writeLedgerIds: writeTargetPlan.writeLedgerIds
        })
      : undefined
    if (writeTargetPlan?.writeLedgerIds.length) {
      targetLedgerIds = writeTargetPlan.writeLedgerIds
      targetLedgerId = writeTargetPlan.writeLedgerIds[0]!
      if (writeFallbackFeedback) {
        resultMessagePrefix = [resultMessagePrefix, writeFallbackFeedback].filter(Boolean).join('\n')
      }
    }
    const feedbackTargetLedgerId = writeFallbackFeedback
      ? localTargetLedgerId
      : targetLedgerId
    const favoriteProvisioned = isFavoriteWriteProvisioned(favoriteLedgerStatus, targetLedgerIds)
    if (actionUsesFavorite(action) && favoriteProvisioned) {
      const capacity = await runScript(
        buildFavoriteLedgerWriteCapacityScript(actionFavoriteLedgers, targetLedgerIds)
      ) as AssistantAutomationResult & { fullLedgerIds?: string[] }
      const fullLedgerIds = capacity.fullLedgerIds ?? []
      const missingBoundLedgerIds = (capacity.missingTargets ?? []).filter(
        (target) => !target.startsWith('favorite-shard-confirmation:')
      )
      if (!capacity.ok && missingBoundLedgerIds.length > 0) {
        return {
          ok: false,
          steps: capacity.steps ?? [],
          missingTargets: missingBoundLedgerIds,
          message: capacity.message || '当前收藏夹的正式绑定分区不可用，请先备册或重新绑定后再批阅。'
        }
      }
      if (fullLedgerIds.length && !options?.confirmNewFavoriteShards) {
        const fullNames = fullLedgerIds.map((ledgerId) => ledgerDisplayName(actionFavoriteLedgers, ledgerId))
        return {
          ok: false,
          steps: capacity.steps ?? [],
          missingTargets: fullLedgerIds.map((ledgerId) => `favorite-shard-confirmation:${ledgerId}`),
          message: `「${fullNames.join('、')}」的 B 站收藏夹分区已满。确认后会备册新的分区并建立绑定，再继续本次批阅。`
        }
      }
      if (fullLedgerIds.length) {
        const createdByLedgerId = new Map<string, { id: string; title: string; shardNumber: number }>()
        for (const ledgerId of fullLedgerIds) {
          const ledger = actionFavoriteLedgers.find((candidate) => candidate.id === ledgerId)
          if (!ledger) continue
          const pendingKey = `${actionAccountMid}:${ledgerId}`
          const pendingFolder = pendingFavoriteShardBindingsRef.current.get(pendingKey)?.folder
          const creation = pendingFolder
            ? { ok: true, steps: ['favorite:shard-binding-retry'], missingTargets: [], existingFolder: pendingFolder }
            : await runScript(
                buildCreateFavoriteLedgerPhysicalShardScript(ledger)
              ) as AssistantAutomationResult & {
                folder?: { id: string; title: string; shardNumber: number }
                existingFolder?: { id: string; title: string; shardNumber: number }
              }
          const folder = creation.folder ?? creation.existingFolder
          if (!creation.ok || !folder?.id || !window.bilimiDesktop?.adoptFavoriteRepositoryLedgerBinding) {
            return {
              ok: false,
              steps: [...(capacity.steps ?? []), ...(creation.steps ?? [])],
              missingTargets: creation.missingTargets?.length ? creation.missingTargets : [`favorite-shard-binding:${ledgerId}`],
              message: creation.message || '新的 B 站收藏夹分区未能完成正式绑定，本次批阅没有写入收藏夹。'
            }
          }
          try {
            await window.bilimiDesktop.adoptFavoriteRepositoryLedgerBinding(actionAccountMid, {
              logicalLedgerId: ledger.id,
              logicalTitle: ledger.displayName,
              remoteFolderId: folder.id,
              remoteTitle: folder.title,
              shardNumber: folder.shardNumber
            })
          } catch (error) {
            pendingFavoriteShardBindingsRef.current.set(pendingKey, { folder })
            const pendingLedgers = actionFavoriteLedgers.map((candidate) => candidate.id === ledgerId
              ? {
                  ...candidate,
                  pendingRemoteFolderId: folder.id,
                  pendingRemoteFolderTitle: folder.title,
                  pendingRemoteBinding: true,
                  bindingState: candidate.bindingState ?? 'bound' as const
                }
              : candidate)
            const pendingPreferences = createInitialAssistantPreferences({
              ...preferencesWithFavoriteLedgers(preferencesRef.current, actionAccountMid, pendingLedgers)
            })
            const savedPendingPreferences = window.bilimiDesktop?.savePreferences
              ? createInitialAssistantPreferences(await window.bilimiDesktop.savePreferences(pendingPreferences))
              : pendingPreferences
            preferencesRef.current = savedPendingPreferences
            setPreferences(savedPendingPreferences)
            favoriteLedgerStatusCacheRef.current = null
            return {
              ok: false,
              steps: [...(capacity.steps ?? []), ...(creation.steps ?? [])],
              missingTargets: [`favorite-shard-binding:${ledgerId}`],
              message: `新的 B 站收藏夹分区已创建，但正式绑定暂未完成；已记住该分区，下次会只重试绑定，不会重复创建。本次批阅没有写入收藏夹。${error instanceof Error && error.message ? `原因：${error.message}` : ''}`
            }
          }
          createdByLedgerId.set(ledgerId, folder)
          pendingFavoriteShardBindingsRef.current.delete(pendingKey)
        }
        if (createdByLedgerId.size) {
          actionFavoriteLedgers = actionFavoriteLedgers.map((ledger) => {
            const folder = createdByLedgerId.get(ledger.id)
            if (!folder) return ledger
            const bilibiliFolderIds = Array.from(new Set([
              ...(ledger.bilibiliFolderIds ?? []),
              ...(ledger.bilibiliFolderId ? [ledger.bilibiliFolderId] : []),
              folder.id
            ]))
            return { ...ledger, bilibiliFolderId: bilibiliFolderIds[0], bilibiliFolderIds, pendingRemoteBinding: false, bindingState: 'bound' as const }
          })
          const nextPreferences = createInitialAssistantPreferences({
            ...preferencesWithFavoriteLedgers(preferencesRef.current, actionAccountMid, actionFavoriteLedgers)
          })
          const savedPreferences = window.bilimiDesktop?.savePreferences
            ? createInitialAssistantPreferences(await window.bilimiDesktop.savePreferences(nextPreferences))
            : nextPreferences
          preferencesRef.current = savedPreferences
          setPreferences(savedPreferences)
          favoriteLedgerStatusCacheRef.current = null
          window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
        }
      }
    }
    const commentDraft =
      action === '表' &&
      (options?.submitComment ?? preferences.commentSubmitMode === 'random') &&
      !options?.commentDraft?.trim()
        ? pickRandomCommentDraft(
            composeMemorialComments(
              targetLedgerId,
              normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ??
                videoContentContext.title ??
                '等待视频加载',
              videoContentContext.author
            )
          )
        : options?.commentDraft
    const currentTabSnapshot = getActiveTabSnapshot()
    if (
      currentTabSnapshot?.id !== actionTabSnapshot?.id ||
      readBilibiliVideoKey(currentTabSnapshot?.url ?? '') !==
        readBilibiliVideoKey(actionTabSnapshot?.url ?? '')
    ) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['active-video-changed'],
        message: '页面已切换，本次操作未执行。'
      }
    }
    let result: AssistantAutomationResult
    suppressPageInteractionHintsUntilRef.current = Number.POSITIVE_INFINITY
    try {
      result = await executeAssistantAction({
        action,
        favoritesFolderName: preferences.favoritesFolderName,
        runScript,
        runVisualFallback,
        runTrustedDanmakuSubmitFallback,
        favoriteApiFallbackEnabled: options?.pageClickOnly !== true,
        coinCount: options?.coinCount ?? (action === '赐' ? preferences.defaultCoinCount : undefined),
        commentDraft,
        submitComment:
          options?.submitComment ??
          (action === '表' ? preferences.commentSubmitMode === 'random' : undefined),
        favoriteLedgers: actionFavoriteLedgers,
        targetLedgerId,
        targetLedgerIds,
        favoriteProvisioned,
        resultMessagePrefix
      })
    } finally {
      suppressPageInteractionHintsUntilRef.current = Date.now() + AUTOMATED_PAGE_HINT_COOLDOWN_MS
    }

    if (preActionCorrectionTargets) {
      resultMessagePrefix = result.ok
        ? `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${ledgerNames(preActionCorrectionTargets)}」，已按二判结果执行。`
        : `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${ledgerNames(preActionCorrectionTargets)}」，但本次操作未完成。`
    }
    if (resultMessagePrefix?.startsWith('DeepSeek 二判')) {
      result = withResultMessagePrefix(result, resultMessagePrefix)
      publishRuntimeFeedback(resultMessagePrefix)
    }

    if (result.ok && actionUsesFavorite(action) && favoriteProvisioned) {
      const occurredAt = new Date().toISOString()
      const operationId = `review-favorite:${actionAccountMid || 'unknown'}:${videoContentContext.aid ?? 'unknown'}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
      const confirmedReviewInput = createConfirmedReviewFavoriteInput({
        accountMid: actionAccountMid,
        video: videoContentContext,
        targetLedgerIds,
        favoriteLedgers: actionFavoriteLedgers,
        result,
        occurredAt,
        operationId,
        classificationSource: localClassificationSource
      })

      if (confirmedReviewInput) {
        try {
          if (!window.bilimiDesktop?.checkpointConfirmedFavoriteReview) {
            throw new Error('收藏库恢复检查点接口不可用')
          }
          if (!window.bilimiDesktop?.commitConfirmedFavoriteReview) {
            throw new Error('收藏库写入接口不可用')
          }
          await window.bilimiDesktop.checkpointConfirmedFavoriteReview(actionAccountMid, confirmedReviewInput)
          await window.bilimiDesktop.commitConfirmedFavoriteReview(actionAccountMid, confirmedReviewInput)
        } catch (error) {
          // Bilibili has already confirmed this action. Do not replace that
          // result with a third, misleading synchronization state; account
          // open will retry the durable local projection by operation id.
          console.error('Confirmed review favorite local registration failed.', error)
        }
      }
    }

    if (result.ok && action !== '阅') {
      if (favoriteProvisioned && targetLedgerId === 'inbox' && action === '藏') {
        const queueItem = pendingQueueItemFromCurrentVideo(videoContentContext, feedbackTargetLedgerId)

        if (queueItem) {
          await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.([queueItem])
        }
      }

      const applyDailyCorrectionLearning = (
        basePreferences: AssistantPreferences,
        correction: DailyDeepSeekCorrection | undefined
      ) => {
        if (
          !correction ||
          !preferences.favoriteCorrectionLearningEnabled ||
          !Number.isFinite(Number(videoContentContext.aid))
        ) {
          return basePreferences
        }

        const diagnostic = localDiagnostics.find(
          (candidate) => candidate.ledgerId === correction.originalLedgerId
        )

        return createInitialAssistantPreferences({
          ...basePreferences,
          favoriteCorrectionRecords: [
            ...basePreferences.favoriteCorrectionRecords,
            createCorrectionDraft({
              aid: Number(videoContentContext.aid),
              title: videoContentContext.title || '未命名视频',
              originalLedgerId: correction.originalLedgerId,
              userLedgerIds: correction.targetLedgerIds,
              source: 'user-confirmed-deepseek',
              sourceScene: 'daily-favorite',
              author: videoContentContext.author,
              tags: videoContentContext.tags ?? [],
              matchedKeywords: diagnostic?.matchedKeywords ?? localClassification.matchedKeywords,
              score: diagnostic?.score,
              confidence: diagnostic?.confidence,
              scoreGap: diagnostic?.scoreGap
            })
          ],
          favoriteKeywordSuggestions: mergeKeywordSuggestions(
            basePreferences.favoriteKeywordSuggestions,
            correction.keywordSuggestions
          )
        })
      }

      let nextPreferences = applyDailyCorrectionLearning(
        recordAssistantPreferenceFeedback(preferences, feedbackTargetLedgerId, action),
        deepSeekCorrection
      )
      setPreferences(nextPreferences)
      if (window.bilimiDesktop?.savePreferences) {
        const saved = window.bilimiDesktop.patchPreferences
          ? await window.bilimiDesktop.patchPreferences({
              preferenceCounts: nextPreferences.preferenceCounts,
              favoriteCorrectionRecords: nextPreferences.favoriteCorrectionRecords,
              favoriteKeywordSuggestions: nextPreferences.favoriteKeywordSuggestions
            })
          : await window.bilimiDesktop.savePreferences(nextPreferences)
        nextPreferences = createInitialAssistantPreferences(saved)
        setPreferences(nextPreferences)
        window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
      }

      if (postActionDailyReviewPromise) {
        void (async () => {
          const reviewResult = await withTimeout(
            postActionDailyReviewPromise,
            DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
            undefined
          )
          const correction = dailyCorrectionFromReview({
            favoriteLedgers: actionFavoriteLedgers,
            localTargetLedgerId,
            localTargetLedgerIds,
            reviewResult
          })

          if (!correction) {
            publishRuntimeFeedback(dailyReviewFeedback({
              favoriteLedgers: actionFavoriteLedgers,
              localTargetLedgerIds,
              reviewResult
            }))
            if (reviewResult && !reviewResult.invalid) {
              const localNames = ledgerNames(localTargetLedgerIds)
              window.bilimiDesktop?.setAssistantPetHint?.({
                tone: 'happy',
                message: `主人，DeepSeek复核过啦～与原建议一致，存入「${localNames}」。`
              })
            }
            return
          }

          const delayedFavoriteLedgerStatus = actionAccountMid
            ? await preflightFavoriteLedgerStatus(actionAccountMid)
            : null
          if (actionAccountMid) {
            actionFavoriteLedgers = effectiveFavoriteLedgersForAccount(
              preferencesRef.current,
              actionAccountMid
            )
          }
          const targetNames = correction.targetLedgerIds
            .map((ledgerId) => ledgerDisplayName(actionFavoriteLedgers, ledgerId))
            .join('、')
          const delayedFavoriteProvisioned = isFavoriteWriteProvisioned(
            delayedFavoriteLedgerStatus,
            correction.targetLedgerIds
          )

          if (!favoriteProvisioned || !delayedFavoriteProvisioned) {
            publishRuntimeFeedback(
              `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${targetNames}」；当前收藏夹尚未备册或未绑定，本次仅更新预分类，请先去掌库收藏夹备册或重新绑定。`
            )
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'hint',
              message: `主人，DeepSeek建议归到「${targetNames}」。当前收藏夹还没备册或未绑定，本次只更新预分类；先去掌库收藏夹备册或重新绑定后再归类吧。`
            })
            return
          }

          const removeLedgerIds = localTargetLedgerIds.filter(
            (ledgerId) => !correction.targetLedgerIds.includes(ledgerId)
          )
          let adjustmentResult: AssistantAutomationResult
          try {
            adjustmentResult = await withTimeout(
              runScript(
                buildFavoriteApiAdjustmentScript(actionFavoriteLedgers, {
                  addLedgerIds: correction.targetLedgerIds,
                  removeLedgerIds,
                  aid: Number(videoContentContext.aid),
                  accountMid: actionAccountMid
                })
              ),
              DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
              {
                ok: false,
                steps: ['api:favorite:adjust-timeout'],
                missingTargets: ['favorite-api-adjust-timeout'],
                message: 'DeepSeek 后台归类调整超时。'
              }
            )
          } catch (error) {
            adjustmentResult = {
              ok: false,
              steps: ['api:favorite:adjust-error'],
              missingTargets: ['favorite-api-adjust'],
              message:
                'DeepSeek 后台归类调整未能完成：' +
                (error instanceof Error ? error.message : String(error || '未知错误'))
            }
          }
          if (!adjustmentResult.ok) {
            publishRuntimeFeedback(
              `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${targetNames}」，但后台调整失败。`
            )
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'error',
              message: `主人，DeepSeek重新判断建议改存到「${targetNames}」，但调整没有成功，目前仍在「${ledgerNames(localTargetLedgerIds)}」。`
            })
            return
          }

          const reviewOccurredAt = new Date().toISOString()
          const reviewOperationId = `daily-review:${actionAccountMid || 'unknown'}:${videoContentContext.aid ?? 'unknown'}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
          const reviewCommandResult = createConfirmedDailyReviewCommands({
            accountMid: actionAccountMid,
            aid: Number(videoContentContext.aid),
            title: videoContentContext.title?.trim() || `Video ${videoContentContext.aid}`,
            previousTargetLedgerIds: localTargetLedgerIds,
            targetLedgerIds: correction.targetLedgerIds,
            favoriteLedgers: actionFavoriteLedgers,
            initialResult: result,
            adjustmentResult,
            occurredAt: reviewOccurredAt,
            operationId: reviewOperationId
          })
          const reviewCommands = reviewCommandResult.commands
          let repositoryReviewPersisted = true
          if (reviewCommandResult.confirmedInput || reviewCommands.length > 0) {
            try {
              if (reviewCommandResult.confirmedInput) {
                if (!window.bilimiDesktop?.checkpointConfirmedFavoriteReview) {
                  throw new Error('收藏库恢复检查点接口不可用')
                }
                if (!window.bilimiDesktop?.commitConfirmedFavoriteReview) {
                  throw new Error('收藏库写入接口不可用')
                }
                await window.bilimiDesktop.checkpointConfirmedFavoriteReview(actionAccountMid, reviewCommandResult.confirmedInput)
                await window.bilimiDesktop.commitConfirmedFavoriteReview(actionAccountMid, reviewCommandResult.confirmedInput)
              } else {
                if (!window.bilimiDesktop?.commitFavoriteRepositoryCommand) {
                  throw new Error('收藏库写入接口不可用')
                }
                for (const command of reviewCommands) {
                  await window.bilimiDesktop.commitFavoriteRepositoryCommand(actionAccountMid, command)
                }
              }
            } catch (error) {
              repositoryReviewPersisted = false
              console.error('Confirmed daily review local registration failed.', error)
            }
          }

          const correctedPreferences = applyDailyCorrectionLearning(nextPreferences, correction)
          setPreferences(correctedPreferences)
          if (window.bilimiDesktop?.savePreferences) {
            const saved = window.bilimiDesktop.patchPreferences
              ? await window.bilimiDesktop.patchPreferences({
                  favoriteCorrectionRecords: correctedPreferences.favoriteCorrectionRecords,
                  favoriteKeywordSuggestions: correctedPreferences.favoriteKeywordSuggestions
                })
              : await window.bilimiDesktop.savePreferences(correctedPreferences)
            setPreferences(createInitialAssistantPreferences(saved))
            window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
          }
          if (!reviewCommandResult.evidenceComplete) {
            publishRuntimeFeedback(repositoryReviewPersisted
              ? `DeepSeek 二判完成：建议改归「${targetNames}」，但远端调整结果待核对。`
              : `DeepSeek 二判完成：远端调整结果与收藏库记录均待核对。`)
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'error',
              message: `主人，DeepSeek建议归入「${targetNames}」，但远端调整结果待核对。`
            })
          } else {
            publishRuntimeFeedback(
              `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${targetNames}」，已完成调整。`
            )
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'happy',
              message: `主人，DeepSeek重新判断有调整哦～已从「${ledgerNames(localTargetLedgerIds)}」改存到「${targetNames}」。`
            })
          }
        })()
      }
    }

    if (!result.ok && postActionDailyReviewPromise) {
      void (async () => {
        const reviewResult = await withTimeout(
          postActionDailyReviewPromise,
          DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
          undefined
        )
        const correction = dailyCorrectionFromReview({
          favoriteLedgers: actionFavoriteLedgers,
          localTargetLedgerId,
          localTargetLedgerIds,
          reviewResult
        })
        const localNames = ledgerNames(localTargetLedgerIds)
        publishRuntimeFeedback(
          correction
            ? `DeepSeek 二判完成：建议从「${localNames}」改归「${ledgerNames(correction.targetLedgerIds)}」，但主操作未完成，本次未调整。`
            : reviewResult && !reviewResult.invalid
              ? `DeepSeek 二判完成：与本地判断一致，保留在「${localNames}」，但主操作未完成。`
              : `DeepSeek 二判未完成，本次沿用本地判断「${localNames}」，但主操作未完成。`
        )
      })()
    }

    return result
  }

  async function generateRuntimeVideoNote(manualTranscript?: string): Promise<VideoNote | null> {
    const hasManualTranscript = Boolean(manualTranscript?.trim())

    if (!hasManualTranscript) {
      return generateRuntimeVideoNoteFromAudio()
    }

    const extraction = await readVideoNoteSource()

    if (!extraction && !hasManualTranscript) {
      return null
    }

    const transcript = hasManualTranscript
      ? parseManualTranscript(manualTranscript ?? '')
      : extraction?.transcript ?? []
    const activeTabSnapshot = getActiveTabSnapshot()
    const source = extraction?.source ?? {
      title: activeTabSnapshot?.title ?? '等待视频加载',
      tags: [],
      url: activeTabSnapshot?.url ?? 'about:blank'
    }

    return createLocalVideoNoteDraft({
      now: new Date().toISOString(),
      source,
      transcript,
      transcriptSource: hasManualTranscript ? 'manual' : extraction?.transcriptSource ?? 'manual'
    })
  }

  async function generateRuntimeVideoNoteFromAudio(): Promise<VideoNote | null> {
    const extraction = await readVideoNoteSource()

    if (!extraction?.source.url || !window.bilimiDesktop?.transcribeCurrentVideoAudio) {
      return null
    }

    const result = await window.bilimiDesktop.transcribeCurrentVideoAudio({
      url: extraction.source.url,
      title: extraction.source.title,
      author: extraction.source.author,
      bvid: extraction.source.bvid
    })

    return createLocalVideoNoteDraft({
      now: new Date().toISOString(),
      source: extraction.source,
      transcript: result.transcript,
      transcriptSource: 'audio'
    })
  }

  async function enqueueRuntimeVideoAudioTranscription(options?: {
    summarizeWithDeepSeek?: boolean
  }): Promise<VideoAudioTranscriptionQueueSnapshot | null> {
    const extraction = await readVideoNoteSource()

    if (!extraction?.source.url || !window.bilimiDesktop?.enqueueVideoAudioTranscription) {
      return null
    }

    const accountMid = await readBilibiliAccountMid()
    if (!accountMid) return null

    return window.bilimiDesktop.enqueueVideoAudioTranscription({
      accountMid,
      url: extraction.source.url,
      title: extraction.source.title,
      author: extraction.source.author,
      bvid: extraction.source.bvid,
      aid: extraction.source.aid,
      cid: extraction.source.cid,
      partNumber: extraction.source.partNumber,
      partTitle: extraction.source.partTitle,
      partDurationSeconds: extraction.source.partDurationSeconds,
      summarizeWithDeepSeek: Boolean(options?.summarizeWithDeepSeek)
    })
  }

  useEffect(() => {
    if (!window.bilimiDesktop?.registerAssistantRuntime) {
      return
    }

    return window.bilimiDesktop.registerAssistantRuntime(async (request: AssistantRuntimeRequest) => {
      switch (request.type) {
        case 'snapshot':
          if (window.bilimiDesktop?.readBilibiliAccountMid) await readBilibiliAccountMid()
          {
            const activeTabUrl = getActiveTabSnapshot()?.url
            const cachedContext = assistantSnapshotCacheRef.current.videoContextUrl === activeTabUrl
              ? assistantSnapshotCacheRef.current.videoContentContext
              : undefined
            if (activeTabUrl && readBilibiliVideoKey(activeTabUrl) && !cachedContext?.author?.trim()) {
              await readVideoContentContext()
            }
          }
          return createAssistantSnapshot(
            assistantSnapshotCacheRef.current.accountMid
              ? await readFavoriteLedgerStatus(assistantSnapshotCacheRef.current.accountMid).catch(() => null)
              : null
          )
        case 'run-action':
          return runAssistantRuntimeAction(request.action, request.options)
        case 'generate-video-note':
          return generateRuntimeVideoNote(request.manualTranscript)
        case 'generate-video-note-from-audio':
          return generateRuntimeVideoNoteFromAudio()
        case 'enqueue-current-video-audio':
          return enqueueRuntimeVideoAudioTranscription({
            summarizeWithDeepSeek: request.summarizeWithDeepSeek
          })
        case 'read-current-video-multipart':
          return readCurrentMultipartVideo()
        case 'save-video-note':
          await saveVideoNote(request.note)
          return request.note
        case 'get-current-video-time':
          return readCurrentVideoTime()
        case 'seek-video-time':
          return seekVideoTime(request.seconds)
        case 'ensure-ledgers':
          return ensureFavoriteLedgers()
        case 'ensure-ledger':
          return ensureFavoriteLedger(request.logicalFolderId, request.options)
        case 'save-ledgers':
          return saveFavoriteLedgers(request.ledgers, request.options)
        case 'open-bilibili-favorites':
          return openBilibiliFavorites()
        case 'favorite-repository-bind-page-target':
          return bindFavoriteRepositoryPageTarget(request.accountMid)
        case 'favorite-repository-page-operation':
          return runFavoriteRepositoryPageOperation(
            request.accountMid, request.runId, request.target, request.action, request.input
          )
        case 'old-favorite-workspace-bind-scan-target':
          return bindFavoriteRepositoryPageTarget(request.accountMid)
        case 'old-favorite-workspace-inventory':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'inventory', accountMid: request.accountMid
          })
        case 'old-favorite-workspace-read-source-page':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-source-page', accountMid: request.accountMid, folderId: request.folderId,
            page: request.page, pageSize: request.pageSize
          })
        case 'old-favorite-workspace-read-video-tags':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-video-tags', accountMid: request.accountMid, aid: request.aid
          })
        case 'old-favorite-workspace-read-managed-members':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-managed-members', accountMid: request.accountMid, folderIds: request.folderIds
          })
        default:
          throw new Error('Unknown assistant runtime request.')
      }
    })
  }, [
    generateRuntimeVideoNote,
    generateRuntimeVideoNoteFromAudio,
    openBilibiliFavorites,
    preferences,
    readFavoriteLedgerStatus,
    readCurrentVideoTime,
    readVideoContentContext,
    readVideoNoteSource,
    runAssistantRuntimeAction,
    saveFavoriteLedgers,
    saveVideoNote,
    seekVideoTime
  ])

  if (!preferencesLoaded) {
    return (
      <main className="startup-permission" aria-label="启动中">
        <section className="startup-permission__panel startup-permission__panel--compact">
          <p className="startup-permission__eyebrow">bilimi</p>
          <h1>启动中</h1>
        </section>
      </main>
    )
  }

  if (!preferences.permissionOnboardingCompleted) {
    return (
      <StartupPermissionGate
        onContinue={() => void completeStartupPermissionGate()}
      />
    )
  }

  return (
    <div className="app-shell" data-tabs-visible="true">
      <div className="app-main">
        <div className="browser-workspace">
        <div className="browser-tabs">
          <div className="browser-tabs__list" role="tablist" aria-label="网页标签">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="browser-tabs__item"
                data-selected={tab.id === activeTabId ? 'true' : 'false'}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  className="browser-tabs__tab"
                  onClick={() => selectActiveTab(tab.id)}
                >
                  <span className="browser-tabs__title">{tab.title}</span>
                </button>
                {tab.id !== HOME_TAB_ID ? (
                  <button
                    type="button"
                    className="browser-tabs__close"
                    aria-label={`关闭 ${tab.title}`}
                    title={`关闭 ${tab.title}`}
                    onClick={() => closeInternalTab(tab.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="browser-tabs__controls" aria-label="网页工具">
            <button
              type="button"
              className="browser-tabs__refresh"
              aria-label="刷新当前网页"
              title="刷新当前网页"
              onClick={refreshActiveTab}
            >
              <span aria-hidden="true">↻</span>
            </button>
            <span className="browser-tabs__collapse-slot" aria-hidden="true" />
          </div>
        </div>
        <div className="browser-stack">
          {tabs.map((tab) => (
            <BiliWebview
              key={tab.id}
              active={tab.id === activeTabId}
              tabId={tab.id}
              url={tab.url}
              seekSeconds={archiveSeekByTabId[tab.id]?.seconds}
              seekAid={archiveSeekByTabId[tab.id]?.aid}
              seekCid={archiveSeekByTabId[tab.id]?.cid}
              onLocationChange={updateTabUrl}
              onOpenInTab={openInternalTab}
              onHtmlFullscreenChange={handleHtmlFullscreenChange}
              onPageInteractionHint={handlePageInteractionHint}
              hostResizePaused={favoriteLibraryResizing || assistantSidebarResizing}
              onReady={handleWebviewReady}
              onTargetState={handleFavoriteRepositoryTargetState}
              onTitleChange={updateTabTitle}
            />
          ))}
        </div>
        <FavoriteLibraryDrawer
          ref={favoriteLibraryDrawerRef}
          open={favoriteLibraryOpen}
          onClose={() => setFavoriteLibraryOpen(false)}
          onResizeActiveChange={setFavoriteLibraryResizing}
          uiCallbacks={{
            onOrdinaryFolderEdit: () => {
              const message = '其他收藏夹请自行在 B 站修改。'
              publishRuntimeFeedback(message)
              window.bilimiDesktop?.setAssistantPetHint?.({ tone: 'hint', message })
            }
          }}
        />
        </div>
      </div>
      <AssistantSidebar
        onOpenInTab={openInternalTab}
        onResizeActiveChange={setAssistantSidebarResizing}
      />
    </div>
  )
}
