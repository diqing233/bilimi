import { describe, expect, it } from 'vitest'
import { formatDeepSeekErrorMessage } from './deepSeekErrorMessage'

describe('formatDeepSeekErrorMessage', () => {
  it('removes the Electron remote method wrapper from DeepSeek errors', () => {
    expect(
      formatDeepSeekErrorMessage(
        new Error(
          "Error invoking remote method 'deepseek:generate': Error: DeepSeek 总结内容不完整：缺少标题。"
        ),
        'DeepSeek 总结生成失败。'
      )
    ).toBe('DeepSeek 总结内容不完整：缺少标题。')
  })

  it('keeps ordinary error messages and uses the fallback for unknown values', () => {
    expect(formatDeepSeekErrorMessage(new Error('网络连接失败。'), '生成失败。')).toBe(
      '网络连接失败。'
    )
    expect(formatDeepSeekErrorMessage(null, '生成失败。')).toBe('生成失败。')
  })

  it('turns a bounded provider timeout into an actionable retry message', () => {
    expect(
      formatDeepSeekErrorMessage(
        new Error('DeepSeek request timed out after 90 seconds.'),
        'DeepSeek 总结生成失败。'
      )
    ).toBe('DeepSeek 请求超时，请检查服务地址或网络后重试。')
  })
})
