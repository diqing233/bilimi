import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommentChooser } from './CommentChooser'

describe('CommentChooser', () => {
  it('renders readable 小咪 comment choices and sends a selected draft once', () => {
    const onSelect = vi.fn()
    render(
      <CommentChooser
        drafts={[
          '小咪替我家主人夸一句：这个视频真不错。',
          '我家主人已经点头，小咪负责盖章。',
          'UP主继续再接再厉，小咪蹲更新。'
        ]}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog', { name: '小咪推荐评论' })
    expect(dialog).toHaveClass('assistant-dialog--comment-chooser')
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /这个视频真不错/ })).toHaveClass(
      'assistant-dialog__comment-choice'
    )
    expect(screen.getByRole('button', { name: '复制第 1 条评论' })).toHaveClass(
      'assistant-dialog__comment-copy'
    )
    expect(screen.queryByRole('button', { name: '朕再想想' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '评论候选' })).toHaveClass(
      'assistant-dialog__comment-list'
    )
    expect(screen.getByRole('group', { name: '评论操作' })).toHaveClass(
      'assistant-dialog__comment-actions'
    )
    const choices = screen.getAllByRole('button', { name: /小咪|我家主人|UP主/ })
    expect(choices[0]).toHaveTextContent('小咪替我家主人夸一句：这个视频真不错。')
    expect(choices[1]).toHaveTextContent('我家主人已经点头，小咪负责盖章。')
    expect(choices[2]).toHaveTextContent('UP主继续再接再厉，小咪蹲更新。')
    expect(screen.getByRole('button', { name: '我再想想' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /这个视频真不错/ }))
    fireEvent.click(screen.getByRole('button', { name: /我家主人已经点头/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('小咪替我家主人夸一句：这个视频真不错。')
  })

  it('copies an individual comment draft without sending it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const onSelect = vi.fn()
    render(
      <CommentChooser
        drafts={['第一条弹幕评论', '第二条弹幕评论', '第三条弹幕评论']}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '复制第 2 条评论' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('第二条弹幕评论'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('已复制第 2 条评论。')
  })

  it('keeps the copy status region mounted so the cancel action does not shift after copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    render(
      <CommentChooser
        drafts={['copyable draft one', 'copyable draft two', 'copyable draft three']}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const status = screen.getByRole('status')
    const actions = screen.getByRole('group', { name: '评论操作' })

    expect(status).toHaveClass('assistant-dialog__comment-status')
    expect(status.nextElementSibling).toBe(actions)

    fireEvent.click(screen.getByRole('button', { name: '复制第 1 条评论' }))

    await waitFor(() => expect(status).toHaveTextContent('已复制第 1 条评论。'))
    expect(screen.getByRole('status')).toBe(status)
    expect(status.nextElementSibling).toBe(actions)
  })

  it('places each copy control inline after its own comment text', () => {
    render(
      <CommentChooser
        drafts={['copyable draft one', 'copyable draft two', 'copyable draft three']}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const choice = screen.getByRole('button', { name: 'copyable draft two' })
    const copy = screen.getByRole('button', { name: '复制第 2 条评论' })
    const row = choice.closest('.assistant-dialog__comment-row')

    expect(row).toContainElement(choice)
    expect(row).toContainElement(copy)
    expect(choice.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('cancels from Escape before a draft is selected', () => {
    const onCancel = vi.fn()
    render(
      <CommentChooser drafts={['第一条', '第二条', '第三条']} onSelect={vi.fn()} onCancel={onCancel} />
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
