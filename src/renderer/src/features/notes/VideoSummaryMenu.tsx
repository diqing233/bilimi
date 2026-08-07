import { useEffect, useRef, useState } from 'react'
import { useExclusiveMenu } from '../../components/useExclusiveMenu'

export type VideoSummaryMenuAction = {
  id: string
  label: string
  disabled?: boolean
  onSelect: () => void
}

export type VideoSummaryDownload = {
  disabled?: boolean
  onSelect: () => void
}

export function VideoSummaryMenu({ actions, download, disabled = false, disabledTitle }: {
  actions: VideoSummaryMenuAction[]
  download?: VideoSummaryDownload
  disabled?: boolean
  disabledTitle?: string
}) {
  const [open, setOpen, menuScope] = useExclusiveMenu()
  const rootRef = useRef<HTMLSpanElement>(null)
  const close = () => setOpen(false)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close() }
    const keydown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown) }
  }, [open])
  return <span {...menuScope} ref={rootRef} className="video-summary-menu">
    <button type="button" className="video-summary-menu__trigger" aria-label="视频总结" aria-expanded={open} disabled={disabled} title={disabled ? disabledTitle : undefined} onClick={() => setOpen((current) => !current)}>视频总结 <span aria-hidden="true">▾</span></button>
    {open ? <div role="menu" aria-label="视频总结菜单" className="video-summary-menu__options">
      {actions.map((action) => <button key={action.id} type="button" role="menuitem" disabled={action.disabled} onClick={() => { close(); action.onSelect() }}>{action.label}</button>)}
      {download ? <button type="button" role="menuitem" disabled={download.disabled} onClick={() => { close(); download.onSelect() }}>导出文稿</button> : null}
    </div> : null}
  </span>
}
