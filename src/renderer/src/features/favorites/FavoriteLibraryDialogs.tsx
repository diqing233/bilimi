import type { ReactNode } from 'react'
import { BilimiModal } from '../../components/BilimiModal'

type ConfirmationDialogProps = {
  label: string
  children: ReactNode
  actions?: ReactNode
  onClose: () => void
  busy?: boolean
}

export function FavoriteLibraryConfirmationDialog({ label, children, actions, onClose, busy = false }: ConfirmationDialogProps) {
  return <BilimiModal
    title={label}
    role="alertdialog"
    busy={busy}
    onClose={onClose}
    className="favorite-library__dialog favorite-library__dialog-overlay"
    actions={actions}
  >
    {children}
  </BilimiModal>
}
