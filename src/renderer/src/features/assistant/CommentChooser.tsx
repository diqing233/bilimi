import { useState } from 'react'
import { useModalFocus } from '../accessibility/useModalFocus'

type CommentChooserProps = {
  drafts: string[]
  onSelect: (draft: string) => void
  onCancel: () => void
}

export function CommentChooser({ drafts, onSelect, onCancel }: CommentChooserProps) {
  const [submitted, setSubmitted] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const dialogRef = useModalFocus(() => {
    if (!submitted) onCancel()
  })

  function handleSelect(draft: string) {
    if (submitted) {
      return
    }

    setSubmitted(true)
    onSelect(draft)
  }

  async function copyDraft(draft: string, index: number) {
    if (submitted) {
      return
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable.')
      }

      await navigator.clipboard.writeText(draft)
      setCopyStatus(`已复制第 ${index + 1} 条评论。`)
    } catch {
      setCopyStatus(`第 ${index + 1} 条评论复制失败，请手动复制。`)
    }
  }

  return (
    <div
      ref={dialogRef as React.RefObject<HTMLDivElement>}
      className="assistant-dialog assistant-dialog--comment-chooser"
      role="dialog"
      aria-modal="true"
      aria-label="小咪推荐评论"
    >
      <p>小咪拟好三条，主人点一条就发送。</p>
      <div className="assistant-dialog__comment-list" role="group" aria-label="评论候选">
        {drafts.map((draft, index) => (
          <div className="assistant-dialog__comment-row" key={draft}>
            <button
              type="button"
              className="assistant-dialog__comment-choice"
              disabled={submitted}
              onClick={() => handleSelect(draft)}
            >
              {draft}
            </button>
            <button
              type="button"
              className="assistant-dialog__comment-copy"
              aria-label={`复制第 ${index + 1} 条评论`}
              disabled={submitted}
              onClick={() => void copyDraft(draft, index)}
            >
              复制
            </button>
          </div>
        ))}
      </div>
      <p className="assistant-dialog__comment-status" role="status">
        {copyStatus}
      </p>
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
