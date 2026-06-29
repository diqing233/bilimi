import { useState } from 'react'

export type CopySplitOption = {
  id: string
  label: string
  text: string
  message: string
  disabled?: boolean
}

type CopySplitButtonProps = {
  groupLabel: string
  buttonLabel: string
  menuLabel: string
  text: string
  message: string
  disabled?: boolean
  options: CopySplitOption[]
  onCopy: (value: string, message: string) => Promise<void> | void
}

export function CopySplitButton({
  groupLabel,
  buttonLabel,
  menuLabel,
  text,
  message,
  disabled = false,
  options,
  onCopy
}: CopySplitButtonProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuDisabled = disabled || options.every((option) => option.disabled)

  async function copy(value: string, successMessage: string): Promise<void> {
    setMenuOpen(false)
    await onCopy(value, successMessage)
  }

  return (
    <div className="video-notes__copy-split" role="group" aria-label={groupLabel}>
      <button
        type="button"
        className="video-notes__copy-main"
        disabled={disabled}
        onClick={() => void copy(text, message)}
      >
        {buttonLabel}
      </button>
      <button
        type="button"
        className="video-notes__copy-menu-button"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={menuDisabled}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ▾
      </button>
      {menuOpen ? (
        <div className="video-notes__copy-menu" role="menu" aria-label={menuLabel}>
          {options.map((option) => (
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
