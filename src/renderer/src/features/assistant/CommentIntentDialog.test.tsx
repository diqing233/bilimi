import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommentIntentDialog } from './CommentIntentDialog'

describe('CommentIntentDialog', () => {
  it('submits a trimmed non-empty comment intent', () => {
    const onSubmit = vi.fn()

    render(
      <CommentIntentDialog busy={false} error="" onSubmit={onSubmit} onCancel={vi.fn()} />
    )

    fireEvent.change(screen.getByLabelText('评论方向'), {
      target: { value: '  praise technical detail  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '生成评论' }))

    expect(onSubmit).toHaveBeenCalledWith('praise technical detail')
  })

  it('does not submit an empty intent', () => {
    const onSubmit = vi.fn()

    render(
      <CommentIntentDialog busy={false} error="" onSubmit={onSubmit} onCancel={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: '生成评论' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels and shows errors accessibly', () => {
    const onCancel = vi.fn()

    render(
      <CommentIntentDialog
        busy={false}
        error="DeepSeek failed."
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('DeepSeek failed.')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('traps focus, closes with Escape, and restores the trigger focus', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const onCancel = vi.fn()
    const { unmount } = render(
      <CommentIntentDialog busy={false} error="" onSubmit={vi.fn()} onCancel={onCancel} />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('评论方向')).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
