import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocalDataSettings } from './LocalDataSettings'

describe('LocalDataSettings', () => {
  it('shows account groups, async recalculation feedback, migration actions, and typed full-clear confirmation', async () => {
    const calculateUsage = vi.fn().mockResolvedValue({ totalBytes: 1024, calculatedAt: '2026-07-24T00:00:00.000Z' })
    const onFullClear = vi.fn()
    render(<LocalDataSettings userDataPath="C:\\Users\\test\\AppData\\bilimi" accounts={[{ uid: '100', nickname: 'Display only', retained: true }]} calculateUsage={calculateUsage} onFullClear={onFullClear} />)
    expect(screen.getByText(/bilimi$/u, { selector: 'code' })).toHaveTextContent('bilimi')
    fireEvent.click(screen.getByRole('button', { name: '重新计算' }))
    expect(await screen.findByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('1 KB') === true)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除全部用户数据' }))
    expect(screen.getByRole('button', { name: '清除并退出' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('输入 全部清除 以确认'), { target: { value: '全部清除' } })
    fireEvent.click(screen.getByRole('button', { name: '清除并退出' }))
    expect(onFullClear).toHaveBeenCalledOnce()
  })
})
