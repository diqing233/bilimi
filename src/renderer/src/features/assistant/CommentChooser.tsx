import { useEffect, useState } from 'react'

type CommentChooserProps = {
  drafts: string[]
  onSelect: (draft: string) => void
  onCancel: () => void
}

export function CommentChooser({ drafts, onSelect, onCancel }: CommentChooserProps) {
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitted) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel, submitted])

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
      aria-label="小咪推荐评论"
    >
      <p>小咪拟好三条，主人点一条就发送。</p>
      <div className="assistant-dialog__comment-list" role="group" aria-label="评论候选">
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
      <div className="assistant-dialog__comment-actions" role="group" aria-label="评论操作">
        <button
          type="button"
          className="assistant-dialog__comment-cancel"
          disabled={submitted}
          onClick={onCancel}
        >
          我再想想
        </button>
      </div>
    </div>
  )
}
