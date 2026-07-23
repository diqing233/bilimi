import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocalDataSettings } from './LocalDataSettings'

describe('LocalDataSettings', () => {
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
})
