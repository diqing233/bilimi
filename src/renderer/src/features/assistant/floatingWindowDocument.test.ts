import { describe, expect, it } from 'vitest'
import { markFloatingWindowDocument } from './floatingWindowDocument'

function createTarget() {
  const documentElement = document.createElement('html')
  const body = document.createElement('body')
  const root = document.createElement('div')
  root.id = 'root'
  body.append(root)

  return {
    documentElement,
    body,
    title: 'Bilimi',
    getElementById: (id: string) => (id === 'root' ? root : null)
  }
}

describe('markFloatingWindowDocument', () => {
  it('marks floating renderer windows so the page background stays transparent before React renders', () => {
    const target = createTarget()

    expect(markFloatingWindowDocument('?window=floating-seal', target)).toBe(true)

    expect(target.documentElement).toHaveAttribute('data-floating-window', 'true')
    expect(target.body).toHaveAttribute('data-floating-window', 'true')
    expect(target.documentElement.style.backgroundColor).toBe('transparent')
    expect(target.body.style.backgroundColor).toBe('transparent')
    expect(target.documentElement.style.background).toBe('transparent')
    expect(target.body.style.background).toBe('transparent')
    expect(target.documentElement.style.getPropertyPriority('background')).toBe('important')
    expect(target.body.style.getPropertyPriority('background')).toBe('important')
    expect(target.documentElement.style.getPropertyPriority('background-color')).toBe('important')
    expect(target.body.style.getPropertyPriority('background-color')).toBe('important')
    expect(target.getElementById('root')).toHaveAttribute('data-floating-window', 'true')
    expect(target.getElementById('root')?.style.backgroundColor).toBe('transparent')
    expect(target.getElementById('root')?.style.background).toBe('transparent')
    expect(target.getElementById('root')?.style.getPropertyPriority('background')).toBe(
      'important'
    )
    expect(target.getElementById('root')?.style.getPropertyPriority('background-color')).toBe(
      'important'
    )
    expect(target.getElementById('root')?.style.overflow).toBe('hidden')
    expect(target.title).toBe('')
  })

  it('does not mark the normal browser window as floating', () => {
    const target = createTarget()

    expect(markFloatingWindowDocument('', target)).toBe(false)

    expect(target.documentElement).not.toHaveAttribute('data-floating-window')
    expect(target.body).not.toHaveAttribute('data-floating-window')
    expect(target.title).toBe('Bilimi')
  })
})
