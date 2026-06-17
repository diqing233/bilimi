import { describe, expect, it } from 'vitest'
import { createLayeredPetTransientView, createLayeredPetView } from './layeredPetModel'

describe('layeredPetModel', () => {
  it('maps persistent pet states to expressions, effects, and motions', () => {
    expect(createLayeredPetView('idle')).toMatchObject({
      state: 'idle',
      expression: {
        eyes: 'idle',
        mouth: 'smile'
      },
      effect: 'none',
      motion: 'idle'
    })

    expect(createLayeredPetView('hint')).toMatchObject({
      state: 'hint',
      expression: {
        eyes: 'happy',
        mouth: 'open'
      },
      effect: 'hint-sparkles',
      motion: 'hint'
    })

    expect(createLayeredPetView('working')).toMatchObject({
      state: 'working',
      expression: {
        eyes: 'focused',
        mouth: 'open'
      },
      effect: 'working-stars',
      motion: 'working'
    })

    expect(createLayeredPetView('error')).toMatchObject({
      state: 'error',
      expression: {
        eyes: 'wronged',
        mouth: 'small'
      },
      effect: 'error-sweat',
      motion: 'error'
    })
  })

  it('creates a clicked transient without changing the persistent state contract', () => {
    expect(createLayeredPetTransientView('clicked')).toEqual({
      transient: 'clicked',
      expression: {
        eyes: 'happy',
        mouth: 'smile'
      },
      effect: 'click-hearts',
      motion: 'clicked',
      durationMs: 850
    })
  })

  it('keeps high-fidelity state sprite layer ordering stable', () => {
    expect(createLayeredPetView('idle').layers.map((layer) => layer.id)).toEqual([
      'character',
      'effect'
    ])
    expect(createLayeredPetView('working').layers).toEqual([
      {
        id: 'character',
        visible: true
      },
      {
        id: 'effect',
        visible: true
      }
    ])
  })
})
