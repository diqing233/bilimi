type CommentChooserProps = {
  drafts: string[]
  onSelect: (draft: string) => void
  onCancel: () => void
}

export function CommentChooser({ drafts, onSelect, onCancel }: CommentChooserProps) {
  return (
    <div className="assistant-dialog">
      <p>臣已拟好三条，请陛下择其一。</p>
      {drafts.map((draft) => (
        <button key={draft} type="button" onClick={() => onSelect(draft)}>
          {draft}
        </button>
      ))}
      <button type="button" onClick={onCancel}>朕再想想</button>
    </div>
  )
}
