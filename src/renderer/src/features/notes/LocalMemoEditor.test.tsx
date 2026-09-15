import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocalMemoEditor } from './LocalMemoEditor'

describe('LocalMemoEditor', () => {
  it('keeps typing local and commits the latest text on blur', () => {
    const onCommit = vi.fn()
    const onParentRender = vi.fn()
    function Parent() {
      onParentRender()
      return <LocalMemoEditor identity="version-1" value="旧备注" onCommit={onCommit} />
    }
    render(<Parent />)
    const textarea = screen.getByRole('textbox')
    const parentRendersBeforeTyping = onParentRender.mock.calls.length

    fireEvent.change(textarea, { target: { value: '新的本地备注' } })

    expect(textarea).toHaveValue('新的本地备注')
    expect(onParentRender).toHaveBeenCalledTimes(parentRendersBeforeTyping)
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.blur(textarea)
    expect(onCommit).toHaveBeenCalledWith('新的本地备注')
  })

  it('resets the draft when the selected version changes', () => {
    const { rerender } = render(<LocalMemoEditor identity="version-1" value="第一版" onCommit={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未保存输入' } })

    rerender(<LocalMemoEditor identity="version-2" value="第二版" onCommit={vi.fn()} />)

    expect(screen.getByRole('textbox')).toHaveValue('第二版')
  })
})
