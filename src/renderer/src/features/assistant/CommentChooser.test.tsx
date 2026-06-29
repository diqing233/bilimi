import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.queryByRole('button', { name: '朕再想想' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '评论候选' })).toHaveClass(
      'assistant-dialog__comment-list'
    )
    expect(screen.getByRole('group', { name: '评论操作' })).toHaveClass(
      'assistant-dialog__comment-actions'
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('小咪替我家主人夸一句：这个视频真不错。')
    expect(buttons[1]).toHaveTextContent('我家主人已经点头，小咪负责盖章。')
    expect(buttons[2]).toHaveTextContent('UP主继续再接再厉，小咪蹲更新。')
    expect(buttons[3]).toHaveTextContent('我再想想')

    fireEvent.click(screen.getByRole('button', { name: /这个视频真不错/ }))
    fireEvent.click(screen.getByRole('button', { name: /我家主人已经点头/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('小咪替我家主人夸一句：这个视频真不错。')
  })

  it('cancels from Escape before a draft is selected', () => {
    const onCancel = vi.fn()
    render(
      <CommentChooser
        drafts={['第一条', '第二条', '第三条']}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
