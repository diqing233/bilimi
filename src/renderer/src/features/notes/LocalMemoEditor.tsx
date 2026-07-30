import { memo, useEffect, useState } from 'react'

export const LocalMemoEditor = memo(function LocalMemoEditor({
  identity,
  value,
  onCommit
}: {
  identity: string
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [identity, value])

  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => onCommit(draft)}
    />
  )
})
