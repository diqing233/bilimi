import { useState } from 'react'

type CoinPromptProps = {
  onChoose: (coinCount: 1 | 2) => void
  onCancel: () => void
}

export function CoinPrompt({ onChoose, onCancel }: CoinPromptProps) {
  const [submitted, setSubmitted] = useState(false)

  function handleChoose(coinCount: 1 | 2) {
    if (submitted) {
      return
    }

    setSubmitted(true)
    onChoose(coinCount)
  }

  return (
    <div className="assistant-dialog">
      <p>陛下意欲赐几枚铜钱？</p>
      <button type="button" disabled={submitted} onClick={() => handleChoose(1)}>赐一枚</button>
      <button type="button" disabled={submitted} onClick={() => handleChoose(2)}>赐两枚</button>
      <button type="button" disabled={submitted} onClick={onCancel}>暂缓</button>
    </div>
  )
}
