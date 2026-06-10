import { describe, expect, it } from 'vitest'
import { runNoteFallbackFlow } from './noteFallbackFlow'

describe('runNoteFallbackFlow', () => {
  it('asks for manual supplement when video document detection fails and page material is sparse', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })

    expect(result.mode).toBe('needs_manual_input')
    if (result.mode !== 'needs_manual_input') {
      throw new Error('Expected manual input prompt')
    }
    expect(result.prompt).toEqual({
      title: '未识得视频文档',
      message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。',
      acceptedMaterials: ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
    })
  })

  it('returns fresh manual prompt objects for repeated sparse-material calls', () => {
    const first = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })
    const second = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })

    expect(first.mode).toBe('needs_manual_input')
    expect(second.mode).toBe('needs_manual_input')
    if (first.mode !== 'needs_manual_input' || second.mode !== 'needs_manual_input') {
      throw new Error('Expected manual input prompts')
    }
    expect(first.prompt).not.toBe(second.prompt)
    expect(first.prompt.acceptedMaterials).not.toBe(second.prompt.acceptedMaterials)
  })

  it('summarizes directly when automatic page material is sufficient', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '如何高效背单词',
        transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法。最后用输出巩固记忆。',
        tags: ['学习', '英语']
      }
    })

    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据页面材料拟札')
    expect(result.summary.keyPoints).toHaveLength(3)
  })

  it('uses manual supplement after automatic material is insufficient', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '数据库索引入门',
        url: 'https://www.bilibili.com/video/BV1db'
      },
      manualSupplement: '视频主要讲 B+ 树索引、联合索引和回表成本。最后提醒不要滥建索引。'
    })

    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据补充材料拟札')
    expect(result.summary.oneSentence).toContain('B+ 树索引')
  })

  it('creates a limited summary from short descriptions without a structured document', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '阅读习惯',
        description: '分享三个帮助保持阅读节奏的小方法。'
      }
    })

    expect(result.detection.status).toBe('not_found')
    expect(result.assessment.quality).toBe('partial')
    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.status).toBe('limited')
  })

  it('keeps low-confidence detection in the fallback path', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '课程复盘方法',
        description:
          '本期围绕课程复盘展开，先说明为什么看完课程后容易遗忘，再介绍如何用章节标题、问题清单和输出练习保留重点。中段示范把课程内容拆成概念、例子、行动三栏，并用隔日回看确认是否真正理解。结尾提醒复盘不是重看一遍，而是确认自己能否用自己的话讲清楚，并把下次实践写成可执行清单。'
      }
    })

    expect(result.detection.status).toBe('low_confidence')
    expect(result.assessment.quality).toBe('sufficient')
    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据页面材料拟札')
  })
})
