import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommentChooser } from './CommentChooser'

describe('CommentChooser', () => {
  it('renders readable Xiao Mi comment choices and sends a selected draft once', () => {
    const onSelect = vi.fn()
    render(
      <CommentChooser
        drafts={[
          '小mi替我家主人夸一句：这个视频真不错。',
          '我家主人已经点头，小mi负责盖章。',
          'UP主继续再接再厉，小mi蹲更新。'
        ]}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog', { name: '小mi推荐评论' })
    expect(dialog).toHaveClass('assistant-dialog--comment-chooser')
    expect(screen.getByText('小mi拟好三条，主人点一条就发送。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /这个视频真不错/ })).toHaveClass(
      'assistant-dialog__comment-choice'
    )

    fireEvent.click(screen.getByRole('button', { name: /这个视频真不错/ }))
    fireEvent.click(screen.getByRole('button', { name: /我家主人已经点头/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('小mi替我家主人夸一句：这个视频真不错。')
  })
})
