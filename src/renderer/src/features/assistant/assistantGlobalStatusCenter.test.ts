import { describe, expect, it } from 'vitest'
import { appendGlobalFeedbackHistory, createPersistentStatusTasks, type GlobalFeedbackHistoryItem } from './assistantGlobalStatusCenter'

describe('assistantGlobalStatusCenter', () => {
  it('keeps the newest eight transient messages and merges consecutive duplicates', () => {
    let history: GlobalFeedbackHistoryItem[] = []
    for (let index = 0; index < 9; index += 1) {
      history = appendGlobalFeedbackHistory(history, `提示 ${index}`, index)
    }
    history = appendGlobalFeedbackHistory(history, '提示 8', 10)

    expect(history).toHaveLength(8)
    expect(history[0]).toMatchObject({ message: '提示 8', count: 2, occurredAt: 10 })
    expect(history.at(-1)?.message).toBe('提示 1')
  })

  it('derives live persistent tasks from authoritative runtime state', () => {
    const tasks = createPersistentStatusTasks({
      modelProgress: { id: 'whisper-small', stage: 'downloading', percentage: 42 },
      transcription: { label: '转写 18%', detail: '视频正在转写', tone: 'running' },
      deepSeek: { label: 'DeepSeek 工作中', detail: '正在生成总结', tone: 'running' },
      ledger: { label: '整理中', detail: '正在核对收藏', tone: 'running' }
    })

    expect(tasks.map((task) => task.id)).toEqual(['model-download', 'transcription', 'deepseek', 'ledger'])
    expect(tasks[0]).toMatchObject({ label: 'Whisper small 下载中 · 42%', destination: 'transcription' })
  })

  it('uses a compact menu detail without changing the full status-light hover detail', () => {
    const tasks = createPersistentStatusTasks({
      deepSeek: {
        label: 'DeepSeek 工作中',
        detail: '完整悬浮说明',
        menuDetail: '简短下拉说明',
        tone: 'running'
      }
    })

    expect(tasks[0]?.detail).toBe('简短下拉说明')
  })

  it('does not keep completed or canceled model downloads as persistent tasks', () => {
    for (const stage of ['available', 'canceled'] as const) {
      expect(createPersistentStatusTasks({ modelProgress: { id: 'whisper-small', stage } })).toEqual([])
    }
  })

  it('keeps queued and confirmation-required warning states visible as unfinished tasks', () => {
    expect(createPersistentStatusTasks({
      transcription: { label: '转写排队 2', detail: '还有 2 个任务等待处理', tone: 'warn' },
      ledger: { label: '整理待确认', detail: '等待用户确认对账结果', tone: 'warn' }
    })).toEqual([
      { id: 'transcription', label: '转写排队 2', detail: '还有 2 个任务等待处理', destination: 'transcription' },
      { id: 'ledger', label: '整理待确认', detail: '等待用户确认对账结果', destination: 'ledger' }
    ])
  })
})
