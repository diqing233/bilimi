import type { MouseEventHandler, PointerEventHandler } from 'react'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'

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
      <span className="seal-button__hint">我是 bilimi，主人可以叫我小咪~</span>
      <img className="seal-button__pet" src={idlePetUrl} alt="小咪待机" />
    </button>
  )
}
