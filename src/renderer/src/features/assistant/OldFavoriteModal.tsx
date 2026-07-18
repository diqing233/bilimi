import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type OldFavoriteModalProps = {
  title: string
  children: ReactNode
  danger?: boolean
  cancelLabel?: string
  confirmLabel?: string
  confirmDisabled?: boolean
  extraActions?: ReactNode
  onCancel: () => void
  onConfirm?: () => void
}

export function OldFavoriteModal({
  title,
  children,
  danger = false,
  cancelLabel = '取消',
  confirmLabel = '确认',
  confirmDisabled = false,
  extraActions,
  onCancel,
  onConfirm
}: OldFavoriteModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const previousFocus = useRef<HTMLElement | null>(null)
  const scrollY = useRef(0)

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    scrollY.current = window.scrollY
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const focusCancel = () => cancelRef.current?.focus()
    focusCancel()
    const focusFrame = window.requestAnimationFrame(focusCancel)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current()
      if (event.key !== 'Tab') return
      const dialog = cancelRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')
      const controls = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        : []
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.cancelAnimationFrame(focusFrame)
      document.documentElement.style.overflow = previousOverflow
      previousFocus.current?.focus()
      if (scrollY.current !== 0) window.scrollTo?.(0, scrollY.current)
    }
  }, [])

  return createPortal(
    <div className="old-favorite-modal__viewport">
      <button
        type="button"
        className="old-favorite-modal__scrim"
        data-testid="old-favorite-modal-scrim"
        aria-label="关闭弹窗"
        onClick={() => onCancelRef.current()}
      />
      <section
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        className="old-favorite-modal__dialog"
      >
        <h4>{title}</h4>
        <div className="old-favorite-modal__body">{children}</div>
        <div className="old-favorite-modal__actions">
          {extraActions}
          <button ref={cancelRef} type="button" onClick={() => onCancelRef.current()}>{cancelLabel}</button>
          {onConfirm ? (
            <button
              type="button"
              data-danger={danger || undefined}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  )
}
