import { useState } from 'react'
import { useModalFocus } from '../accessibility/useModalFocus'

type CommentIntentDialogProps = {
  busy: boolean
  error: string
  onSubmit: (intent: string) => void
  onCancel: () => void
}

export function CommentIntentDialog({
  busy,
  error,
  onSubmit,
  onCancel
}: CommentIntentDialogProps) {
  const [intent, setIntent] = useState('')
  const dialogRef = useModalFocus(onCancel)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedIntent = intent.trim()

    if (!trimmedIntent || busy) {
      return
    }

    onSubmit(trimmedIntent)
  }

  return (
    <form
      ref={dialogRef as React.RefObject<HTMLFormElement>}
      className="assistant-dialog assistant-dialog--intent"
      role="dialog"
      aria-modal="true"
      onSubmit={handleSubmit}
    >
      <label>
        <span>评论方向</span>
        <textarea
          value={intent}
          disabled={busy}
          onChange={(event) => setIntent(event.currentTarget.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="assistant-settings__actions">
        <button type="submit" disabled={busy || !intent.trim()}>
          生成评论
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}
