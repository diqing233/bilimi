import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

const DEFAULT_WIDTH = 300
const MIN_WIDTH = 220
const MAX_WIDTH = 520
const KEYBOARD_WIDTH_STEP = 24
const DETAIL_WIDTH_STORAGE_KEY = 'bilimi:favorite-library-detail-width'

type MoreInformation = {
  description?: string
  tags?: string[]
  status?: 'loading' | 'missing' | 'failed'
}

function storedWidth() {
  const stored = window.localStorage.getItem(DETAIL_WIDTH_STORAGE_KEY)
  if (stored === null) return DEFAULT_WIDTH
  const value = Number(stored)
  return Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)) : DEFAULT_WIDTH
}

type FavoriteLibraryDetailProps = {
  title?: string
  author?: string
  videoId?: string
  onTitleClick?: () => void
  headerActions?: ReactNode
  moreInformation?: MoreInformation
  selected?: boolean
  onCollapse: (collapsed: boolean) => void
  collapsed?: boolean
  children?: ReactNode
}

export function FavoriteLibraryDetail({ title, author, videoId, onTitleClick, headerActions, moreInformation, selected = Boolean(title), collapsed = false, onCollapse, children }: FavoriteLibraryDetailProps) {
  const [width, setWidth] = useState(() => storedWidth())
  const [moreInformationOpen, setMoreInformationOpen] = useState(false)
  const dragStart = useRef<{ clientX: number; width: number } | undefined>(undefined)
  const selectedIdentity = videoId ?? title
  const previousSelectedIdentity = useRef(selectedIdentity)
  if (previousSelectedIdentity.current !== selectedIdentity) {
    previousSelectedIdentity.current = selectedIdentity
    if (moreInformationOpen) setMoreInformationOpen(false)
  }
  const applyWidth = (nextWidth: number, target?: HTMLElement) => {
    setWidth(nextWidth)
    window.localStorage.setItem(DETAIL_WIDTH_STORAGE_KEY, String(nextWidth))
    target?.closest<HTMLElement>('.favorite-library')?.style.setProperty('--favorite-detail-width', `${nextWidth}px`)
  }
  if (collapsed) return null
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
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          applyWidth(Math.min(MAX_WIDTH, width + KEYBOARD_WIDTH_STEP), event.currentTarget)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          applyWidth(Math.max(MIN_WIDTH, width - KEYBOARD_WIDTH_STEP), event.currentTarget)
        } else if (event.key === 'Home') {
          event.preventDefault()
          applyWidth(MIN_WIDTH, event.currentTarget)
        } else if (event.key === 'End') {
          event.preventDefault()
          applyWidth(MAX_WIDTH, event.currentTarget)
        }
      }}
    />
    {title ? <div className="favorite-library__detail-heading">
      <h2>{onTitleClick ? <button type="button" className="favorite-library__detail-title-link" aria-label={`打开视频：${title}`} onClick={onTitleClick}>{title}</button> : title}</h2>
      {(author || videoId) ? <p>UP：{author ?? '未知 UP 主'}{videoId ? ` · ${videoId}` : ''}</p> : null}
      <span className="favorite-library__detail-heading-actions">
        <span className="favorite-library__detail-heading-primary-actions">
          <button type="button" className="favorite-library__detail-collapse-action" onClick={() => onCollapse(true)}>收起详情</button>
          {headerActions}
          {moreInformation ? <button type="button" className="favorite-library__detail-more-information-action" aria-expanded={moreInformationOpen} onClick={() => setMoreInformationOpen((open) => !open)}>更多信息</button> : null}
        </span>
      </span>
      {moreInformationOpen && moreInformation ? <div className="favorite-library__detail-more-information">
        {moreInformation.status === 'loading' ? <p>正在加载更多资料…</p> : null}
        {moreInformation.status === 'missing' ? <p>暂无更多资料。</p> : null}
        {moreInformation.status === 'failed' ? <p>更多资料加载失败。</p> : null}
        {!moreInformation.status ? <>{moreInformation.description ? <p>{moreInformation.description}</p> : null}<p>标签：{moreInformation.tags?.length ? moreInformation.tags.join('、') : '暂无标签'}</p></> : null}
      </div> : null}
    </div> : null}
    {children}
  </aside>
}
