type CoinPromptProps = {
  onChoose: (coinCount: 1 | 2) => void
  onCancel: () => void
}

export function CoinPrompt({ onChoose, onCancel }: CoinPromptProps) {
  return (
    <div className="assistant-dialog">
      <p>陛下意欲赐几枚铜钱？</p>
      <button type="button" onClick={() => onChoose(1)}>赐一枚</button>
      <button type="button" onClick={() => onChoose(2)}>赐两枚</button>
      <button type="button" onClick={onCancel}>暂缓</button>
    </div>
  )
}
