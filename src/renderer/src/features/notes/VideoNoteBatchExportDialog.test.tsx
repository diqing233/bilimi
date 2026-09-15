import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoNoteBatchExportDialog } from './VideoNoteBatchExportDialog'
import type { VideoNoteBatchExportPreview, VideoNoteBatchExportProgress, VideoNoteBatchExportResult, VideoNoteBatchExportStartRequest } from '@shared/videoNoteBatchExport'

describe('VideoNoteBatchExportDialog', () => {
  it('renders as an application-centered modal and closes from Escape or the idle backdrop', async () => {
    const onClose = vi.fn()
    render(<VideoNoteBatchExportDialog open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]} preview={async () => ({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })} start={vi.fn()} cancel={vi.fn()} openFolder={vi.fn()} onClose={onClose} />)

    const dialog = await screen.findByRole('dialog', { name: '导出文稿' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('bilimi-modal__dialog', 'video-note-export-dialog')
    expect(dialog.parentElement).toHaveClass('bilimi-modal__viewport')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.pointerDown(screen.getByTestId('bilimi-modal-scrim'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('disables zero-export starts and supports both formats, cancellation, and opening a completed folder', async () => {
    const start = vi.fn().mockResolvedValue({ batchId: 'batch-1', folderPath: 'C:\\exports', succeededCount: 1, skippedCount: 1, failedCount: 0 })
    render(<VideoNoteBatchExportDialog open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]} preview={async () => ({ selectedCount: 1, exportableCount: 0, skippedCount: 1 })} start={start} cancel={vi.fn()} openFolder={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '开始导出' })).toBeDisabled()
  })

  it('only offers notes when present and resets its result when reopened', async () => {
    const props = { accountMid: '100', selections: [{ archiveId: 'a', versionId: 'v' }], preview: async () => ({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }), start: vi.fn().mockResolvedValue({ folderPath: 'C:\\exports', succeededCount: 1, skippedCount: 0, failedCount: 0 }), cancel: vi.fn(), openFolder: vi.fn() }
    const view = render(<VideoNoteBatchExportDialog open hasNotes={false} {...props} />)
    expect(screen.queryByText('包含备注')).not.toBeInTheDocument()
    view.rerender(<VideoNoteBatchExportDialog open hasNotes {...props} />)
    expect(await screen.findByText('包含备注')).toBeInTheDocument()
  })

  it('keeps both output formats, reports main-process progress, and resets choices after closing', async () => {
    let reportProgress: ((value: VideoNoteBatchExportProgress) => void) | undefined
    const preview = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    let finish: ((value: { folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }) => void) | undefined
    const openFolder = vi.fn()
    const start = vi.fn((_: VideoNoteBatchExportStartRequest) => new Promise<{ folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    const view = render(<VideoNoteBatchExportDialog open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]} preview={preview} start={start} cancel={vi.fn()} openFolder={openFolder} onClose={onClose} onProgress={(callback) => { reportProgress = callback; return () => undefined }} />)
    await screen.findByRole('button', { name: '开始导出' })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Word'))
      fireEvent.click(screen.getByLabelText('单项内容'))
    })
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ formats: ['markdown', 'word'], scope: 'current' })))
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    await screen.findByText('正在处理 0 项')
    act(() => { reportProgress?.({ batchId: String(start.mock.calls[0]?.[0]?.batchId), selectedCount: 1, completedCount: 1, succeededCount: 1, skippedCount: 0, failedCount: 0 }) })
    expect(await screen.findByText('正在处理 1 项')).toBeInTheDocument()
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ formats: ['markdown', 'word'], scope: 'current' })))
    await act(async () => { finish?.({ batchId: 'batch-1', folderPath: 'C:\\exports', succeededCount: 1, skippedCount: 0, failedCount: 0, items: [{ archiveId: 'a', versionId: 'v', title: 'Export', status: 'succeeded', files: ['C:\\exports\\Export.md'] }] } as never) })
    await screen.findByText('成功 1，跳过 0，失败 0')
    expect(screen.getByText('成功：Export')).toBeInTheDocument()
    expect(document.querySelector('.video-note-export-dialog__result-list')).toBeInTheDocument()
    const openFolderButton = screen.getByRole('button', { name: '打开文件夹' })
    expect(openFolderButton).toHaveClass('video-note-export-dialog__open-folder')
    fireEvent.click(openFolderButton)
    expect(openFolder).toHaveBeenCalledWith({ batchId: 'batch-1', accountMid: '100' })
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => { view.rerender(<VideoNoteBatchExportDialog open={false} accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]} preview={preview} start={start} cancel={vi.fn()} openFolder={vi.fn()} onProgress={(callback) => { reportProgress = callback; return () => undefined }} />) })
    await act(async () => { view.rerender(<VideoNoteBatchExportDialog open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]} preview={preview} start={start} cancel={vi.fn()} openFolder={vi.fn()} onProgress={(callback) => { reportProgress = callback; return () => undefined }} />) })
    expect(screen.getByLabelText('Markdown')).toBeChecked()
    expect(screen.getByLabelText('Word')).not.toBeChecked()
    expect(screen.getByLabelText('当前版本完整档案')).toBeChecked()
  })

  it('uses a compact single-content selector and allows notes for either export scope', async () => {
    let finish: (() => void) | undefined
    const cancel = vi.fn().mockResolvedValue(true)
    const start = vi.fn(() => new Promise<{ folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }>((resolve) => {
      finish = () => resolve({ folderPath: 'C:\\exports', succeededCount: 0, skippedCount: 0, failedCount: 0 })
    }))
    const onClose = vi.fn()
    render(<VideoNoteBatchExportDialog
      open
      accountMid="100"
      selections={[{ archiveId: 'a', versionId: 'v' }]}
      hasNotes
      initialScope="current"
      currentContent="plain"
      preview={async () => ({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })}
      start={start}
      cancel={cancel}
      openFolder={vi.fn()}
      onClose={onClose}
    />)
    expect(screen.getByLabelText('单项内容')).toBeChecked()
    expect(screen.getByLabelText('包含备注')).toBeChecked()
    const selector = screen.getByRole('button', { name: '选择导出内容' })
    expect(selector).toHaveTextContent('无时间线文稿')
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('menuitem', { name: '详细内容提要' }))
    expect(selector).toHaveTextContent('详细内容提要')
    const startButton = await screen.findByRole('button', { name: '开始导出' })
    await vi.waitFor(() => expect(startButton).toBeEnabled())
    fireEvent.click(startButton)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'current', currentContent: 'summary-outline', includeNotes: true
    }))
    const dialog = screen.getByRole('dialog', { name: '导出文稿' })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(dialog.parentElement!)
    expect(onClose).not.toHaveBeenCalled()
    const cancelButton = screen.getByRole('button', { name: '取消' })
    expect(cancelButton).toBeEnabled()
    fireEvent.click(cancelButton)
    expect(cancel).toHaveBeenCalledOnce()
    expect(await screen.findByText('正在取消…')).toBeInTheDocument()
    await act(async () => { finish?.() })
  })

  it('keeps the compact selector disabled for a complete archive and keeps all actions in one row', async () => {
    render(<VideoNoteBatchExportDialog
      open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]}
      hasNotes initialScope="complete" currentContent="timed"
      preview={async () => ({ selectedCount: 1, exportableCount: 1, skippedCount: 0, hasNotes: true })}
      start={vi.fn()} cancel={vi.fn()} openFolder={vi.fn()}
    />)

    expect(await screen.findByText('导出范围')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择导出内容' })).toBeDisabled()
    expect(screen.getByText('文件格式（可多选）')).toBeInTheDocument()
    const actions = screen.getByRole('group', { name: '导出操作' })
    expect(actions).toContainElement(screen.getByRole('button', { name: '开始导出' }))
    expect(actions).toContainElement(screen.getByRole('button', { name: '取消' }))
  })

  it('keeps one output format selected and clears preview errors when another format is chosen', async () => {
    const preview = vi.fn(async (request: { formats: string[] }) => {
      if (!request.formats.length) throw new Error('format is required')
      return { selectedCount: 1, exportableCount: 1, skippedCount: 0 }
    })
    render(<VideoNoteBatchExportDialog
      open accountMid="100" selections={[{ archiveId: 'a', versionId: 'v' }]}
      preview={preview} start={vi.fn()} cancel={vi.fn()} openFolder={vi.fn()}
    />)

    await screen.findByRole('button', { name: '开始导出' })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Markdown'))
      fireEvent.click(screen.getByLabelText('Word'))
    })

    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ formats: ['markdown', 'word'] })))
    expect(screen.getByLabelText('Markdown')).toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables Start while a replacement account preview is pending', async () => {
    let resolveInitial: ((value: { selectedCount: number; exportableCount: number; skippedCount: number }) => void) | undefined
    let resolveReplacement: ((value: { selectedCount: number; exportableCount: number; skippedCount: number }) => void) | undefined
    const preview = vi.fn((request: { accountMid: string }): Promise<VideoNoteBatchExportPreview> => request.accountMid === '100'
      ? new Promise<VideoNoteBatchExportPreview>((resolve) => { resolveInitial = resolve })
      : new Promise<VideoNoteBatchExportPreview>((resolve) => { resolveReplacement = resolve }))
    const props = { open: true, selections: [{ archiveId: 'a', versionId: 'v' }], preview, start: vi.fn(), cancel: vi.fn(), openFolder: vi.fn() }
    const view = render(<VideoNoteBatchExportDialog {...props} accountMid="100" />)

    expect(screen.getByRole('button', { name: /^\u5f00\u59cb\u5bfc\u51fa$/ })).toBeDisabled()
    await act(async () => { resolveInitial?.({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }) })
    expect(screen.getByRole('button', { name: /^\u5f00\u59cb\u5bfc\u51fa$/ })).toBeEnabled()
    view.rerender(<VideoNoteBatchExportDialog {...props} accountMid="200" />)

    expect(screen.getByRole('button', { name: /^\u5f00\u59cb\u5bfc\u51fa$/ })).toBeDisabled()
    await act(async () => { resolveReplacement?.({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }) })
    expect(screen.getByRole('button', { name: /^\u5f00\u59cb\u5bfc\u51fa$/ })).toBeEnabled()
  })
  it('discards an old-account export completion after the dialog receives a new account', async () => {
    let finishOldExport: ((value: VideoNoteBatchExportResult) => void) | undefined
    const preview = vi.fn(async () => ({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }))
    const start = vi.fn(() => new Promise<VideoNoteBatchExportResult>((resolve) => { finishOldExport = resolve }))
    const cancel = vi.fn().mockResolvedValue(true)
    const props = { open: true, selections: [{ archiveId: 'a', versionId: 'v' }], preview, start, cancel, openFolder: vi.fn() }
    const view = render(<VideoNoteBatchExportDialog {...props} accountMid="100" />)

    fireEvent.click(await screen.findByRole('button', { name: /开始导出/ }))
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    view.rerender(<VideoNoteBatchExportDialog {...props} accountMid="200" />)
    await screen.findByRole('button', { name: /开始导出/ })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ accountMid: '100' })))
    await act(async () => {
      finishOldExport?.({ batchId: 'old-batch', folderPath: 'C:\\old-account', succeededCount: 1, skippedCount: 0, failedCount: 0 })
    })

    expect(screen.queryByRole('button', { name: /打开文件夹/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始导出/ })).toBeEnabled()
  })
})
