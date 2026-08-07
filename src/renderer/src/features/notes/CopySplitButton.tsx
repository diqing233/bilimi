import { useEffect, useRef, useState } from 'react'
import { useExclusiveMenu } from '../../components/useExclusiveMenu'

export type DownloadFormat = 'markdown' | 'word'

export type CopySplitOption = {
  id: string
  label: string
  text: string
  message: string
  disabled?: boolean
}

type CopySplitButtonProps = {
  groupLabel: string
  menuLabel: string
  options: CopySplitOption[]
  onCopy: (value: string, message: string) => Promise<void> | void
}

export function CopySplitButton({
  groupLabel,
  menuLabel,
  options,
  onCopy
}: CopySplitButtonProps): React.JSX.Element {
  const [menuOpen, setMenuOpen, menuScope] = useExclusiveMenu()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuDisabled = options.every((option) => option.disabled)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function copy(value: string, successMessage: string): Promise<void> {
    setMenuOpen(false)
    await onCopy(value, successMessage)
  }

  return (
    <div {...menuScope} ref={rootRef} className="video-notes__copy-split" role="group" aria-label={groupLabel}>
      <button
        ref={triggerRef}
        type="button"
        className="video-notes__copy-main"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={menuDisabled}
        onClick={() => setMenuOpen((open) => !open)}
      >
        复制
        <span className="disclosure-arrow" aria-hidden="true">▾</span>
      </button>
      {menuOpen ? (
        <div className="video-notes__copy-menu" role="menu" aria-label={menuLabel}>
          {options.map((option) => option.id === 'divider' ? <hr key={option.id} /> : (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              disabled={option.disabled}
              onClick={() => void copy(option.text, option.message)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ExportButton({ groupLabel, disabled = false, title, onExport }: {
  groupLabel: string
  disabled?: boolean
  title?: string
  onExport: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="video-notes__download-button" aria-label="导出" disabled={disabled} title={title} onClick={onExport}>导出</button>
  )
}
