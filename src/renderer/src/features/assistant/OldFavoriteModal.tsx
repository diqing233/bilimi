import { type ReactNode } from 'react'
import { BilimiModal } from '../../components/BilimiModal'

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
  return <BilimiModal
    title={title}
    tone={danger ? 'danger' : 'default'}
    className="old-favorite-modal__dialog"
    onClose={onCancel}
    actions={<>
      {extraActions}
      <button type="button" onClick={onCancel}>{cancelLabel}</button>
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
