import { describe, expect, it, vi } from 'vitest'
import { buildSenseVoiceArgs, mapSenseVoiceOutputToSegments, transcribeAudioSegmentWithSenseVoice } from './senseVoice'

describe('SenseVoice provider', () => {
  it('removes control tokens while preserving spoken Mandarin, English, numbers, repetitions, and timestamps', () => {
    expect(mapSenseVoiceOutputToSegments({ segments: [
      { start: 1.5, end: 3, text: '<|zh|><|happy|>嗯 iPhone 15，15 很好用<|Speech|>' },
      { start: 4, end: 5, text: '<|en|>battery health 90%<|Speech|>' }
    ] }, 10)).toEqual([
      { start: 11.5, end: 13, text: '嗯 iPhone 15，15 很好用' },
      { start: 14, end: 15, text: 'battery health 90%' }
    ])
  })

  it('runs the official sherpa-onnx offline executable as a controlled process', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: `diagnostic\n${JSON.stringify({ text: '<|zh|>你好<|Speech|>', timestamps: [0, 1] })}`, stderr: '' })
    await expect(transcribeAudioSegmentWithSenseVoice({ path: 'audio.wav', offsetSeconds: 0, helperPath: 'sherpa-onnx-offline.exe', modelDirectory: 'model', runProcess })).resolves.toEqual([{ start: 0, end: 1, text: '你好' }])
    expect(runProcess).toHaveBeenCalledWith('sherpa-onnx-offline.exe', buildSenseVoiceArgs({ audioPath: 'audio.wav', modelDirectory: 'model' }), { signal: undefined })
  })

  it('maps the official sherpa-onnx JSON line with token timestamps', () => {
    expect(mapSenseVoiceOutputToSegments({
      lang: '<|yue|>', emotion: '<|NEUTRAL|>', event: '<|Speech|>',
      text: '开放时间早上九点至下午五点',
      timestamps: [0.6, 0.9, 1.2, 1.44, 1.86, 2.1, 2.52, 2.82, 3.24, 3.9, 4.2, 4.5, 4.74],
      tokens: ['开', '放', '时', '间', '早', '上', '九', '点', '至', '下', '午', '五', '点']
    }, 10)).toEqual([{ start: 10.6, end: 14.74, text: '开放时间早上九点至下午五点' }])
  })
  it('splits token timestamps at sentence punctuation without inventing times', () => {
    expect(mapSenseVoiceOutputToSegments({
      text: '第一句。第二句！',
      tokens: ['第', '一', '句', '。', '第', '二', '句', '！'],
      timestamps: [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4]
    }, 10)).toEqual([
      { start: 10, end: 10.6, text: '第一句。' },
      { start: 10.8, end: 11.4, text: '第二句！' }
    ])
  })

  it('keeps a single segment when token timestamps have no reliable sentence boundary', () => {
    expect(mapSenseVoiceOutputToSegments({
      text: 'continuous text without terminal punctuation',
      tokens: ['continuous', 'text', 'without', 'terminal', 'punctuation'],
      timestamps: [0, 0.2, 0.4, 0.6, 0.8]
    }, 10)).toEqual([
      { start: 10, end: 10.8, text: 'continuous text without terminal punctuation' }
    ])
  })

  it('splits a long unpunctuated token stream using the model-provided timestamps', () => {
    expect(mapSenseVoiceOutputToSegments({
      text: '这是没有标点但具有真实词级时间的长文本',
      tokens: ['这', '是', '没', '有', '标', '点', '但', '具', '有', '真', '实', '词', '级', '时', '间', '的', '长', '文', '本'],
      timestamps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    }, 0)).toEqual([
      { start: 0, end: 10, text: '这是没有标点但具有真实' },
      { start: 11, end: 18, text: '词级时间的长文本' }
    ])
  })

  it('does not let control tokens contribute text or timing bounds to a sentence', () => {
    expect(mapSenseVoiceOutputToSegments({
      text: '<|zh|>你好。<|Speech|>',
      tokens: ['<|zh|>', '你', '好', '。', '<|Speech|>'],
      timestamps: [0, 0.2, 0.4, 0.6, 0.8]
    }, 10)).toEqual([{ start: 10.2, end: 10.6, text: '你好。' }])
  })
})
