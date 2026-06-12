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
    <div className="assistant-dialog">
      <p>臣已拟好三条，请陛下择其一。</p>
      {drafts.map((draft) => (
        <button key={draft} type="button" disabled={submitted} onClick={() => handleSelect(draft)}>
          {draft}
        </button>
      ))}
      <button type="button" disabled={submitted} onClick={onCancel}>朕再想想</button>
    </div>
  )
}
