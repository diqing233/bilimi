import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  FavoriteLibrarySelectionCheckbox,
  FavoriteLibrarySelectionStore,
  FavoriteLibrarySelectionSubscriber
} from './favoriteLibrarySelection'

describe('favorite library selection island', () => {
  it('updates the checkbox, selected count, and batch eligibility without rerendering its parent', () => {
    const store = new FavoriteLibrarySelectionStore()
    let parentRenders = 0
    function Parent() {
      parentRenders += 1
      const stableStore = useRef(store).current
      return <>
        <span data-testid="heavy-parent">heavy</span>
        <FavoriteLibrarySelectionSubscriber store={stableStore}>{(selection) => <>
          <span>{`已选 ${selection.selectedAids.length} 项`}</span>
          <button disabled={!selection.selectedAids.length}>批量操作</button>
        </>}</FavoriteLibrarySelectionSubscriber>
        <FavoriteLibrarySelectionCheckbox store={stableStore} aid={1} label="选择视频" />
      </>
    }
    render(<Parent />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择视频' }))

    expect(screen.getByRole('checkbox', { name: '选择视频' })).toBeChecked()
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量操作' })).toBeEnabled()
    expect(parentRenders).toBe(1)
  })

  it('notifies only the toggled aid subscriber plus aggregate subscribers', () => {
    const store = new FavoriteLibrarySelectionStore()
    const firstAidListener = vi.fn()
    const secondAidListener = vi.fn()
    const aggregateListener = vi.fn()
    store.subscribeAid(1, firstAidListener)
    store.subscribeAid(2, secondAidListener)
    store.subscribe(aggregateListener)
    render(<>
      <FavoriteLibrarySelectionCheckbox store={store} aid={1} label="select-1" />
      <FavoriteLibrarySelectionCheckbox store={store} aid={2} label="select-2" />
    </>)

    fireEvent.click(screen.getByRole('checkbox', { name: 'select-1' }))

    expect(firstAidListener).toHaveBeenCalledTimes(1)
    expect(secondAidListener).not.toHaveBeenCalled()
    expect(aggregateListener).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('checkbox', { name: 'select-1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'select-2' })).not.toBeChecked()
  })
})
