import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocalDataSettings } from './LocalDataSettings'

describe('LocalDataSettings', () => {
  it('groups local storage, migration, and destructive controls without exposing every account by default', () => {
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[{ uid: '100', nickname: '小咪', retained: true }, { uid: '200', retained: true }]} calculateUsage={vi.fn()} onFullClear={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '本地数据' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数据迁移' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '管理数据' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '危险操作' })).not.toBeInTheDocument()
    expect(screen.getByText('本机保存 2 个账号的数据')).toBeInTheDocument()
    expect(screen.queryByText('200')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看账号列表' }))
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('shows categorized disk usage after asynchronous recalculation', async () => {
    const calculateUsage = vi.fn().mockResolvedValue({
      totalBytes: 15,
      calculatedAt: '2026-07-24T00:00:00.000Z',
      categories: { accountPersistent: { bytes: 1 }, deviceShared: { bytes: 2 }, cache: { bytes: 3 }, temporaryAudio: { bytes: 4 }, logs: { bytes: 5 } }
    })
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[]} calculateUsage={calculateUsage} onFullClear={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '重新计算' }))
    expect(await screen.findByText(/账号持久数据：0\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/设备共享设置：0\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/缓存：0\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/临时音频：0\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/日志：0\.0 MB/)).toBeInTheDocument()
  })

  it('shows account groups, async recalculation feedback, migration actions, and confirmed local deletion', async () => {
    const calculateUsage = vi.fn().mockResolvedValue({ totalBytes: 1024, calculatedAt: '2026-07-24T00:00:00.000Z' })
    const onFullClear = vi.fn()
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onImport = vi.fn().mockResolvedValue({ accounts: [{ uid: '100', action: 'merge' }] })
    render(<LocalDataSettings userDataPath="C:\\Users\\test\\AppData\\bilimi" accounts={[{ uid: '100', nickname: 'Display only', retained: true }]} calculateUsage={calculateUsage} onFullClear={onFullClear} onExport={onExport} onImport={onImport} />)
    expect(screen.getByText(/bilimi$/u, { selector: 'code' })).toHaveTextContent('bilimi')
    fireEvent.click(screen.getByRole('button', { name: '重新计算' }))
    expect(await screen.findByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('0.0 MB') === true)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('全部账号'))
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }))
    expect(await screen.findByRole('status')).toHaveTextContent('导出完成')
    expect(onExport).toHaveBeenCalledWith('all')
    fireEvent.click(screen.getByRole('button', { name: '导入并预览' }))
    expect(await screen.findByRole('list', { name: '导入预览' })).toHaveTextContent('100：merge')
    fireEvent.click(screen.getByRole('button', { name: '管理数据' }))
    expect(screen.queryByLabelText('包含非敏感共享设置')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除全部用户数据' }))
    expect(screen.getByRole('alertdialog', { name: '确认清除全部本地数据' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认清除全部本地数据' }))
    expect(onFullClear).toHaveBeenCalledOnce()
  })

  it('retains an import preview token until the user explicitly chooses merge or overwrite', async () => {
    const onImport = vi.fn().mockResolvedValue({ token: 'preview-1', accounts: [{ uid: '100', action: 'merge' }, { uid: '200', action: 'new' }] })
    const onApplyImport = vi.fn().mockResolvedValue(undefined)
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[]} calculateUsage={vi.fn()} onFullClear={vi.fn()} onImport={onImport} onApplyImport={onApplyImport} />)

    fireEvent.click(screen.getByRole('button', { name: '导入并预览' }))
    expect(await screen.findByRole('list', { name: '导入预览' })).toHaveTextContent('200：new')
    fireEvent.click(screen.getByRole('button', { name: '按 UID 合并并保留较新记录' }))
    expect(onApplyImport).toHaveBeenCalledWith('preview-1', 'merge')
    expect(await screen.findByRole('status')).toHaveTextContent('导入完成')
    expect(screen.queryByRole('list', { name: '导入预览' })).not.toBeInTheDocument()
  })

  it('lets the user choose account data for export and previews non-destructive cleanup', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onPreviewCleanup = vi.fn().mockResolvedValue({ affectsBilibiliServerData: false, releasableBytes: 2 * 1024 * 1024 })
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[{ uid: '100', nickname: '小咪', retained: true }, { uid: '200', retained: true }]} currentAccountUid="100" calculateUsage={vi.fn()} onFullClear={vi.fn()} onExport={onExport} onPreviewCleanup={onPreviewCleanup} />)

    fireEvent.click(screen.getByLabelText('所选账号'))
    fireEvent.click(screen.getByLabelText('导出账号 小咪（100）'))
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }))
    expect(onExport).toHaveBeenCalledWith('selected', ['100'])
    fireEvent.click(screen.getByRole('button', { name: '管理数据' }))
    fireEvent.click(screen.getByRole('button', { name: '预览清理缓存' }))
    expect(onPreviewCleanup).toHaveBeenCalledWith('cache', undefined)
    expect(await screen.findByText('预计释放 2.0 MB；不会修改 B 站服务器数据。')).toBeInTheDocument()
  })

  it('uses a confirmation dialog before removing the current account local data', async () => {
    const onApplyCleanup = vi.fn().mockResolvedValue(undefined)
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[{ uid: '100', nickname: '小咪', retained: true }]} currentAccountUid="100" calculateUsage={vi.fn()} onFullClear={vi.fn()} onApplyCleanup={onApplyCleanup} />)

    fireEvent.click(screen.getByRole('button', { name: '管理数据' }))
    fireEvent.click(screen.getByRole('button', { name: '删除当前账号本地数据' }))
    expect(screen.getByRole('alertdialog', { name: '确认删除当前账号本地数据' })).toHaveTextContent('小咪（100）')
    fireEvent.click(screen.getByRole('button', { name: '确认删除当前账号本地数据' }))

    await waitFor(() => expect(onApplyCleanup).toHaveBeenCalledWith('current-account-data', '100'))
  })

  it('requires a cleanup preview before applying the selected local cleanup', async () => {
    const onPreviewCleanup = vi.fn().mockResolvedValue({ affectsBilibiliServerData: false, releasableBytes: 2 * 1024 * 1024 })
    const onApplyCleanup = vi.fn().mockResolvedValue(undefined)
    render(<LocalDataSettings userDataPath="C:\\data" accounts={[]} currentAccountUid="100" calculateUsage={vi.fn()} onFullClear={vi.fn()} onPreviewCleanup={onPreviewCleanup} onApplyCleanup={onApplyCleanup} />)

    expect(screen.queryByRole('button', { name: '执行清理缓存' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理数据' }))
    fireEvent.click(screen.getByRole('button', { name: '预览清理缓存' }))
    expect(await screen.findByRole('button', { name: '执行清理缓存' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '执行清理缓存' }))

    await waitFor(() => expect(onApplyCleanup).toHaveBeenCalledWith('cache', undefined))
  })
})
