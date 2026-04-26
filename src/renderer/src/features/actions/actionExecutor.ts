import type { AssistantAction, AssistantAutomationResult, RecommendationKind } from '@shared/types'
import { buildAutomationScript } from './pageAutomation'

type ExecuteAssistantActionArgs = {
  action: AssistantAction
  favoritesFolderName: string
  runScript: (script: string) => Promise<AssistantAutomationResult>
  coinCount?: 1 | 2
  commentDraft?: string
  recommendationKind?: RecommendationKind
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
    args.recommendationKind
  )
  return args.runScript(script)
}
