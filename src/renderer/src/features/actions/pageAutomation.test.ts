import { describe, expect, it } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import {
  buildAutomationScript,
} from './pageAutomation'

describe('buildAutomationScript', () => {
  const favoriteLedgers = createDefaultFavoriteLedgers()
  const enabledLedgerNames = favoriteLedgers
    .filter((ledger) => ledger.enabled)
    .map((ledger) => ledger.displayName)


  it('creates/selects the category folder and favorites without liking for 藏', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []
    let likeClicked = false
    let selectedFolder = ''

    document.querySelector('[aria-label="点赞"]')?.addEventListener('click', () => {
      likeClicked = true
    })
    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-create">新建收藏夹</button>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        const item = document.createElement('button')
        item.className = 'fav-item'
        item.textContent = input.value
        item.addEventListener('click', () => {
          selectedFolder = item.textContent ?? ''
        })
        document.querySelector('.fav-dialog')?.prepend(item)
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('藏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(likeClicked).toBe(false)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toBe('bilimi·影视动漫')
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'favorite:create-defaults', 'favorite:folder', 'favorite'])
    )
  })

  it('does not open a favorite dialog when the page script is told to skip favorite work', async () => {
    let favoriteClicked = false
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      favoriteClicked = true
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv', {
        skipFavorite: true
      })
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['like'])
    expect(favoriteClicked).toBe(false)
  })

  it('never scrolls an unrelated page container while searching for a favorite folder', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <div class="danmaku-scroll"></div>
    `
    const danmakuScroll = document.querySelector('.danmaku-scroll') as HTMLDivElement
    Object.defineProperty(danmakuScroll, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(danmakuScroll, 'clientHeight', { configurable: true, value: 180 })

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<section class="unknown-favorite-panel">
          <div class="favorite-scroll"></div>
          <button class="fav-add-folder">新建收藏夹</button>
          <input class="fav-name-input" />
          <button class="fav-create-confirm">新建</button>
          <button class="fav-submit">完成</button>
        </section>`
      )
      const favoriteScroll = document.querySelector('.favorite-scroll') as HTMLDivElement
      Object.defineProperty(favoriteScroll, 'scrollHeight', { configurable: true, value: 600 })
      Object.defineProperty(favoriteScroll, 'clientHeight', { configurable: true, value: 120 })
      favoriteScroll.addEventListener('scroll', () => {
        document.querySelector('.fav-add-folder')?.setAttribute('data-visible', 'true')
      })
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        document.querySelector('.favorite-scroll')?.insertAdjacentHTML('afterbegin', '<button>bilimi·影视动漫</button>')
      })
    })

    const result = await window.eval(
      buildAutomationScript('藏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(danmakuScroll.scrollTop).toBe(0)
  })

  it('likes and saves the current page into the Bilimi favorites folder for 赏', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button>bilimi 内库</button>
      <button>完成</button>
    `

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'favorite:folder', 'favorite'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('likes, favorites, and submits the selected coin count for 赐', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button aria-label="投币">投币</button>
      <button>bilimi·影视动漫</button>
      <button>完成</button>
    `
    let twoCoinSelected = false
    let coinConfirmed = false

    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="coin-dialog">
            <button class="coin-option">投 1 币</button>
            <button class="coin-option">投 2 币</button>
            <button class="coin-submit">确定</button>
          </div>
        `
      )

      const options = Array.from(document.querySelectorAll('.coin-option'))
      options[1]?.addEventListener('click', () => {
        twoCoinSelected = true
      })
      document.querySelector('.coin-submit')?.addEventListener('click', () => {
        coinConfirmed = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(twoCoinSelected).toBe(true)
    expect(coinConfirmed).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'favorite:folder', 'favorite', 'coin:open', 'coin:2', 'coin:confirm'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('reports an already-full coin allocation without waiting for a dialog that Bilibili will not open', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="投币">投币</button>
    `

    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div role="status">该视频已经投过硬币了，最多投 2 枚</div>'
      )
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, '', { skipFavorite: true })
    )

    expect(result).toMatchObject({
      ok: true,
      message: '未完成，投币可能已达到上限哦'
    })
    expect(result.steps).toContain('coin:already-full')
    expect(result.missingTargets).toEqual([])
  }, 10_000)

  it('recognizes Bilibili\'s current coin-limit toast text', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="投币">投币</button>
    `

    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="bili-toast" role="status">对本稿件的投币枚数已用完</div>'
      )
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, '', { skipFavorite: true })
    )

    expect(result).toMatchObject({
      ok: true,
      message: '未完成，投币可能已达到上限哦'
    })
    expect(result.steps).toContain('coin:already-full')
    expect(result.missingTargets).toEqual([])
  }, 10_000)

  it('selects and confirms the bilibili coin dialog when controls are not buttons', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button aria-label="投币">投币</button>
      <button>bilimi·影视动漫</button>
      <button>完成</button>
    `
    let twoCoinSelected = false
    let coinConfirmed = false

    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="bili-dialog-bomb">
            <div class="title">给UP主投上 <span>2</span> 枚硬币</div>
            <div class="coin-selector">
              <div class="mc-box">
                <span class="coin-title">1硬币</span>
              </div>
              <div class="mc-box active">
                <span class="coin-title">2硬币</span>
              </div>
            </div>
            <div class="bi-btn">确定</div>
          </div>
        `
      )

      const options = Array.from(document.querySelectorAll('.mc-box'))
      options[1]?.addEventListener('click', () => {
        twoCoinSelected = true
      })
      document.querySelector('.bi-btn')?.addEventListener('click', () => {
        coinConfirmed = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(twoCoinSelected).toBe(true)
    expect(coinConfirmed).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['coin:open', 'coin:2', 'coin:confirm'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('does not click an already-active favorite button during 赐 and still completes coin selection', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button class="video-fav active" aria-label="已收藏">已收藏</button>
      <button aria-label="投币">投币</button>
    `
    let favoriteCancelled = false
    let coinConfirmed = false

    document.querySelector('.video-fav')?.addEventListener('click', () => {
      favoriteCancelled = true
    })
    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="coin-dialog">
            <button class="coin-option">投 2 币</button>
            <button class="coin-submit">确定</button>
          </div>
        `
      )

      document.querySelector('.coin-submit')?.addEventListener('click', () => {
        coinConfirmed = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(favoriteCancelled).toBe(false)
    expect(coinConfirmed).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:already-collected', 'coin:open', 'coin:2', 'coin:confirm'])
    )
    expect(result.missingTargets).toEqual(['favorite-api-required'])
  })

  it('does not click an already-active like button during 赐 and still continues the action', async () => {
    document.body.innerHTML = `
      <button class="video-like active" aria-label="已点赞">已点赞</button>
      <button aria-label="收藏">收藏</button>
      <button>bilimi·影视动漫</button>
      <button>完成</button>
      <button aria-label="投币">投币</button>
    `
    let likeCancelled = false
    let coinConfirmed = false

    document.querySelector('.video-like')?.addEventListener('click', () => {
      likeCancelled = true
    })
    document.querySelector('[aria-label="投币"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="coin-dialog">
            <button class="coin-option">投 2 币</button>
            <button class="coin-submit">确定</button>
          </div>
        `
      )

      document.querySelector('.coin-submit')?.addEventListener('click', () => {
        coinConfirmed = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('赐', 'bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(likeCancelled).toBe(false)
    expect(coinConfirmed).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like:already-liked', 'favorite:open', 'favorite:folder', 'favorite', 'coin:open', 'coin:2', 'coin:confirm'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('stops 赏 before opening favorites when no like target is found', async () => {
    document.body.innerHTML = `
      <button class="nav-favorite">收藏</button>
    `
    let favoriteClicked = false

    document.querySelector('.nav-favorite')?.addEventListener('click', () => {
      favoriteClicked = true
      document.body.insertAdjacentHTML('beforeend', '<div class="bili-dialog-bomb">收藏弹层</div>')
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(false)
    expect(result.missingTargets).toContain('like')
    expect(result.steps).not.toContain('favorite:open')
    expect(favoriteClicked).toBe(false)
    expect(document.querySelector('.bili-dialog-bomb')).not.toBeInTheDocument()
  })

  it('finds icon-only bilibili toolbar actions when they sit next to each other', async () => {
    document.body.innerHTML = `
      <div class="video-toolbar-left">
        <div class="video-toolbar-left-item video-like">
          <svg aria-hidden="true"></svg>
          <span>1.2万</span>
        </div>
        <div class="video-toolbar-left-item video-coin" title="投币">
          <svg aria-hidden="true"></svg>
        </div>
        <div class="video-toolbar-left-item video-fav" title="收藏">
          <svg aria-hidden="true"></svg>
        </div>
      </div>
      <button>bilimi 内库</button>
      <button>完成</button>
    `

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'favorite:folder', 'favorite'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('waits for the favorite folder and confirmation after opening favorites', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `
            <button>bilimi 内库</button>
            <button>完成</button>
          `
        )
      }, 10)
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'favorite:folder', 'favorite'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('creates the Bilimi favorite folders on first save and uses the current category', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-create">新建收藏夹</button>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        document.querySelector('.fav-dialog')?.insertAdjacentHTML(
          'afterbegin',
          `<button class="fav-item">${input.value}</button>`
        )
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:create-defaults', 'favorite:folder', 'favorite'])
    )
  })

  it('keeps existing personal folders untouched when bootstrapping Bilimi favorites', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []
    let selectedFolder = ''

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-item">搞笑收藏</button>
            <button class="fav-create">新建收藏夹</button>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      document.querySelector('.fav-item')?.addEventListener('click', (event) => {
        selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
      })

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        document.querySelector('.fav-dialog')?.insertAdjacentHTML(
          'afterbegin',
          `<button class="fav-item created">${input.value}</button>`
        )
        document.querySelector('.fav-item.created')?.addEventListener('click', (event) => {
          selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
        })
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toBe('bilimi·影视动漫')
  })

  it('does not confirm the favorite dialog when no Bilimi target folder is selected', async () => {
    document.body.innerHTML = `
      <button aria-label="收藏">收藏</button>
    `
    let confirmClicked = false

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-item">用户原有收藏夹</button>
            <button class="fav-submit">确定</button>
          </div>
        `
      )

      document.querySelector('.fav-submit')?.addEventListener('click', () => {
        confirmClicked = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('藏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(false)
    expect(confirmClicked).toBe(false)
    expect(result.steps).toContain('favorite:open')
    expect(result.steps).not.toContain('favorite')
    expect(result.missingTargets).toContain('favorites-folder')
  })

  it('does not fall back to the legacy Bilimi folder when the target ledger is missing', async () => {
    document.body.innerHTML = `
      <button class="video-fav">favorite</button>
    `
    let selectedFolder = ''
    let confirmClicked = false

    document.querySelector('.video-fav')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-item">Bilimi Legacy Vault</button>
            <button class="fav-submit">瀹屾垚</button>
          </div>
        `
      )

      document.querySelector('.fav-item')?.addEventListener('click', (event) => {
        selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
      })
      document.querySelector('.fav-submit')?.addEventListener('click', () => {
        confirmClicked = true
      })
    })

    const result = await window.eval(
      buildAutomationScript(
        '\u85cf',
        'Bilimi Legacy Vault',
        undefined,
        undefined,
        favoriteLedgers,
        'missing-ledger'
      )
    )

    expect(result.ok).toBe(false)
    expect(selectedFolder).toBe('')
    expect(confirmClicked).toBe(false)
    expect(result.missingTargets).toContain('target-ledger')
  })

  it('reuses an existing matching Bilimi favorite folder before creating anything new', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    let createClicked = false
    let selectedFolder = ''

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-item">bilimi·影视动漫</button>
            <button class="fav-create">新建收藏夹</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      document.querySelector('.fav-item')?.addEventListener('click', (event) => {
        selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
      })
      document.querySelector('.fav-create')?.addEventListener('click', () => {
        createClicked = true
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(selectedFolder).toBe('bilimi·影视动漫')
    expect(createClicked).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining(['favorite:folder', 'favorite']))
  })

  it('creates only the current category when Bilimi folders exist without a suitable match', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="fav-dialog">
            <button class="fav-item">Bilimi｜稍后整理</button>
            <button class="fav-create">新建收藏夹</button>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        document.querySelector('.fav-dialog')?.insertAdjacentHTML(
          'afterbegin',
          `<button class="fav-item">${input.value}</button>`
        )
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'knowledge')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(['bilimi·知识学习'])
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:create-category', 'favorite:folder', 'favorite'])
    )
  })

  it('scrolls the bilibili favorite dialog to the bottom before creating folders', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []
    let selectedFolder = ''
    let scrolledToBottom = false

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="bili-dialog-bomb">
            <div class="fav-title">添加到收藏夹</div>
            <div class="fav-list">
              <div class="fav-video-list-item">
                <span class="bili-checkbox"></span>
                <span class="fav-name">音乐</span>
                <span>39/1000</span>
              </div>
              <div class="fav-video-list-item">
                <span class="bili-checkbox"></span>
                <span class="fav-name">番剧相关 [私密]</span>
                <span>138/1000</span>
              </div>
            </div>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const list = document.querySelector('.fav-list') as HTMLDivElement
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 500 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 120 })
      list.addEventListener('scroll', () => {
        if (list.scrollTop >= list.scrollHeight - list.clientHeight) {
          scrolledToBottom = true
          if (!document.querySelector('.fav-add-folder')) {
            list.insertAdjacentHTML(
              'beforeend',
              `<div class="fav-add-folder"><span>+</span><span>新建收藏夹</span></div>`
            )
            document.querySelector('.fav-add-folder')?.addEventListener('click', () => {
              document.querySelector('.fav-name-input')?.setAttribute('data-open', 'true')
            })
          }
        }
      })

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        const item = document.createElement('div')
        item.className = 'fav-video-list-item'
        item.innerHTML = `<span class="bili-checkbox"></span><span class="fav-name">${input.value}</span><span>0/1000</span>`
        item.addEventListener('click', (event) => {
          selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
        })
        list.prepend(item)
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(scrolledToBottom).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toContain('bilimi·影视动漫')
  })

  it('waits for the folder form that appears after clicking bilibili create folder', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="bili-dialog-bomb">
            <div class="fav-list">
              <div class="fav-video-list-item">
                <span class="bili-checkbox"></span>
                <span class="fav-name">音乐</span>
              </div>
            </div>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const list = document.querySelector('.fav-list') as HTMLDivElement
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 500 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 120 })
      list.addEventListener('scroll', () => {
        if (!document.querySelector('.fav-add-folder')) {
          list.insertAdjacentHTML('beforeend', `<div class="fav-add-folder">+ 新建收藏夹</div>`)
          document.querySelector('.fav-add-folder')?.addEventListener('click', () => {
            if (!document.querySelector('.fav-name-input')) {
              document.querySelector('.bili-dialog-bomb')?.insertAdjacentHTML(
                'beforeend',
                `
                  <input class="fav-name-input" />
                  <button class="fav-create-confirm">新建</button>
                `
              )
              const input = document.querySelector('.fav-name-input') as HTMLInputElement
              document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
                createdFolders.push(input.value)
                const item = document.createElement('div')
                item.className = 'fav-video-list-item'
                item.innerHTML = `<span class="bili-checkbox"></span><span class="fav-name">${input.value}</span>`
                list.prepend(item)
                input.value = ''
              })
            }
          })
        }
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
  })

  it('retries scrolling and clicks a plain bilibili create-folder row before filling the form', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []
    let scrollAttempts = 0

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="bili-dialog-bomb">
            <div class="fav-list">
              <div class="fav-video-list-item"><span class="fav-name">默认收藏夹</span></div>
            </div>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const list = document.querySelector('.fav-list') as HTMLDivElement
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 900 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 120 })
      list.addEventListener('scroll', () => {
        scrollAttempts += 1
        if (scrollAttempts < 2 || document.querySelector('.create-row')) {
          return
        }

        const createRow = document.createElement('div')
        createRow.className = 'create-row'
        createRow.textContent = '+ 新建收藏夹'
        createRow.addEventListener('click', () => {
          document.querySelector('.bili-dialog-bomb')?.insertAdjacentHTML(
            'beforeend',
            `
              <input placeholder="收藏夹名称" />
              <button class="create-submit">创建</button>
            `
          )
          const input = document.querySelector('input[placeholder="收藏夹名称"]') as HTMLInputElement
          document.querySelector('.create-submit')?.addEventListener('click', () => {
            createdFolders.push(input.value)
            const item = document.createElement('div')
            item.className = 'fav-video-list-item'
            item.textContent = input.value
            list.prepend(item)
            input.value = ''
          })
        })
        list.append(createRow)
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(scrollAttempts).toBeGreaterThanOrEqual(2)
    expect(result.steps).toEqual(expect.arrayContaining(['favorite:create-open']))
    expect(createdFolders).toEqual(enabledLedgerNames)
  })

  it('scrolls unnamed nested containers inside the bilibili favorite modal', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
    `
    const createdFolders: string[] = []
    let selectedFolder = ''
    let nestedContainerScrolled = false

    document.querySelector('[aria-label="收藏"]')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div class="bili-dialog-bomb">
            <div class="fav-title">添加到收藏夹</div>
            <div class="modal-body">
              <section class="scroll-port">
                <div class="fav-video-list-item">
                  <span class="bili-checkbox"></span>
                  <span class="fav-name">默认收藏夹 [私密]</span>
                </div>
              </section>
            </div>
            <input class="fav-name-input" />
            <button class="fav-create-confirm">新建</button>
            <button class="fav-submit">完成</button>
          </div>
        `
      )

      const scrollPort = document.querySelector('.scroll-port') as HTMLElement
      Object.defineProperty(scrollPort, 'scrollHeight', { configurable: true, value: 800 })
      Object.defineProperty(scrollPort, 'clientHeight', { configurable: true, value: 160 })
      scrollPort.addEventListener('scroll', () => {
        if (scrollPort.scrollTop >= scrollPort.scrollHeight - scrollPort.clientHeight) {
          nestedContainerScrolled = true
          if (!document.querySelector('.fav-add-folder')) {
            scrollPort.insertAdjacentHTML('beforeend', `<div class="fav-add-folder">+ 新建收藏夹</div>`)
          }
        }
      })

      const input = document.querySelector('.fav-name-input') as HTMLInputElement
      document.querySelector('.fav-create-confirm')?.addEventListener('click', () => {
        createdFolders.push(input.value)
        const item = document.createElement('div')
        item.className = 'fav-video-list-item'
        item.innerHTML = `<span class="bili-checkbox"></span><span class="fav-name">${input.value}</span>`
        item.addEventListener('click', (event) => {
          selectedFolder = (event.currentTarget as HTMLElement).textContent ?? ''
        })
        scrollPort.prepend(item)
        input.value = ''
      })
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(nestedContainerScrolled).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toContain('bilimi·影视动漫')
  })

  it('fills and submits the player danmaku input for 表 when it is visible', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="send a friendly danmaku" />
        <button class="bpx-player-dm-btn"></button>
      </section>
      <section id="comment">
        <textarea class="reply-textarea" placeholder="comment here"></textarea>
        <button class="reply-send">publish</button>
      </section>
    `
    const danmakuInput = document.querySelector('.bpx-player-dm-input') as HTMLInputElement
    const commentInput = document.querySelector('.reply-textarea') as HTMLTextAreaElement
    let enterSubmitted = false
    let commentPublished = false
    danmakuInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        enterSubmitted = true
      }
      danmakuInput.value = ''
    })
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      commentPublished = true
    })

    const result = await window.eval(
      buildAutomationScript(
        '\u8868',
        'Bilimi \u5185\u5e93',
        undefined,
        'try the danmaku path first.',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(danmakuInput.value).toBe('')
    expect(commentInput.value).toBe('')
    expect(enterSubmitted).toBe(true)
    expect(commentPublished).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['danmaku:fill', 'danmaku:submit']))
  })

  it('uses Enter to submit danmaku when the button click does not clear the player input', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="send a friendly danmaku" />
        <button class="bpx-player-dm-btn">send</button>
      </section>
      <section id="comment">
        <textarea class="reply-textarea" placeholder="comment here"></textarea>
        <button class="reply-send">publish</button>
      </section>
    `
    const danmakuInput = document.querySelector('.bpx-player-dm-input') as HTMLInputElement
    let buttonClicked = false
    let enterSubmitted = false
    document.querySelector('.bpx-player-dm-btn')?.addEventListener('click', () => {
      buttonClicked = true
    })
    danmakuInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        enterSubmitted = true
        danmakuInput.value = ''
        danmakuInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    const result = await window.eval(
      buildAutomationScript(
        '\u8868',
        'Bilimi \u5185\u5e93',
        undefined,
        'submit with enter fallback.',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(buttonClicked).toBe(false)
    expect(enterSubmitted).toBe(true)
    expect(danmakuInput.value).toBe('')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['danmaku:fill', 'danmaku:submit']))
  })

  it('fills the player danmaku input instead of the lower comment area when configured for manual publish', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="send a friendly danmaku" />
        <button class="bpx-player-dm-btn">send</button>
      </section>
      <section id="comment">
        <div class="reply-box">
          <textarea class="reply-textarea" placeholder="comment here"></textarea>
          <button class="reply-send">publish</button>
        </div>
      </section>
    `
    const danmakuInput = document.querySelector('.bpx-player-dm-input') as HTMLInputElement
    const commentTextarea = document.querySelector('.reply-textarea') as HTMLTextAreaElement

    const draft = 'manual danmaku draft.'
    const result = await window.eval(
      buildAutomationScript(
        '\u8868',
        'Bilimi \u5185\u5e93',
        undefined,
        draft,
        favoriteLedgers,
        'movie-tv',
        { submitComment: false }
      )
    )

    expect(danmakuInput.value).toBe(draft)
    expect(commentTextarea.value).toBe('')
    expect(result.ok).toBe(true)
    expect(result.steps).toContain('danmaku:fill')
    expect(result.steps).toContain('danmaku:awaiting-submit')
  })

  it('publishes from the player danmaku input instead of the lower comment area', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="send a friendly danmaku" />
        <button class="bpx-player-dm-btn">send</button>
      </section>
      <section id="comment">
        <div class="reply-box">
          <textarea class="reply-textarea" placeholder="comment here"></textarea>
          <button class="reply-send">publish</button>
        </div>
      </section>
    `
    const danmakuInput = document.querySelector('.bpx-player-dm-input') as HTMLInputElement
    let enterSubmitted = false
    let commentPublished = false
    danmakuInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        enterSubmitted = true
      }
      danmakuInput.value = ''
    })
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      commentPublished = true
    })

    const result = await window.eval(
      buildAutomationScript(
        '\u8868',
        'Bilimi \u5185\u5e93',
        undefined,
        'auto publish as danmaku.',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(enterSubmitted).toBe(true)
    expect(commentPublished).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['danmaku:fill', 'danmaku:submit']))
  })

  it('does not fall back to lower comments when no player danmaku input is visible', async () => {
    document.body.innerHTML = `
      <section id="comment">
        <div class="reply-box">
          <textarea class="reply-textarea" placeholder="comment here"></textarea>
          <button class="reply-send">publish</button>
        </div>
      </section>
    `
    let commentPublished = false
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      commentPublished = true
    })

    const result = await window.eval(
      buildAutomationScript(
        '\u8868',
        'Bilimi \u5185\u5e93',
        undefined,
        'send this only as danmaku.',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(commentPublished).toBe(false)
    expect((document.querySelector('.reply-textarea') as HTMLTextAreaElement).value).toBe('')
    expect(result.ok).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining(['danmaku:compose-enter']))
    expect(result.steps).not.toContain('danmaku:shortcut:d')
    expect(result.steps).not.toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
    expect(result.missingTargets).toContain('danmaku-field')
  })

})
