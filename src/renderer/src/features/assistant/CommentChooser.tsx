import { useState } from 'react'

type CommentChooserProps = {
  drafts: string[]
  onSelect: (draft: string) => void
  onCancel: () => void
}

export function CommentChooser({ drafts, onSelect, onCancel }: CommentChooserProps) {
  const [submitted, setSubmitted] = useState(false)

  function handleSelect(draft: string) {
    if (submitted) {
      return
    }

    setSubmitted(true)
    onSelect(draft)
  }

  return (
    <div
      className="assistant-dialog assistant-dialog--comment-chooser"
      role="dialog"
      aria-label="小mi推荐评论"
    >
      <p>小mi拟好三条，主人点一条就发送。</p>
      <div className="assistant-dialog__comment-list">
        {drafts.map((draft) => (
          <button
            key={draft}
            type="button"
            className="assistant-dialog__comment-choice"
            disabled={submitted}
            onClick={() => handleSelect(draft)}
          >
            {draft}
          </button>
        ))}
      </div>
      <button type="button" disabled={submitted} onClick={onCancel}>朕再想想</button>
    </div>
  )
}
