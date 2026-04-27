import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantOverlay } from './AssistantOverlay'

describe('AssistantOverlay', () => {
  it('opens the memorial panel from the folded seal', () => {
    render(<AssistantOverlay />)

    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText('赏')).toBeInTheDocument()
    expect(screen.getByText('藏')).toBeInTheDocument()
    expect(screen.getByText('赐')).toBeInTheDocument()
    expect(screen.getByText('表')).toBeInTheDocument()
    expect(screen.getByText('阅')).toBeInTheDocument()
  })

  it('asks for coin count before executing 赐', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['like', 'favorite', 'coin:2'],
      missingTargets: [],
      message: '厚赐已成。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赐' }))

    expect(screen.getByText('陛下意欲赐几枚铜钱？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赐两枚' }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"coinCount":2')
    expect(onRecordFeedback).toHaveBeenCalledWith('funny', '赐')
  })

  it('shows progress and result feedback after an action runs', async () => {
    let resolveRunScript: (value: {
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }) => void
    const runScript = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRunScript = resolve
        })
    )

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    expect(screen.getByRole('status')).toHaveTextContent('正在代批')

    resolveRunScript!({
      ok: true,
      steps: ['like', 'favorite'],
      missingTargets: [],
      message: '轻赏已入内库。'
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('轻赏已入内库。'))
  })

  it('lets the user confirm create-and-favorite without triggering a like action', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:create-defaults', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已创建并收藏。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '藏' }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"action":"藏"')
    expect(runScript.mock.calls[0][0]).not.toContain('"action":"赏"')
    expect(onRecordFeedback).toHaveBeenCalledWith('funny', '藏')
  })

  it('classifies the current video content before choosing a Bilimi favorite folder', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已按内容归入内库。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
        videoContentContext={{
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '藏' }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"recommendationKind":"knowledge"')
    expect(onRecordFeedback).toHaveBeenCalledWith('knowledge', '藏')
  })

  it('minimizes the panel while page automation is running', async () => {
    const runScript = vi.fn(
      () =>
        new Promise<{
          ok: boolean
          steps: string[]
          missingTargets: string[]
          message: string
        }>(() => {})
    )

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    expect(screen.queryByLabelText('案头奏折')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开助手状态' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在代批')
  })

  it('keeps the panel open and explains missing targets when an action cannot finish', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['like'],
      missingTargets: ['favorite'],
      message: '尚有 favorite 未能寻见。'
    })

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('尚有 favorite 未能寻见。'))
    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
  })

  it('asks the user to choose one memorial-style comment before 表 sends', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['comment:fill', 'comment:submit'],
      missingTargets: [],
      message: '拟表已递。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '表' }))

    const draft = '臣不敢独享《早八生存实录》这点笑意，特备薄礼，恭呈御览。'

    expect(screen.getByText('臣已拟好三条，请陛下择其一。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: draft }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain(draft)
    expect(onRecordFeedback).toHaveBeenCalledWith('funny', '表')
  })
})
