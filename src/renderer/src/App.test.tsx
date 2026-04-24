import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'

describe('App integration', () => {
  it('opens the memorial panel and shows the recommendation summary', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText(/此物颇能解闷/)).toBeInTheDocument()
  })
})
