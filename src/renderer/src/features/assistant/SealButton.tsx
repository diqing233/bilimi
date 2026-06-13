import type { MouseEventHandler, PointerEventHandler } from 'react'

type SealButtonProps = {
  onOpen: () => void
  onMouseDown?: MouseEventHandler<HTMLButtonElement>
  onMouseMove?: MouseEventHandler<HTMLButtonElement>
  onMouseUp?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLButtonElement>
  onPointerMove?: PointerEventHandler<HTMLButtonElement>
  onPointerUp?: PointerEventHandler<HTMLButtonElement>
}

export function SealButton({
  onOpen,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: SealButtonProps) {
  return (
    <button
      className="seal-button"
      type="button"
      onClick={onOpen}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label="开折批阅"
    >
      <span className="seal-button__hint">掌印官请旨：是否开折批阅？</span>
      <span className="seal-button__face">玺</span>
    </button>
  )
}
