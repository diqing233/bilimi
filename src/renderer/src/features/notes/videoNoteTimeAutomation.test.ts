import { describe, expect, it, vi } from 'vitest'
import {
  buildReadCurrentVideoTimeScript,
  buildSeekVideoTimeScript
} from './videoNoteTimeAutomation'

describe('video note time automation', () => {
  it('reads current video time from the active page video element', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'currentTime', { value: 83.4, configurable: true })

    await expect(window.eval(buildReadCurrentVideoTimeScript())).resolves.toBe(83.4)
  })

  it('throws a clear error when no video element exists', async () => {
    document.body.innerHTML = '<main></main>'

    await expect(window.eval(buildReadCurrentVideoTimeScript())).rejects.toThrow(
      '未找到当前视频播放器，无法读取时间点。'
    )
  })

  it('seeks the active page video element and tries to play', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    const play = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(video, 'play', { value: play, configurable: true })

    await expect(window.eval(buildSeekVideoTimeScript(95))).resolves.toBe(true)
    expect(video.currentTime).toBe(95)
    expect(play).toHaveBeenCalled()
  })

  it('still completes seek when playback resume is blocked', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    const play = vi.fn().mockRejectedValue(new Error('play blocked'))
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(video, 'play', { value: play, configurable: true })

    await expect(window.eval(buildSeekVideoTimeScript(42))).resolves.toBe(true)
    expect(video.currentTime).toBe(42)
    expect(play).toHaveBeenCalled()
  })

  it('returns immediately when playback resume remains pending', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    const play = vi.fn().mockReturnValue(new Promise(() => undefined))
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(video, 'play', { value: play, configurable: true })

    const result = await Promise.race([
      window.eval(buildSeekVideoTimeScript(77)),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 20))
    ])

    expect(result).toBe(true)
    expect(video.currentTime).toBe(77)
    expect(play).toHaveBeenCalled()
  })

  it('throws a clear error when seeking without a video element', async () => {
    document.body.innerHTML = '<main></main>'

    await expect(window.eval(buildSeekVideoTimeScript(12))).rejects.toThrow(
      '未找到当前视频播放器，无法跳转时间点。'
    )
  })
})
