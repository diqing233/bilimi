import { type ReactNode } from 'react'
import { BilimiModal } from '../../components/BilimiModal'

type OldFavoriteModalProps = {
  title: string
  children: ReactNode
  danger?: boolean
  confirmLabel?: string
  confirmDisabled?: boolean
  extraActions?: ReactNode
  className?: string
  onCancel: () => void
  onConfirm?: () => void
}

export function OldFavoriteModal({
  title,
  children,
  danger = false,
  confirmLabel = '确认',
  confirmDisabled = false,
  extraActions,
  className,
  onCancel,
  onConfirm
}: OldFavoriteModalProps) {
  return <BilimiModal
    title={title}
    tone={danger ? 'danger' : 'default'}
    className={`old-favorite-modal__dialog${className ? ` ${className}` : ''}`}
    onClose={onCancel}
    actions={<>
      {extraActions}
      {onConfirm ? <button
        type="button"
        data-variant={danger ? 'danger' : 'primary'}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button> : null}
    </>}
  >
    <div className="old-favorite-modal__body">{children}</div>
  </BilimiModal>
}
