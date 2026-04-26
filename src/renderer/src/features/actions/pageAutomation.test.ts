import { describe, expect, it } from 'vitest'
import { buildAutomationScript } from './pageAutomation'

describe('buildAutomationScript', () => {
  it('likes and saves the current page into the Bilimi favorites folder for 赏', async () => {
    document.body.innerHTML = `
      <button aria-label="点赞">点赞</button>
      <button aria-label="收藏">收藏</button>
      <button>Bilimi 内库</button>
      <button>完成</button>
    `

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库'))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'favorite:folder', 'favorite'])
    )
    expect(result.missingTargets).toEqual([])
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

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库'))

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

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库'))

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

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, 'funny'))

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual([
      'Bilimi｜解闷小品',
      'Bilimi｜见闻增广',
      'Bilimi｜剧情留档',
      'Bilimi｜谨慎观察'
    ])
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

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, 'funny'))

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual([
      'Bilimi｜解闷小品',
      'Bilimi｜见闻增广',
      'Bilimi｜剧情留档',
      'Bilimi｜谨慎观察'
    ])
    expect(selectedFolder).toBe('Bilimi｜解闷小品')
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
            <button class="fav-item">Bilimi｜解闷小品</button>
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

    const result = await window.eval(buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, 'funny'))

    expect(result.ok).toBe(true)
    expect(selectedFolder).toBe('Bilimi｜解闷小品')
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
      buildAutomationScript('赏', 'Bilimi 内库', undefined, undefined, 'knowledge')
    )

    expect(result.ok).toBe(true)
    expect(createdFolders).toEqual(['Bilimi｜见闻增广'])
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:create-category', 'favorite:folder', 'favorite'])
    )
  })

  it('fills the comment box and submits the selected draft for 表', async () => {
    document.body.innerHTML = `
      <textarea placeholder="发一条友善的评论"></textarea>
      <button>发布</button>
    `

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement

    const draft = '臣谨以此条进呈陛下，笑意不敢私藏。'
    const result = await window.eval(buildAutomationScript('表', 'Bilimi 内库', undefined, draft))

    expect(textarea.value).toBe(draft)
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining(['comment:fill', 'comment:submit']))
    expect(result.missingTargets).toEqual([])
  })
})
