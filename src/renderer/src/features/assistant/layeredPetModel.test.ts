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

    expect(createLayeredPetView('happy')).toMatchObject({
      state: 'happy',
      expression: {
        eyes: 'happy',
        mouth: 'smile'
      },
      effect: 'click-hearts',
      motion: 'happy'
    })

    expect(createLayeredPetView('shy')).toMatchObject({
      state: 'shy',
      expression: {
        eyes: 'happy',
        mouth: 'small'
      },
      effect: 'click-hearts',
      motion: 'shy'
    })

    expect(createLayeredPetView('thinking')).toMatchObject({
      state: 'thinking',
      expression: {
        eyes: 'focused',
        mouth: 'small'
      },
      effect: 'hint-sparkles',
      motion: 'thinking'
    })

    expect(createLayeredPetView('cheer')).toMatchObject({
      state: 'cheer',
      expression: {
        eyes: 'happy',
        mouth: 'open'
      },
      effect: 'working-stars',
      motion: 'cheer'
    })

    expect(createLayeredPetView('sleepy')).toMatchObject({
      state: 'sleepy',
      expression: {
        eyes: 'sleepy',
        mouth: 'small'
      },
      effect: 'none',
      motion: 'sleepy'
    })

    expect(createLayeredPetView('surprised')).toMatchObject({
      state: 'surprised',
      expression: {
        eyes: 'surprised',
        mouth: 'open'
      },
      effect: 'hint-sparkles',
      motion: 'surprised'
    })

    expect(createLayeredPetView('done')).toMatchObject({
      state: 'done',
      expression: {
        eyes: 'happy',
        mouth: 'smile'
      },
      effect: 'click-hearts',
      motion: 'done'
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
