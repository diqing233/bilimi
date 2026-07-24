import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocalDataSettings } from './LocalDataSettings'

describe('LocalDataSettings', () => {
  it('shows categorized disk usage after asynchronous recalculation', async () => {
    const calculateUsage = vi.fn().mockResolvedValue({
      totalBytes: 15,
      calculatedAt: '2026-07-24T00:00:00.000Z',
      categories: { accountPersistent: { bytes: 1 }, deviceShared: { bytes: 2 }, cache: { bytes: 3 }, temporaryAudio: { bytes: 4 }, logs: { bytes: 5 } }
    })
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[]} calculateUsage={calculateUsage} onFullClear={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '重新计算' }))
    expect(await screen.findByText(/账号持久数据：1 B/)).toBeInTheDocument()
    expect(screen.getByText(/设备共享设置：2 B/)).toBeInTheDocument()
    expect(screen.getByText(/缓存：3 B/)).toBeInTheDocument()
    expect(screen.getByText(/临时音频：4 B/)).toBeInTheDocument()
    expect(screen.getByText(/日志：5 B/)).toBeInTheDocument()
  })

  it('shows account groups, async recalculation feedback, migration actions, and typed full-clear confirmation', async () => {
    const calculateUsage = vi.fn().mockResolvedValue({ totalBytes: 1024, calculatedAt: '2026-07-24T00:00:00.000Z' })
    const onFullClear = vi.fn()
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onImport = vi.fn().mockResolvedValue({ accounts: [{ uid: '100', action: 'merge' }] })
    render(<LocalDataSettings userDataPath="C:\\Users\\test\\AppData\\bilimi" accounts={[{ uid: '100', nickname: 'Display only', retained: true }]} calculateUsage={calculateUsage} onFullClear={onFullClear} onExport={onExport} onImport={onImport} />)
    expect(screen.getByText(/bilimi$/u, { selector: 'code' })).toHaveTextContent('bilimi')
    fireEvent.click(screen.getByRole('button', { name: '重新计算' }))
    expect(await screen.findByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('1 KB') === true)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('全部账户'))
    fireEvent.click(screen.getByLabelText('包含非敏感共享设置'))
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }))
    expect(await screen.findByRole('status')).toHaveTextContent('导出完成')
    expect(onExport).toHaveBeenCalledWith('all', true)
    fireEvent.click(screen.getByRole('button', { name: '导入并预览' }))
    expect(await screen.findByRole('list', { name: '导入预览' })).toHaveTextContent('100：merge')
    fireEvent.click(screen.getByRole('button', { name: '清除全部用户数据' }))
    expect(screen.getByRole('button', { name: '清除并退出' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('输入 全部清除 以确认'), { target: { value: '全部清除' } })
    fireEvent.click(screen.getByRole('button', { name: '清除并退出' }))
    expect(onFullClear).toHaveBeenCalledOnce()
  })

  it('retains an import preview token until the user explicitly chooses merge or overwrite', async () => {
    const onImport = vi.fn().mockResolvedValue({ token: 'preview-1', accounts: [{ uid: '100', action: 'merge' }, { uid: '200', action: 'new' }] })
    const onApplyImport = vi.fn().mockResolvedValue(undefined)
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[]} calculateUsage={vi.fn()} onFullClear={vi.fn()} onImport={onImport} onApplyImport={onApplyImport} />)

    fireEvent.click(screen.getByRole('button', { name: '导入并预览' }))
    expect(await screen.findByRole('list', { name: '导入预览' })).toHaveTextContent('200：new')
    fireEvent.click(screen.getByRole('button', { name: '按UID合并并保留较新记录' }))
    expect(onApplyImport).toHaveBeenCalledWith('preview-1', 'merge')
    expect(await screen.findByRole('status')).toHaveTextContent('导入完成')
    expect(screen.queryByRole('list', { name: '导入预览' })).not.toBeInTheDocument()
  })

  it('lets the user choose UIDs for selected-account export and previews non-destructive cleanup', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onPreviewCleanup = vi.fn().mockResolvedValue({ affectsBilibiliServerData: false })
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[{ uid: '100', retained: true }, { uid: '200', retained: true }]} currentAccountUid="100" calculateUsage={vi.fn()} onFullClear={vi.fn()} onExport={onExport} onPreviewCleanup={onPreviewCleanup} />)

    fireEvent.click(screen.getByLabelText('所选账户'))
    fireEvent.click(screen.getByLabelText('导出账户 100'))
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }))
    expect(onExport).toHaveBeenCalledWith('selected', false, ['100'])
    fireEvent.click(screen.getByRole('button', { name: '预览清理缓存' }))
    expect(onPreviewCleanup).toHaveBeenCalledWith('cache', undefined)
    expect(await screen.findByText('清理预览已就绪：不会修改 B 站服务器数据。')).toBeInTheDocument()
  })
})
