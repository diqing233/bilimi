import { describe, expect, it, vi } from 'vitest'
import { buildDanmakuSeekRepaintScript } from './danmakuSeekRepaint'

describe('buildDanmakuSeekRepaintScript', () => {
  it('installs exactly one settled seek listener and replaces a previous installation', () => {
    const script = buildDanmakuSeekRepaintScript()
    const listeners = new Map<string, EventListener>()
    const video = {
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type))
    }
    const document = {
      querySelector: vi.fn(() => video),
      querySelectorAll: vi.fn(() => [])
    }
    const window = {
      __bilimiDanmakuSeekRepaint: undefined as unknown,
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => 1),
      dispatchEvent: vi.fn(),
      requestAnimationFrame: vi.fn()
    }
    const run = new Function('window', 'document', `return ${script}`) as (window: typeof window, document: typeof document) => unknown

    run(window, document)
    run(window, document)

    expect(video.addEventListener).toHaveBeenCalledTimes(2)
    expect(video.removeEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.has('seeked')).toBe(true)
  })

  it('debounces seek events and leaves pages without a danmaku layer untouched', () => {
    vi.useFakeTimers()
    try {
      const script = buildDanmakuSeekRepaintScript()
      let listener: EventListener | undefined
      const video = {
        addEventListener: vi.fn((_type: string, candidate: EventListener) => { listener = candidate }),
        removeEventListener: vi.fn()
      }
      const document = {
        querySelector: vi.fn(() => video),
        querySelectorAll: vi.fn(() => [])
      }
      const window = {
        __bilimiDanmakuSeekRepaint: undefined as unknown,
        clearTimeout,
        setTimeout,
        dispatchEvent: vi.fn(),
        requestAnimationFrame: vi.fn()
      }
      const run = new Function('window', 'document', `return ${script}`) as (window: typeof window, document: typeof document) => unknown

      run(window, document)
      listener?.(new Event('seeked'))
      listener?.(new Event('seeked'))
      listener?.(new Event('seeked'))
      vi.runAllTimers()

      expect(window.dispatchEvent).not.toHaveBeenCalled()
      expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restore retired polling or mutate playback controls', () => {
    const script = buildDanmakuSeekRepaintScript()

    expect(script).not.toContain('MutationObserver')
    expect(script).not.toMatch(/0\s*,\s*250\s*,\s*800\s*,\s*1600\s*,\s*3200/)
    expect(script).not.toMatch(/fetch\s*\(|XMLHttpRequest|currentTime\s*=|\.play\s*\(|\.pause\s*\(|danmaku-switch/)
  })

  it('nudges the video along with existing danmaku compositor surfaces', () => {
    const script = buildDanmakuSeekRepaintScript()

    expect(script).toContain('const saved = [video, ...targets]')
    expect(script).toContain('if (!targets.length) return;')
  })
})
