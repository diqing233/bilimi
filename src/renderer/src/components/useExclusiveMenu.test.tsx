import { createPortal } from 'react-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExclusiveMenu } from './useExclusiveMenu'

function Menu({ label, portal = false }: { label: string; portal?: boolean }) {
  const menuState = useExclusiveMenu()
  const [open, setOpen] = menuState
  const scope = menuState[2]
  const menu = open ? <div {...scope} role="menu" aria-label={`${label}菜单`}><button type="button">菜单内部</button></div> : null

  return <>
    <span {...scope}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)}>打开</button>
      {!portal ? menu : null}
    </span>
    {portal ? createPortal(menu, document.body) : null}
  </>
}

describe('useExclusiveMenu', () => {
  it('closes an open menu after a pointer press outside its trigger and menu', () => {
    render(<><Menu label="视频名称" /><button type="button">空白区域</button></>)
    const trigger = screen.getByRole('button', { name: '视频名称' })

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '空白区域' }))

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps an inline menu open when pressed inside', () => {
    render(<Menu label="状态" />)
    const inlineTrigger = screen.getByRole('button', { name: '状态' })
    fireEvent.click(inlineTrigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '菜单内部' }))
    expect(inlineTrigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a portal menu open when pressed inside', () => {
    render(<Menu label="来源" portal />)
    const portalTrigger = screen.getByRole('button', { name: '来源' })
    fireEvent.click(portalTrigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '菜单内部' }))
    expect(portalTrigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the current menu on Escape', () => {
    render(<Menu label="状态" />)
    const trigger = screen.getByRole('button', { name: '状态' })

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps only the most recently opened menu visible', () => {
    render(<><Menu label="视频名称" /><Menu label="状态" /></>)
    const first = screen.getByRole('button', { name: '视频名称' })
    const second = screen.getByRole('button', { name: '状态' })

    fireEvent.click(first)
    fireEvent.click(second)

    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })
})
