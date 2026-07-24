import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

const DEFAULT_WIDTH = 300
const MIN_WIDTH = 220
const MAX_WIDTH = 520

type FavoriteLibraryDetailProps = {
  title?: string
  selected?: boolean
  onCollapse: (collapsed: boolean) => void
  collapsed?: boolean
  onRestore?: () => void
  children?: ReactNode
}

export function FavoriteLibraryDetail({ title, selected = Boolean(title), onCollapse, collapsed = false, onRestore, children }: FavoriteLibraryDetailProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragStart = useRef<{ clientX: number; width: number }>()
  const applyWidth = (nextWidth: number, target?: HTMLElement) => {
    setWidth(nextWidth)
    target?.closest('.favorite-library')?.style.setProperty('--favorite-detail-width', `${nextWidth}px`)
  }
  if (collapsed) return <aside className="favorite-library__detail-restore" aria-label="视频详情已收起">
    <button type="button" onClick={onRestore}>恢复视频详情</button>
  </aside>
  if (!selected) return <aside className="favorite-library__detail favorite-library__detail-empty" aria-label={'\u89c6\u9891\u8be6\u60c5'}>
    <p>选择一个视频查看详情</p>
  </aside>
  return <aside className="favorite-library__detail" aria-label={'\u89c6\u9891\u8be6\u60c5'} data-detail-visible="true" style={{ '--favorite-detail-width': `${width}px` } as CSSProperties}>
    <div
      className="favorite-library__detail-resize-handle"
      role="separator"
      aria-label="调整视频详情宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        dragStart.current = { clientX: event.clientX, width }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        const start = dragStart.current
        if (!start) return
        applyWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.width + start.clientX - event.clientX)), event.currentTarget)
      }}
      onPointerUp={(event) => {
        dragStart.current = undefined
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => { dragStart.current = undefined }}
      onDoubleClick={(event) => applyWidth(DEFAULT_WIDTH, event.currentTarget)}
    />
    {title ? <div className="favorite-library__detail-heading"><h2>{title}</h2><button type="button" onClick={() => onCollapse(true)}>收起详情</button></div> : null}
    {children}
  </aside>
}
