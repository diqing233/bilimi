import { fireEvent, render, screen } from '@testing-library/react'
import { AssistantOverlay } from './AssistantOverlay'

describe('AssistantOverlay', () => {
  it('opens the memorial panel from the folded seal', () => {
    render(<AssistantOverlay />)

    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText('赏')).toBeInTheDocument()
    expect(screen.getByText('赐')).toBeInTheDocument()
    expect(screen.getByText('表')).toBeInTheDocument()
    expect(screen.getByText('阅')).toBeInTheDocument()
  })
})
