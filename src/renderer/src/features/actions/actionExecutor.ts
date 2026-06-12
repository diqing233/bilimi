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
  favoriteApiFallbackEnabled?: boolean
  coinCount?: 1 | 2
  commentDraft?: string
  favoriteLedgers: FavoriteLedger[]
  targetLedgerId: string
}

const DOM_SCRIPT_TIMEOUT_MS = 15_000

function usesFavorite(action: AssistantAction): boolean {
  return action === '赏' || action === '赐' || action === '藏'
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
            message: '页面脚本执行超时，已切换到屏幕兜底。'
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
  const script = buildFavoriteApiFallbackScript(args.favoriteLedgers, args.targetLedgerId)
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
  if (args.action === '阅') {
    return { ok: true, steps: [], missingTargets: [], message: '此折已阅。' }
  }

  const script = buildAutomationScript(
    args.action,
    args.favoritesFolderName,
    args.coinCount,
    args.commentDraft,
    args.favoriteLedgers,
    args.targetLedgerId
  )
  const domResult = await runScriptWithTimeout(args.runScript, script)

  if (!shouldUseFavoriteApi(domResult, args.action)) {
    return domResult
  }

  const mustConfirmFavoriteFolder = usesFavorite(args.action)
  const apiResult =
    args.favoriteApiFallbackEnabled === false && !mustConfirmFavoriteFolder
      ? skipFavoriteApiFallback(domResult)
      : await runFavoriteApiFallback(args, domResult)

  if (
    apiResult.ok ||
    domResult.ok ||
    !args.runVisualFallback ||
    favoriteMissingTargets(apiResult).length === 0
  ) {
    return apiResult
  }

  const visualResult = await args.runVisualFallback({
    favoriteFolders: favoriteLedgerNamesById(args.favoriteLedgers),
    favoritesFolderName: args.favoritesFolderName,
    targetLedgerId: args.targetLedgerId
  })

  return {
    ok: visualResult.ok,
    steps: [...apiResult.steps, ...visualResult.steps],
    missingTargets: visualResult.missingTargets,
    message: visualResult.message
  }
}
