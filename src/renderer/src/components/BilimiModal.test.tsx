import { fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: '关闭弹窗' })).toHaveFocus()
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

  it('keeps scrolling locked until the final overlapping dialog closes', () => {
    const first = render(
      <BilimiModal title="第一层确认" actions={<button type="button">确认</button>}>
        <p>第一层内容。</p>
      </BilimiModal>
    )
    const second = render(
      <BilimiModal title="第二层确认" actions={<button type="button">确认</button>}>
        <p>第二层内容。</p>
      </BilimiModal>
    )

    expect(document.documentElement.style.overflow).toBe('hidden')
    first.unmount()
    expect(document.documentElement.style.overflow).toBe('hidden')
    second.unmount()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('uses the header close button for the same cancellable close path', () => {
    const onClose = vi.fn()
    render(
      <BilimiModal title="确认操作" onClose={onClose} actions={<button type="button">确认</button>}>
        <p>内容</p>
      </BilimiModal>
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the visible title as the dialog heading when an explicit accessible label is required', () => {
    render(
      <BilimiModal title="确认下载 Whisper small" ariaLabel="确认下载模型" onClose={vi.fn()} actions={<button type="button">确认下载</button>}>
        <p>下载说明。</p>
      </BilimiModal>
    )

    const dialog = screen.getByRole('dialog', { name: '确认下载模型' })
    expect(dialog).toHaveAttribute('aria-label', '确认下载模型')
    expect(dialog).not.toHaveAttribute('aria-labelledby')
    expect(within(dialog).getByRole('heading', { name: '确认下载 Whisper small' })).toBeInTheDocument()
  })

  it('disables the header close button while busy', () => {
    const onClose = vi.fn()
    render(
      <BilimiModal title="正在处理" busy onClose={onClose} actions={<button type="button">确认</button>}>
        <p>内容</p>
      </BilimiModal>
    )

    const close = screen.getByRole('button', { name: '关闭弹窗' })
    expect(close).toBeDisabled()
    fireEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })

})
