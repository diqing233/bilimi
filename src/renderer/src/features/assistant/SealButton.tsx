type SealButtonProps = {
  onOpen: () => void
}

export function SealButton({ onOpen }: SealButtonProps) {
  return (
    <button className="seal-button" type="button" onClick={onOpen} aria-label="开折批阅">
      <span className="seal-button__hint">掌印官请旨：是否开折批阅？</span>
      <span className="seal-button__face">玺</span>
    </button>
  )
}
