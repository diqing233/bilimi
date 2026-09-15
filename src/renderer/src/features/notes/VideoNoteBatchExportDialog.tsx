import { useEffect, useRef, useState } from 'react'
import { BilimiModal } from '../../components/BilimiModal'
import { useExclusiveMenu } from '../../components/useExclusiveMenu'
import { formatUserVisibleErrorMessage } from '../assistant/userVisibleErrorMessage'
import type {
  VideoNoteBatchArchiveSelection,
  VideoNoteBatchExportPreview,
  VideoNoteBatchExportProgress,
  VideoNoteBatchExportRequest,
  VideoNoteBatchExportResult,
  VideoNoteBatchExportStartRequest,
  VideoNoteBatchExportCurrentContent,
  VideoNoteBatchFolderRequest
} from '@shared/videoNoteBatchExport'

type Selection = VideoNoteBatchArchiveSelection
type Preview = VideoNoteBatchExportPreview
type Result = VideoNoteBatchExportResult

export function VideoNoteBatchExportDialog({ open, accountMid, selections, hasNotes = false, initialSkippedCount = 0, initialScope = 'complete', initialFormats = ['markdown'], currentContent, onClose, preview, start, cancel, openFolder, onProgress }: {
  open: boolean
  accountMid: string
  selections: Selection[]
  hasNotes?: boolean
  initialSkippedCount?: number
  initialScope?: 'current' | 'complete'
  initialFormats?: Array<'markdown' | 'word'>
  currentContent?: VideoNoteBatchExportCurrentContent
  onClose?: () => void
  preview: (request: VideoNoteBatchExportRequest) => Promise<Preview>
  start: (request: VideoNoteBatchExportStartRequest) => Promise<Result | undefined>
  cancel: (input: { batchId: string; accountMid: string }) => Promise<boolean>
  openFolder: (input: VideoNoteBatchFolderRequest) => Promise<string | undefined>
  onProgress?: (callback: (value: VideoNoteBatchExportProgress) => void) => () => void
}) {
  const [formats, setFormats] = useState<Array<'markdown' | 'word'>>(initialFormats)
  const [scope, setScope] = useState<'current' | 'complete'>(initialScope)
  const [selectedContent, setSelectedContent] = useState<VideoNoteBatchExportCurrentContent>(currentContent ?? 'plain')
  const [contentMenuOpen, setContentMenuOpen, contentMenuScope] = useExclusiveMenu()
  const [includeNotes, setIncludeNotes] = useState(hasNotes)
  const [summary, setSummary] = useState<Preview>()
  const [result, setResult] = useState<Result>()
  const [exporting, setExporting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [completedCount, setCompletedCount] = useState(0)
  const wasOpen = useRef(false)
  const activeBatchIdRef = useRef<string | undefined>(undefined)
  const previewRequestRef = useRef(0)
  const exportRunRef = useRef(0)
  const activeAccountMidRef = useRef(accountMid)

  const request: VideoNoteBatchExportRequest = {
    accountMid,
    selections,
    formats,
    scope,
    ...(scope === 'current' ? { currentContent: selectedContent } : {}),
    includeNotes
  }

  useEffect(() => {
    if (open && !wasOpen.current) {
      setFormats(initialFormats)
      setScope(initialScope)
      setSelectedContent(currentContent ?? 'plain')
      setContentMenuOpen(false)
      setIncludeNotes(hasNotes)
      setSummary(undefined)
      setResult(undefined)
      setExporting(false)
      setCancelling(false)
      setError(undefined)
      setCompletedCount(0)
    }
    wasOpen.current = open
  }, [currentContent, hasNotes, initialFormats, initialScope, open])

  useEffect(() => {
    if (!open) {
      previewRequestRef.current += 1
      return
    }
    setResult(undefined)
    setSummary(undefined)
    if (!selections.length) {
      // Empty identities are local skipped queue work; IPC deliberately rejects them.
      setSummary({ selectedCount: 0, exportableCount: 0, skippedCount: 0 })
      setError(undefined)
      return
    }
    const previewRequest = ++previewRequestRef.current
    void preview(request).then((nextSummary) => {
      if (previewRequest !== previewRequestRef.current) return
      setSummary(nextSummary)
      setError(undefined)
    }).catch((reason: unknown) => {
      if (previewRequest === previewRequestRef.current) setError(formatUserVisibleErrorMessage(reason, '无法读取导出内容，请重试。'))
    })
  }, [open, accountMid, selections, formats, scope, selectedContent, includeNotes])

  useEffect(() => {
    if (activeAccountMidRef.current === accountMid) return
    const previousAccountMid = activeAccountMidRef.current
    const activeBatchId = activeBatchIdRef.current
    activeAccountMidRef.current = accountMid
    exportRunRef.current += 1
    activeBatchIdRef.current = undefined
    setExporting(false)
    setCancelling(false)
    setResult(undefined)
    setSummary(undefined)
    setError(undefined)
    setCompletedCount(0)
    if (activeBatchId) void cancel({ batchId: activeBatchId, accountMid: previousAccountMid }).catch(() => undefined)
  }, [accountMid, cancel])

  useEffect(() => open && onProgress ? onProgress((value) => {
    if (value.batchId === activeBatchIdRef.current) setCompletedCount(value.completedCount)
  }) : undefined, [open, onProgress])

  if (!open) return null

  const toggle = (format: 'markdown' | 'word') => setFormats((current) => current.includes(format)
    ? current.length === 1 ? current : current.filter((value) => value !== format)
    : [...current, format])

  const contentOptions: Array<{ value?: VideoNoteBatchExportCurrentContent; label?: string }> = [
    { value: 'plain', label: '无时间线文稿' },
    { value: 'timed', label: '带时间线文稿' },
    { value: 'summary', label: 'DeepSeek 总结全文' },
    {},
    { value: 'summary-precise', label: '精准总结' },
    { value: 'summary-outline', label: '详细内容提要' },
    { value: 'summary-polished', label: '精修文稿' }
  ]
  const selectedContentLabel = contentOptions.find((option) => option.value === selectedContent)?.label ?? '无时间线文稿'

  const begin = () => {
    const batchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    const exportRun = ++exportRunRef.current
    activeBatchIdRef.current = batchId
    setExporting(true)
    setCancelling(false)
    setError(undefined)
    setCompletedCount(0)
    void start({ ...request, batchId }).then((nextResult) => {
      if (exportRun === exportRunRef.current) setResult(nextResult)
    }).catch((reason: unknown) => {
      if (exportRun === exportRunRef.current) setError(formatUserVisibleErrorMessage(reason, '导出失败，请重试。'))
    }).finally(() => {
      if (exportRun === exportRunRef.current) setExporting(false)
    })
  }

  const requestCancel = () => {
    const batchId = activeBatchIdRef.current
    if (!batchId) return
    setCancelling(true)
    void cancel({ batchId, accountMid }).then((canceled) => {
      if (!canceled) {
        setCancelling(false)
        setError('导出已经结束，无法取消。')
      }
    }).catch(() => {
      setCancelling(false)
      setError('无法取消导出，请重试。')
    })
  }

  return <BilimiModal title="导出文稿" busy={exporting} onClose={onClose} className="video-note-export-dialog" actionsLabel="导出操作" actions={<>
      <button type="button" data-variant="primary" disabled={exporting || Boolean(result) || !formats.length || !summary?.exportableCount} onClick={begin}>开始导出</button>
      <button type="button" disabled={!exporting || cancelling} onClick={requestCancel}>取消</button>
    </>}>
    <p className="video-note-export-dialog__summary">{`已选 ${((summary?.selectedCount ?? selections.length) + initialSkippedCount)} 项，可导出 ${summary?.exportableCount ?? 0} 项，跳过 ${(summary?.skippedCount ?? 0) + initialSkippedCount} 项`}</p>
    <section className="video-note-export-dialog__section" aria-labelledby="video-note-export-scope-title">
      <strong id="video-note-export-scope-title">导出范围</strong>
      <div className="video-note-export-dialog__scope-row">
        <label><input aria-label="单项内容" type="radio" checked={scope === 'current'} onChange={() => setScope('current')} />单项内容</label>
        <div {...contentMenuScope} className="video-note-export-dialog__content-picker">
          <button type="button" aria-label="选择导出内容" aria-haspopup="menu" aria-expanded={contentMenuOpen} disabled={scope !== 'current'} onClick={() => setContentMenuOpen((value) => !value)}>{selectedContentLabel}<span aria-hidden="true">▾</span></button>
          {contentMenuOpen && scope === 'current' ? <div role="menu" aria-label="单项导出内容" className="video-note-export-dialog__content-menu">
            {contentOptions.map((option, index) => option.value ? <button key={option.value} type="button" role="menuitem" onClick={() => { setSelectedContent(option.value!); setContentMenuOpen(false) }}>{option.label}</button> : <hr key={`divider-${index}`} />)}
          </div> : null}
        </div>
      </div>
      <label><input type="radio" checked={scope === 'complete'} onChange={() => { setScope('complete'); setContentMenuOpen(false) }} />当前版本完整档案</label>
      {(summary?.hasNotes ?? hasNotes) ? <label><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.currentTarget.checked)} />包含备注</label> : <label className="video-note-export-dialog__disabled-option" title="当前档案没有备注"><input type="checkbox" checked={false} readOnly disabled />包含备注（暂无）</label>}
    </section>
    <hr className="video-note-export-dialog__divider" />
    <section className="video-note-export-dialog__section" aria-labelledby="video-note-export-format-title">
      <strong id="video-note-export-format-title">文件格式（可多选）</strong>
      <div className="video-note-export-dialog__format-row">
        <label><input type="checkbox" checked={formats.includes('markdown')} onChange={() => toggle('markdown')} />Markdown</label>
        <label><input type="checkbox" checked={formats.includes('word')} onChange={() => toggle('word')} />Word</label>
      </div>
    </section>
    {error ? <p role="alert">{error}</p> : null}
    {!result ? <>
      {exporting ? <p>{cancelling ? '正在取消…' : `正在处理 ${completedCount} 项`}</p> : null}
    </> : <>
      <p>{`${result.canceled ? '已取消；' : ''}成功 ${result.succeededCount}，跳过 ${result.skippedCount}，失败 ${result.failedCount}`}</p>
      {result.items?.length ? <div className="video-note-export-dialog__result-list">{result.items.map((item) => <p key={`${item.archiveId}:${item.versionId}`}>{`${item.status === 'succeeded' ? '成功' : item.status === 'skipped' ? '跳过' : item.status === 'canceled' ? '已取消' : '失败'}：${item.title ?? item.archiveId}${item.error ? ` - ${formatUserVisibleErrorMessage(new Error(item.error), '导出失败，请重试。')}` : ''}`}</p>)}</div> : null}
      {result.batchId && result.folderPath ? <button type="button" className="video-note-export-dialog__open-folder" onClick={() => void openFolder({ batchId: result.batchId!, accountMid })}>打开文件夹</button> : null}
    </>}
  </BilimiModal>
}
