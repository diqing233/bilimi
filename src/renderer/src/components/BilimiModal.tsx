import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalScrollLock = {
  count: number
  previousOverflow: string
}

const modalScrollLocks = new WeakMap<Document, ModalScrollLock>()

function lockDocumentScroll(document: Document) {
  let lock = modalScrollLocks.get(document)
  if (!lock) {
    lock = {
      count: 0,
      previousOverflow: document.documentElement.style.overflow
    }
    modalScrollLocks.set(document, lock)
  }
  if (lock.count === 0) {
    lock.previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
  }
  lock.count += 1

  return () => {
    lock!.count -= 1
    if (lock!.count > 0) return
    document.documentElement.style.overflow = lock!.previousOverflow
    modalScrollLocks.delete(document)
  }
}

type BilimiModalProps = {
  title: string
  children: ReactNode
  actions?: ReactNode
  actionsLabel?: string
  ariaLabel?: string
  tone?: 'default' | 'danger'
  role?: 'dialog' | 'alertdialog'
  busy?: boolean
  className?: string
  onClose?: () => void
}

export function BilimiModal({
  title,
  children,
  actions,
  actionsLabel,
  ariaLabel,
  tone = 'default',
  role,
  busy = false,
  className,
  onClose
}: BilimiModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousScrollY = window.scrollY
    const releaseScrollLock = lockDocumentScroll(document)

    const focusFirstControl = () => dialogRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
      ?.focus()
    focusFirstControl()
    const focusFrame = window.requestAnimationFrame(focusFirstControl)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy) onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
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
      releaseScrollLock()
      previousFocus?.focus()
      if (previousScrollY !== 0) window.scrollTo?.(0, previousScrollY)
    }
  }, [busy])

  const modal = <div className="bilimi-modal__viewport">
    <button
      type="button"
      className="bilimi-modal__scrim"
      data-testid="bilimi-modal-scrim"
      aria-label="关闭弹窗遮罩"
      tabIndex={-1}
      onPointerDown={() => { if (!busy) onCloseRef.current?.() }}
    />
    <section
      ref={dialogRef}
      role={role ?? (tone === 'danger' ? 'alertdialog' : 'dialog')}
      aria-modal="true"
      {...(ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': titleId })}
      aria-busy={busy || undefined}
      data-tone={tone}
      className={`bilimi-modal__dialog${className ? ` ${className}` : ''}`}
    >
      <header className="bilimi-modal__header">
        <h2 id={titleId}>{title}</h2>
        {onClose ? <button
          type="button"
          className="bilimi-modal__close"
          aria-label="关闭弹窗"
          disabled={busy}
          onClick={() => { if (!busy) onCloseRef.current?.() }}
        >×</button> : null}
      </header>
      <div className="bilimi-modal__body">{children}</div>
      {actions ? <div className="bilimi-modal__actions" role={actionsLabel ? 'group' : undefined} aria-label={actionsLabel}>{actions}</div> : null}
    </section>
  </div>

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}
