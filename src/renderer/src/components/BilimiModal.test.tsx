import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BilimiModal } from './BilimiModal'

describe('BilimiModal', () => {
  it('portals a themed danger dialog, traps focus, and restores the opener', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    opener.textContent = 'open'
    document.body.append(opener)
    opener.focus()

    const view = render(
      <BilimiModal
        title="确认删除？"
        tone="danger"
        onClose={onClose}
        actions={<><button type="button">取消</button><button type="button" data-variant="danger">确认删除</button></>}
      >
        <p>删除后无法撤销。</p>
      </BilimiModal>
    )

    const dialog = screen.getByRole('alertdialog', { name: '确认删除？' })
    expect(dialog).toHaveClass('bilimi-modal__dialog')
    expect(dialog.parentElement).toBe(document.body.lastElementChild)
    expect(dialog).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    view.unmount()
    expect(opener).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('')
    opener.remove()
  })

  it('does not close a busy dialog from Escape or its scrim', () => {
    const onClose = vi.fn()
    render(
      <BilimiModal title="正在处理" busy onClose={onClose} actions={<button type="button">关闭</button>}>
        <p>请稍候。</p>
      </BilimiModal>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(screen.getByTestId('bilimi-modal-scrim'))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '正在处理' })).toHaveAttribute('aria-busy', 'true')
  })

})
