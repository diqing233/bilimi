import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'

describe('FavoriteLibraryDetail', () => {
  it('opens the video from the underlined title and exposes detail collapse as the first action', () => {
    const onOpenTitle = vi.fn()
    const onCollapse = vi.fn()
    render(<FavoriteLibraryDetail title="测试视频" onTitleClick={onOpenTitle} onCollapse={onCollapse} />)

    fireEvent.click(screen.getByRole('button', { name: '打开视频：测试视频' }))
    expect(onOpenTitle).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    expect(onCollapse).toHaveBeenCalledWith(true)
  })

  it('orders title, author identifier, and supplied heading actions vertically', () => {
    render(<FavoriteLibraryDetail
      title="测试视频"
      author="测试 UP"
      videoId="BV1test"
      headerActions={<><button type="button">打开视频</button><button type="button">刷新资料</button></>}
      onCollapse={vi.fn()}
    />)

    const heading = document.querySelector('.favorite-library__detail-heading')
    expect(heading?.textContent).toBe('测试视频UP：测试 UP · BV1test收起详情打开视频刷新资料')
    expect(heading?.querySelector(':scope > h2 + p + .favorite-library__detail-heading-actions')).not.toBeNull()
  })

  it('places more information after the collapse and supplied heading actions', () => {
    render(<FavoriteLibraryDetail
      title="测试视频"
      videoId="BV1test"
      headerActions={<><button type="button">打开视频</button><button type="button">刷新资料</button></>}
      moreInformation={{ description: '完整简介', tags: ['音乐', '现场'] }}
      onCollapse={vi.fn()}
    />)

    expect(Array.from(document.querySelectorAll('.favorite-library__detail-heading-actions button')).map((button) => button.textContent))
      .toEqual(['收起详情', '打开视频', '刷新资料', '更多信息'])
    expect(document.querySelector('.favorite-library__detail-heading-primary-actions')).toContainElement(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByRole('button', { name: '收起详情' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByText('简介：完整简介')).toBeInTheDocument()
    expect(screen.getByText('标签：音乐、现场')).toBeInTheDocument()
  })

  it('keeps the tags line visible when the selected video has no confirmed tags', () => {
    render(<FavoriteLibraryDetail
      title="测试视频"
      videoId="BV1test"
      moreInformation={{ description: '完整简介', tags: [] }}
      onCollapse={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByText('标签：暂无标签')).toBeInTheDocument()
  })

  it('keeps the detail actions on one row with refresh controls centered until constrained width wraps them', () => {
    render(<FavoriteLibraryDetail
      title="测试视频"
      videoId="BV1test"
      headerActions={<><button type="button" className="favorite-library__open-video">打开视频</button><button type="button" className="favorite-library__inline-action">刷新信息</button></>}
      moreInformation={{ status: 'missing' }}
      onCollapse={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '更多信息' })).toHaveClass('favorite-library__detail-more-information-action')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')
    expect(styles).toContain('.favorite-library__detail-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; width: 100%; }')
    expect(styles).toContain('.favorite-library__detail-heading-primary-actions { display: contents; }')
    expect(styles).toContain('.favorite-library__detail-collapse-action { order: 1; margin-right: auto; font-size: 12px; }')
    expect(styles).toContain('.favorite-library__detail-heading-primary-actions > .favorite-library__inline-action { order: 2; font-size: 12px; }')
    expect(styles).toContain('.favorite-library__detail-more-information-action { order: 3; font-size: 12px; }')
    expect(styles).toContain('.favorite-library__detail-collapse-action, .favorite-library__detail-heading-primary-actions > .favorite-library__inline-action { border: 0; border-radius: 0; background: transparent; color: #2563eb; }')
  })

  it.each([
    ['loading', '正在加载更多资料…'],
    ['missing', '暂无更多资料。'],
    ['failed', '更多资料加载失败。']
  ] as const)('distinguishes the %s more-information state', (status, message) => {
    render(<FavoriteLibraryDetail
      title="测试视频"
      videoId="BV1test"
      moreInformation={{ status }}
      onCollapse={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('resets expanded more information after the selected video changes', () => {
    const { rerender } = render(<FavoriteLibraryDetail
      title="视频一"
      videoId="BV1one"
      moreInformation={{ description: '视频一完整简介' }}
      onCollapse={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByText('简介：视频一完整简介')).toBeInTheDocument()

    rerender(<FavoriteLibraryDetail
      title="视频二"
      videoId="BV1two"
      moreInformation={{ description: '视频二完整简介' }}
      onCollapse={vi.fn()}
    />)
    expect(screen.queryByText('简介：视频二完整简介')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更多信息' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not restore a previous video more-information expansion after A-B-A selection', () => {
    const { rerender } = render(<FavoriteLibraryDetail
      title="视频 A"
      videoId="BV1a"
      moreInformation={{ description: '视频 A 完整简介' }}
      onCollapse={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '更多信息' }))
    expect(screen.getByText('简介：视频 A 完整简介')).toBeInTheDocument()

    rerender(<FavoriteLibraryDetail
      title="视频 B"
      videoId="BV1b"
      moreInformation={{ description: '视频 B 完整简介' }}
      onCollapse={vi.fn()}
    />)
    rerender(<FavoriteLibraryDetail
      title="视频 A"
      videoId="BV1a"
      moreInformation={{ description: '视频 A 完整简介' }}
      onCollapse={vi.fn()}
    />)

    expect(screen.queryByText('简介：视频 A 完整简介')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更多信息' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses selection identity during render instead of a passive reset after a video change', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryDetail.tsx'), 'utf8')

    expect(source).not.toContain('useEffect(')
    expect(source).toContain('previousSelectedIdentity.current !== selectedIdentity')
  })

  it('keeps the collapse action as the final action at the minimum detail width', () => {
    window.localStorage.setItem('bilimi:favorite-library-detail-width', '220')
    render(<FavoriteLibraryDetail
      title="测试视频"
      videoId="BV1test"
      headerActions={<><button type="button">打开视频</button><button type="button">刷新资料</button></>}
      moreInformation={{ status: 'missing' }}
      onCollapse={vi.fn()}
    />)

    const detail = screen.getByRole('complementary', { name: '视频详情' })
    const actions = detail.querySelector('.favorite-library__detail-heading-actions')
    expect(detail).toHaveStyle({ '--favorite-detail-width': '220px' })
    expect(Array.from(actions?.querySelectorAll('button') ?? []).map((button) => button.textContent))
      .toEqual(['收起详情', '打开视频', '刷新资料', '更多信息'])
  })

  it('keeps detail actions together when possible and permits natural wrapping only when constrained', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__detail-heading { display: grid;')
    expect(styles).toContain('.favorite-library__detail-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; width: 100%; }')
    expect(styles).toContain('.favorite-library__detail-heading-primary-actions { display: contents; }')
    expect(styles).toContain('.favorite-library__detail-collapse-action')
    expect(styles).toContain('.favorite-library__status-row { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 5px; }')
  })

  it('keeps the actual detail heading and body at the compact library scale', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__detail-heading h2 { margin: 0; font-size: 18px; line-height: 1.35; }')
    expect(styles).toContain('.favorite-library__detail section p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.45; }')
  })

  it('uses a quieter secondary elevation around the detail card', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('border: 1px solid #c9dcf5; box-shadow: 0 3px 12px rgb(45 91 140 / .08);')
  })

  it('uses the shared blue dashed divider for detail sections except the final section', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('--favorite-divider: var(--bilimi-divider);')
    expect(styles).toContain('.favorite-library__detail section { clear: both; margin: 0 -12px; padding: 12px; border-top: var(--favorite-divider); }')
    expect(styles).toContain('.favorite-library__detail section:last-child { border-bottom: 0; }')
  })

  it('keeps the other-actions content padded while using text-only danger actions', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__detail-danger { padding: 12px !important;')
    expect(styles).toContain('.favorite-library__detail-danger .favorite-library__danger-action:hover')
  })

  it('lets the user resize a visible detail panel without removing its collapse action', () => {
    window.localStorage.removeItem('bilimi:favorite-library-detail-width')
    render(<FavoriteLibraryDetail title="测试视频" onCollapse={vi.fn()}>内容</FavoriteLibraryDetail>)

    const detail = screen.getByRole('complementary', { name: '视频详情' })
    const handle = screen.getByRole('separator', { name: '调整视频详情宽度' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 720 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(detail).toHaveStyle({ '--favorite-detail-width': '380px' })
    expect(window.localStorage.getItem('bilimi:favorite-library-detail-width')).toBe('380')
    expect(screen.getByRole('button', { name: '收起详情' })).toBeInTheDocument()
  })

  it('supports keyboard resizing on the detail separator', () => {
    window.localStorage.removeItem('bilimi:favorite-library-detail-width')
    render(<FavoriteLibraryDetail title="测试视频" onCollapse={vi.fn()}>内容</FavoriteLibraryDetail>)

    const detail = screen.getByRole('complementary', { name: '视频详情' })
    const handle = screen.getByRole('separator', { name: '调整视频详情宽度' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(detail).toHaveStyle({ '--favorite-detail-width': '324px' })
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(detail).toHaveStyle({ '--favorite-detail-width': '220px' })
    fireEvent.keyDown(handle, { key: 'End' })
    expect(detail).toHaveStyle({ '--favorite-detail-width': '520px' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '496')
    expect(window.localStorage.getItem('bilimi:favorite-library-detail-width')).toBe('496')
  })
})
