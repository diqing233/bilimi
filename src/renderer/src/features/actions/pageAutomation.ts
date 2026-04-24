import type { AssistantAction } from '@shared/types'

export function buildAutomationScript(
  action: AssistantAction,
  favoritesFolderName: string,
  coinCount?: 1 | 2
): string {
  return `
    (() => {
      const steps = [];
      if ('${action}' === '赏' || '${action}' === '赐') steps.push('like');
      if ('${action}' === '赏' || '${action}' === '赐') steps.push('favorite');
      if ('${action}' === '赐') steps.push('coin:${coinCount ?? 1}');
      return { ok: true, steps, favoritesFolderName: '${favoritesFolderName}' };
    })();
  `
}
