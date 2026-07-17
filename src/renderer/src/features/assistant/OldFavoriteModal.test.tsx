import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteModal } from './OldFavoriteModal'

describe('OldFavoriteModal', () => {
  it('portals to the app viewport, focuses cancel, locks scroll, and restores focus and scroll', () => {
    const onCancel = vi.fn()
    const opener = document.createElement('button')
    opener.textContent = 'open'
    document.body.append(opener)
    opener.focus()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    const { unmount } = render(
      <div data-testid="nested-host">
        <OldFavoriteModal title="确认重置" onCancel={onCancel} danger>
          <p>不会修改 B 站。</p>
        </OldFavoriteModal>
      </div>
    )

    const dialog = screen.getByRole('alertdialog', { name: '确认重置' })
    expect(dialog.parentElement).toHaveClass('old-favorite-modal__viewport')
    expect(dialog.closest('[data-testid="nested-host"]')).toBeNull()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    unmount()

    expect(opener).toHaveFocus()
    expect(document.documentElement.style.overflow).toBe('')
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
    opener.remove()
  })

  it('does not confirm a dangerous action through the scrim', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <OldFavoriteModal title="结束补取" onCancel={onCancel} onConfirm={onConfirm} danger>
        <p>使用当前结果。</p>
      </OldFavoriteModal>
    )

    fireEvent.click(screen.getByTestId('old-favorite-modal-scrim'))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps an invalid confirmation disabled', () => {
    const onConfirm = vi.fn()
    render(
      <OldFavoriteModal
        title="确认执行"
        onCancel={() => undefined}
        onConfirm={onConfirm}
        confirmDisabled
      >
        <p>目标无效。</p>
      </OldFavoriteModal>
    )

    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
