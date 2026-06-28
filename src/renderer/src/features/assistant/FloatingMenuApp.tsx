import type { AssistantAction } from '@shared/types'
import { useState } from 'react'

const FLOATING_MENU_ACTIONS: Array<{ action: AssistantAction; label: string; hint: string }> = [
  { action: '赏', label: '赞', hint: '轻赏此条' },
  { action: '藏', label: '藏', hint: '归入内库' },
  { action: '赐', label: '赐', hint: '投币厚赏' },
  { action: '表', label: '评', hint: '拟奏短评' }
]

export function FloatingMenuApp() {
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2 }) {
    if (runningAction) {
      return
    }

    setRunningAction(action)

    try {
      if (options) {
        await window.bilimiDesktop?.runFloatingMenuAction?.(action, options)
      } else {
        await window.bilimiDesktop?.runFloatingMenuAction?.(action)
      }
    } finally {
      setRunningAction(null)
    }
  }

  function handleAction(action: AssistantAction) {
    if (runningAction) {
      return
    }

    void runAction(action)
  }

  return (
    <main className="floating-menu-shell" aria-label="Bilimi 悬浮菜单">
      <div className="floating-menu" role="menu" aria-label="Bilimi 悬浮动作">
        {FLOATING_MENU_ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            aria-label={item.label}
            className="floating-menu__action"
            disabled={runningAction !== null}
            onClick={() => handleAction(item.action)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
        <button
          type="button"
          className="floating-menu__close"
          aria-label="收起悬浮菜单"
          onClick={() => window.bilimiDesktop?.closeFloatingMenu?.()}
        >
          收
        </button>
      </div>
    </main>
  )
}
