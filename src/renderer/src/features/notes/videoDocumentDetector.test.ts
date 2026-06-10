import { describe, expect, it } from 'vitest'
import { detectVideoDocument } from './videoDocumentDetector'

describe('detectVideoDocument', () => {
  it('returns found when structured document text exists', () => {
    const result = detectVideoDocument({
      title: '机器学习入门',
      structuredDocumentText: '这是完整的视频文档，包含课程目标、章节梳理和示例说明。'
    })

    expect(result).toEqual({
      status: 'found',
      confidence: 0.95,
      reason: 'structured_document_detected',
      documentText: '这是完整的视频文档，包含课程目标、章节梳理和示例说明。'
    })
  })

  it('returns low_confidence when transcript-like material exists without a structured document', () => {
    const result = detectVideoDocument({
      title: '读书方法分享',
      transcriptText: '第一部分先讲如何选书。第二部分讲如何做摘录。第三部分讲如何复盘。'
    })

    expect(result.status).toBe('low_confidence')
    expect(result.confidence).toBe(0.5)
    expect(result.reason).toBe('partial_material_detected')
  })

  it('returns not_found when only sparse metadata exists', () => {
    const result = detectVideoDocument({
      title: '今日随看',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD'
    })

    expect(result).toEqual({
      status: 'not_found',
      confidence: 0,
      reason: 'no_structured_video_document'
    })
  })
})
