import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VideoSummaryMenu } from './VideoSummaryMenu'

describe('VideoSummaryMenu', () => {
  it('uses the shared SVG chevron instead of a text arrow', () => {
    render(<VideoSummaryMenu actions={[]} />)

    const trigger = screen.getByRole('button', { name: '转写操作' })
    expect(trigger.querySelector('svg.video-summary-menu__chevron')).toBeInTheDocument()
    expect(trigger.textContent).toBe('转写操作')
  })
})
