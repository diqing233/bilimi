import { describe, expect, it } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { buildAutomationScript } from './pageAutomation'

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
      buildAutomationScript('藏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(likeClicked).toBe(false)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toBe('Bilimi·影视动漫')
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'favorite:create-defaults', 'favorite:folder', 'favorite'])
    )
  })

  it('likes and saves the current page into the Bilimi favorites folder for 赏', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button>Bilimi 内库</button>
      <button>完成</button>
    `

    const result = await window.eval(
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      <button>Bilimi·影视动漫</button>
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
      buildAutomationScript('赐', 'Bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(twoCoinSelected).toBe(true)
    expect(coinConfirmed).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'favorite:folder', 'favorite', 'coin:open', 'coin:2', 'coin:confirm'])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('selects and confirms the bilibili coin dialog when controls are not buttons', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button aria-label="投币">投币</button>
      <button>Bilimi·影视动漫</button>
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
      buildAutomationScript('赐', 'Bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赐', 'Bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
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
      <button>Bilimi·影视动漫</button>
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
      buildAutomationScript('赐', 'Bilimi 内库', 2, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      <button>Bilimi 内库</button>
      <button>完成</button>
    `

    const result = await window.eval(
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
            <button>Bilimi 内库</button>
            <button>完成</button>
          `
        )
      }, 10)
    })

    const result = await window.eval(
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toBe('Bilimi·影视动漫')
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
      buildAutomationScript('藏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
            <button class="fav-item">Bilimi·影视动漫</button>
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(selectedFolder).toBe('Bilimi·影视动漫')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'knowledge')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(['Bilimi·知识学习'])
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(scrolledToBottom).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toContain('Bilimi·影视动漫')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, favoriteLedgers, 'movie-tv')
    )

    expect(result.ok).toBe(true)
    expect(nestedContainerScrolled).toBe(true)
    expect(createdFolders).toEqual(enabledLedgerNames)
    expect(selectedFolder).toContain('Bilimi·影视动漫')
  })

  it('fills the comment box and submits the selected draft for 表', async () => {
    document.body.innerHTML = `
      <textarea placeholder="发一条友善的评论"></textarea>
      <button>发布</button>
    `

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement

    const draft = '臣谨以此条进呈陛下，笑意不敢私藏。'
    const result = await window.eval(
      buildAutomationScript('表', 'Bilimi 内库', undefined, draft, favoriteLedgers, 'movie-tv')
    )

    expect(textarea.value).toBe(draft)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
    expect(result.missingTargets).toEqual([])
  })

  it('fills the comment box without submitting when 表 is configured for manual publish', async () => {
    document.body.innerHTML = `
      <section class="reply-box">
        <textarea placeholder="发一条友善的评论"></textarea>
        <div class="reply-send primary">发布</div>
      </section>
    `
    let submitted = false
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      submitted = true
    })

    const draft = '小咪先把评论放好，主人确认后再发。'
    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        draft,
        favoriteLedgers,
        'movie-tv',
        { submitComment: false }
      )
    )

    expect(textarea.value).toBe(draft)
    expect(submitted).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.steps).toContain('comment:fill')
    expect(result.steps).not.toContain('comment:submit')
    expect(result.missingTargets).toEqual([])
    expect(result.message).toContain('评论已填好')
  })

  it('fills the visible Bilibili comment box instead of an earlier hidden textarea', async () => {
    document.body.innerHTML = `
      <textarea class="offscreen-draft" style="display: none"></textarea>
      <section class="reply-box">
        <textarea class="reply-textarea" placeholder="下面我简单喵两句"></textarea>
        <div class="reply-send primary">发布</div>
      </section>
    `
    const hiddenTextarea = document.querySelector('.offscreen-draft') as HTMLTextAreaElement
    const visibleTextarea = document.querySelector('.reply-textarea') as HTMLTextAreaElement

    const draft = '这条应该进入可见评论框。'
    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        draft,
        favoriteLedgers,
        'movie-tv',
        { submitComment: false }
      )
    )

    expect(hiddenTextarea.value).toBe('')
    expect(visibleTextarea.value).toBe(draft)
    expect(result.ok).toBe(true)
    expect(result.steps).toContain('comment:fill')
  })

  it('fills the lower comment area instead of the player danmaku input', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="发个友善的弹幕见证当下" />
        <button class="bpx-player-dm-btn">发送</button>
      </section>
      <section id="comment">
        <div class="reply-box">
          <textarea class="reply-textarea" placeholder="只是一 直在等你而已，才不是想被评论呢～"></textarea>
          <button class="reply-send">发布</button>
        </div>
      </section>
    `
    const danmakuInput = document.querySelector('.bpx-player-dm-input') as HTMLInputElement
    const commentTextarea = document.querySelector('.reply-textarea') as HTMLTextAreaElement

    const draft = '这条应该进入截图里圈出的评论区。'
    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        draft,
        favoriteLedgers,
        'movie-tv',
        { submitComment: false }
      )
    )

    expect(danmakuInput.value).toBe('')
    expect(commentTextarea.value).toBe(draft)
    expect(result.ok).toBe(true)
    expect(result.steps).toContain('comment:fill')
  })

  it('publishes from the lower comment area instead of clicking the danmaku send button', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="发个友善的弹幕见证当下" />
        <button class="bpx-player-dm-btn">发送</button>
      </section>
      <section id="comment">
        <div class="reply-box">
          <textarea class="reply-textarea" placeholder="只是一 直在等你而已，才不是想被评论呢～"></textarea>
          <button class="reply-send">发布</button>
        </div>
      </section>
    `
    let danmakuSent = false
    let commentPublished = false
    document.querySelector('.bpx-player-dm-btn')?.addEventListener('click', () => {
      danmakuSent = true
    })
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      commentPublished = true
    })

    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        '自动发布也只能点评论区发布。',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(danmakuSent).toBe(false)
    expect(commentPublished).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
  })

  it('scrolls the lower comment area into view before waiting for a lazily mounted editor', async () => {
    document.body.innerHTML = `
      <section class="bpx-player-sending-area">
        <input class="bpx-player-dm-input" type="text" placeholder="发个友善的弹幕见证当下" />
        <button class="bpx-player-dm-btn">发送</button>
      </section>
      <section id="comment">
        <h2>评论 2196</h2>
      </section>
    `
    const commentRoot = document.querySelector('#comment') as HTMLElement
    let scrolledToComment = false
    commentRoot.scrollIntoView = vi.fn(() => {
      scrolledToComment = true
      if (!document.querySelector('.reply-box')) {
        commentRoot.insertAdjacentHTML(
          'beforeend',
          `
            <div class="reply-box">
              <textarea class="reply-textarea" placeholder="只是一 直在等你而已，才不是想被评论呢～"></textarea>
              <button class="reply-send">发布</button>
            </div>
          `
        )
      }
    })
    let commentPublished = false
    commentRoot.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).classList.contains('reply-send')) {
        commentPublished = true
      }
    })

    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        '滚到评论区后再填这条。',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(scrolledToComment).toBe(true)
    expect((document.querySelector('.reply-textarea') as HTMLTextAreaElement).value).toBe(
      '滚到评论区后再填这条。'
    )
    expect(commentPublished).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
  })

  it('clicks the inactive Bilibili comment box before filling and publishing', async () => {
    document.body.innerHTML = `
      <section id="comment">
        <h2>评论 233</h2>
        <div class="reply-box">
          <div class="reply-box-placeholder">新的风暴已经出现，你的妙评何时再现</div>
        </div>
      </section>
    `
    const replyBox = document.querySelector('.reply-box') as HTMLElement
    let activated = false
    let commentPublished = false
    replyBox.addEventListener('click', () => {
      if (activated) {
        return
      }

      activated = true
      replyBox.innerHTML = `
        <textarea class="reply-textarea" placeholder="新的风暴已经出现，你的妙评何时再现"></textarea>
        <button class="reply-send">发布</button>
      `
      replyBox.querySelector('.reply-send')?.addEventListener('click', () => {
        commentPublished = true
      })
    })

    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        '点击评论框后才能发布这条。',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(activated).toBe(true)
    expect((document.querySelector('.reply-textarea') as HTMLTextAreaElement).value).toBe(
      '点击评论框后才能发布这条。'
    )
    expect(commentPublished).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'comment:root',
        'comment:reveal',
        'comment:activate',
        'comment:focus',
        'comment:fill',
        'comment:submit'
      ])
    )
  })

  it('uses editable insertion for Bilibili contenteditable comment boxes', async () => {
    document.body.innerHTML = `
      <section class="reply-box">
        <div class="reply-box-textarea" contenteditable="true" data-placeholder="勇敢滴少年啊快去创造热评~"></div>
        <div class="reply-send primary">发布</div>
      </section>
    `
    const editor = document.querySelector('.reply-box-textarea') as HTMLDivElement
    const insertedText: string[] = []
    const originalExecCommand = document.execCommand
    document.execCommand = ((command: string, _showUi?: boolean, value?: string) => {
      if (command === 'insertText' && value) {
        insertedText.push(value)
        editor.textContent = value
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
        return true
      }

      return false
    }) as typeof document.execCommand

    try {
      const draft = '这条应该通过插入文本进入编辑器。'
      const result = await window.eval(
        buildAutomationScript(
          '表',
          'Bilimi 内库',
          undefined,
          draft,
          favoriteLedgers,
          'movie-tv',
          { submitComment: false }
        )
      )

      expect(insertedText).toEqual([draft])
      expect(editor.textContent).toBe(draft)
      expect(result.ok).toBe(true)
      expect(result.steps).toContain('comment:fill')
    } finally {
      document.execCommand = originalExecCommand
    }
  })

  it('does not submit 表 when the visible comment editor rejects the draft text', async () => {
    document.body.innerHTML = `
      <section class="reply-box">
        <div class="reply-box-textarea" contenteditable="true" data-placeholder="勇敢滴少年啊快去创造热评~"></div>
        <div class="reply-send primary">发布</div>
      </section>
    `
    let submitted = false
    const editor = document.querySelector('.reply-box-textarea') as HTMLDivElement
    const originalExecCommand = document.execCommand
    document.execCommand = (() => true) as typeof document.execCommand
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      submitted = true
    })

    try {
      const result = await window.eval(
        buildAutomationScript(
          '表',
          'Bilimi 内库',
          undefined,
          '页面拒绝接收这条评论。',
          favoriteLedgers,
          'movie-tv',
          { submitComment: true }
        )
      )

      expect(editor.textContent).toBe('')
      expect(submitted).toBe(false)
      expect(result.ok).toBe(false)
      expect(result.steps).not.toContain('comment:fill')
      expect(result.steps).not.toContain('comment:submit')
      expect(result.missingTargets).toContain('comment-fill')
    } finally {
      document.execCommand = originalExecCommand
    }
  })

  it('finds the Bilibili reply send control when 表 is configured for one-click publish', async () => {
    document.body.innerHTML = `
      <section class="reply-box">
        <textarea placeholder="发一条友善的评论"></textarea>
        <div class="reply-send primary"><span>发布</span></div>
      </section>
    `
    let submitted = false
    document.querySelector('.reply-send')?.addEventListener('click', () => {
      submitted = true
    })

    const result = await window.eval(
      buildAutomationScript(
        '表',
        'Bilimi 内库',
        undefined,
        '自动发送这条评论。',
        favoriteLedgers,
        'movie-tv',
        { submitComment: true }
      )
    )

    expect(result.ok).toBe(true)
    expect(submitted).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
    expect(result.missingTargets).toEqual([])
  })
})
