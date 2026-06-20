import { useState } from 'react'

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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedIntent = intent.trim()

    if (!trimmedIntent || busy) {
      return
    }

    onSubmit(trimmedIntent)
  }

  return (
    <form className="assistant-dialog assistant-dialog--intent" role="dialog" onSubmit={handleSubmit}>
      <label>
        <span>Comment intent</span>
        <textarea
          value={intent}
          disabled={busy}
          onChange={(event) => setIntent(event.currentTarget.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="assistant-settings__actions">
        <button type="submit" disabled={busy || !intent.trim()}>
          Generate comments
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
