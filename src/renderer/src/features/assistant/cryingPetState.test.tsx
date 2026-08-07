import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createLayeredPetView } from './layeredPetModel'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import { createPetStateView, normalizePetState } from './petState'

describe('crying pet state', () => {
  it('normalizes crying as a first-class state with its own message', () => {
    expect(normalizePetState('crying')).toBe('crying')
    expect(createPetStateView('crying')).toEqual({
      state: 'crying',
      label: '小咪委屈',
      bubble: '主人是不是不要小咪了……'
    })
  })

  it('uses a wronged expression without an effect layer', () => {
    expect(createLayeredPetView('crying')).toMatchObject({
      state: 'crying',
      expression: { eyes: 'wronged', mouth: 'small' },
      effect: 'none',
      motion: 'crying'
    })
  })

  it('uses the existing transparent wronged character asset for crying', () => {
    render(<LayeredPetRenderer petState="crying" clickReactionSignal={0} />)
    expect(screen.getByTestId('layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.getByTestId('layered-pet-character')).toHaveAttribute('src', expect.stringContaining('error.png'))
  })
})
