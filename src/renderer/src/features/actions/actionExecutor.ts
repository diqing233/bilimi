import type {
  AssistantAction,
  AssistantAutomationResult,
  FavoriteLedger,
  VisualAutomationFallback
} from '@shared/types'
import { favoriteLedgerNamesById } from '@shared/favoriteLedgers'
import { buildFavoriteApiFallbackScript } from './favoriteApiAutomation'
import { buildAutomationScript } from './pageAutomation'

type ExecuteAssistantActionArgs = {
  action: AssistantAction
  favoritesFolderName: string
  runScript: (script: string) => Promise<AssistantAutomationResult>
  runVisualFallback?: VisualAutomationFallback
  runTrustedDanmakuSubmitFallback?: (commentDraft: string) => Promise<AssistantAutomationResult>
  favoriteApiFallbackEnabled?: boolean
  coinCount?: 1 | 2
  commentDraft?: string
  submitComment?: boolean
  favoriteLedgers: FavoriteLedger[]
  targetLedgerId: string
  targetLedgerIds?: string[]
  /** When false, review may perform likes/coins but must not mutate favorites. */
  favoriteProvisioned?: boolean
  resultMessagePrefix?: string
}

const DOM_SCRIPT_TIMEOUT_MS = 15_000
const TRUSTED_DANMAKU_TARGETS = ['danmaku-field', 'danmaku-fill', 'danmaku-focus']

function usesFavorite(action: AssistantAction): boolean {
  return action === '赏' || action === '赐' || action === '藏'
}

function favoriteTargetLabel(args: ExecuteAssistantActionArgs): string {
  const targetLedgerIds =
    args.targetLedgerIds && args.targetLedgerIds.length > 0
      ? args.targetLedgerIds
      : [args.targetLedgerId]
  const targetNames = targetLedgerIds
    .map((ledgerId) => args.favoriteLedgers.find((ledger) => ledger.id === ledgerId)?.displayName)
    .filter((name): name is string => Boolean(name?.trim()))
  const uniqueTargetNames = Array.from(new Set(targetNames))

  return uniqueTargetNames.length > 0
    ? uniqueTargetNames.join('、')
    : args.favoritesFolderName.trim() || 'bilimi 收藏夹'
}

function favoriteSuccessMessage(args: ExecuteAssistantActionArgs): string {
  const targetLabel = favoriteTargetLabel(args)

  if (args.favoriteProvisioned === false) {
    const completedAction =
      args.action === '赏'
        ? '已点赞'
        : args.action === '赐'
          ? '已一键三连'
          : '本次操作未写入收藏夹'
    return `${completedAction}；当前收藏夹尚未备册或未绑定，本次仅完成预分类，未创建或写入 B 站收藏夹；请先去掌库收藏夹备册或重新绑定，完成后可归类到 ${targetLabel}。`
  }

  if (args.action === '赏') {
    return `已点赞，归类存入 ${targetLabel}。`
  }

  if (args.action === '赐') {
    return `已一键三连，归类存入 ${targetLabel}。`
  }

  return `已归类存入 ${targetLabel}。`
}

function formatActionResultMessage(
  args: ExecuteAssistantActionArgs,
  result: AssistantAutomationResult
): AssistantAutomationResult {
  const message = result.ok && usesFavorite(args.action) ? favoriteSuccessMessage(args) : result.message
  const prefix = args.resultMessagePrefix?.trim()

  if (!prefix) {
    return { ...result, message }
  }

  return {
    ...result,
    message: message ? `${prefix}\n${message}` : prefix
  }
}

function shouldUseFavoriteApi(result: AssistantAutomationResult, action: AssistantAction): boolean {
  if (!usesFavorite(action)) {
    return false
  }

  if (result.ok) {
    return true
  }

  return (result.missingTargets ?? []).some((target) => target.includes('favorite'))
}

function favoriteMissingTargets(result: AssistantAutomationResult) {
  return result.missingTargets.filter((target) => target.includes('favorite'))
}

function nonFavoriteMissingTargets(result: AssistantAutomationResult) {
  return result.missingTargets.filter((target) => !target.includes('favorite'))
}

function shouldUseTrustedDanmakuSubmit(
  args: ExecuteAssistantActionArgs,
  result: AssistantAutomationResult
) {
  return (
    args.action === '表' &&
    args.submitComment === true &&
    Boolean(args.commentDraft?.trim()) &&
    Boolean(args.runTrustedDanmakuSubmitFallback) &&
    result.missingTargets.some((target) => TRUSTED_DANMAKU_TARGETS.includes(target))
  )
}

function shouldUseDirectTrustedDanmakuSubmit(args: ExecuteAssistantActionArgs) {
  return (
    args.action === '表' &&
    args.submitComment === true &&
    Boolean(args.commentDraft?.trim()) &&
    Boolean(args.runTrustedDanmakuSubmitFallback)
  )
}

async function runTrustedDanmakuSubmit(
  args: ExecuteAssistantActionArgs,
  domResult: AssistantAutomationResult
): Promise<AssistantAutomationResult> {
  const fallbackResult = await args.runTrustedDanmakuSubmitFallback?.(args.commentDraft ?? '')
  if (!fallbackResult) {
    return domResult
  }

  const remainingDomMissingTargets = domResult.missingTargets.filter(
    (target) => !TRUSTED_DANMAKU_TARGETS.includes(target)
  )
  const missingTargets = fallbackResult.ok
    ? remainingDomMissingTargets
    : [...remainingDomMissingTargets, ...fallbackResult.missingTargets]

  return {
    ok: fallbackResult.ok && missingTargets.length === 0,
    steps: [...domResult.steps, ...fallbackResult.steps],
    missingTargets,
    message: fallbackResult.message
  }
}

async function runScriptWithTimeout(
  runScript: (script: string) => Promise<AssistantAutomationResult>,
  script: string
): Promise<AssistantAutomationResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      runScript(script),
      new Promise<AssistantAutomationResult>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            ok: false,
            steps: ['dom:timeout'],
            missingTargets: ['favorite-timeout'],
            message: '页面响应较慢，已尝试屏幕操作。'
          })
        }, DOM_SCRIPT_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function runFavoriteApiFallback(
  args: ExecuteAssistantActionArgs,
  domResult: AssistantAutomationResult
): Promise<AssistantAutomationResult> {
  const script = buildFavoriteApiFallbackScript(
    args.favoriteLedgers,
    args.targetLedgerId,
    args.targetLedgerIds
  )
  const apiResult = await runScriptWithTimeout(args.runScript, script)
  const unresolvedNonFavoriteTargets = nonFavoriteMissingTargets(domResult)
  const missingTargets = apiResult.ok
    ? unresolvedNonFavoriteTargets
    : [...unresolvedNonFavoriteTargets, ...apiResult.missingTargets]

  if (apiResult.ok && missingTargets.length === 0) {
    return {
      ok: true,
      steps: [...domResult.steps, ...apiResult.steps],
      missingTargets: [],
      favoriteFolderIdsByLedgerId: apiResult.favoriteFolderIdsByLedgerId,
      message: apiResult.message
    }
  }

  return {
    ok: false,
    steps: [...domResult.steps, ...apiResult.steps],
    missingTargets,
    message:
      apiResult.ok && missingTargets.length > 0
        ? '收藏已完成，但仍有 ' + missingTargets.join('、') + ' 未能寻见。'
        : apiResult.message
  }
}

function skipFavoriteApiFallback(
  domResult: AssistantAutomationResult
): AssistantAutomationResult {
  return {
    ok: false,
    steps: [...domResult.steps, 'api:favorite:disabled'],
    missingTargets: domResult.missingTargets,
    message: domResult.message
  }
}

export async function executeAssistantAction(args: ExecuteAssistantActionArgs) {
  const result = await executeAssistantActionCore(args)
  return formatActionResultMessage(args, result)
}

async function executeAssistantActionCore(args: ExecuteAssistantActionArgs) {
  if (args.action === '阅') {
    return { ok: true, steps: [], missingTargets: [], message: '此折已阅。' }
  }

  if (shouldUseDirectTrustedDanmakuSubmit(args)) {
    const result = await args.runTrustedDanmakuSubmitFallback?.(args.commentDraft ?? '')
    if (result) {
      return result
    }
  }

  const pageClickOnly = args.favoriteApiFallbackEnabled === false
  const favoriteUnavailable = args.favoriteProvisioned === false
  const skipPageFavorite = usesFavorite(args.action) && (favoriteUnavailable || !pageClickOnly)

  if (args.action === '藏' && skipPageFavorite && !favoriteUnavailable) {
    return runFavoriteApiFallback(args, {
      ok: true,
      steps: [],
      missingTargets: [],
      message: ''
    })
  }

  const script = buildAutomationScript(
    args.action,
    args.favoritesFolderName,
    args.coinCount,
    args.commentDraft,
    args.favoriteLedgers,
    args.targetLedgerId,
    { submitComment: args.submitComment, skipFavorite: skipPageFavorite }
  )
  const domResult = await runScriptWithTimeout(args.runScript, script)

  if (shouldUseTrustedDanmakuSubmit(args, domResult)) {
    return runTrustedDanmakuSubmit(args, domResult)
  }

  if (favoriteUnavailable || !shouldUseFavoriteApi(domResult, args.action)) {
    return domResult
  }

  if (pageClickOnly) {
    if (domResult.ok || !args.runVisualFallback || favoriteMissingTargets(domResult).length === 0) {
      return domResult
    }

    const visualResult = await args.runVisualFallback(
      {
        favoriteFolders: favoriteLedgerNamesById(args.favoriteLedgers),
        favoritesFolderName: args.favoritesFolderName,
        targetLedgerId: args.targetLedgerId
      },
      { openWithShortcut: true }
    )

    return {
      ok: visualResult.ok,
      steps: [...domResult.steps, ...visualResult.steps],
      missingTargets: visualResult.missingTargets,
      message: visualResult.message
    }
  }

  const mustConfirmFavoriteFolder = usesFavorite(args.action)
  const apiResult =
    args.favoriteApiFallbackEnabled === false && !mustConfirmFavoriteFolder
      ? skipFavoriteApiFallback(domResult)
      : await runFavoriteApiFallback(args, domResult)

  return apiResult
}
