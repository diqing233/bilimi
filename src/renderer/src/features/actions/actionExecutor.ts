import type { AssistantAction } from '@shared/types'
import { buildAutomationScript } from './pageAutomation'

type ExecuteAssistantActionArgs = {
  action: AssistantAction
  favoritesFolderName: string
  runScript: (script: string) => Promise<{ ok: boolean; steps: string[] }>
  coinCount?: 1 | 2
}

export async function executeAssistantAction(args: ExecuteAssistantActionArgs) {
  if (args.action === '阅') {
    return { ok: true, steps: [] }
  }

  const script = buildAutomationScript(args.action, args.favoritesFolderName, args.coinCount)
  return args.runScript(script)
}
