import { describe, expect, it } from 'vitest'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

describe('FavoriteRepositoryRemoteOperationArbiter', () => {
  it('waits for submitted work before running exclusive session maintenance', async () => {
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const events: string[] = []
    let releaseActive: (() => void) | undefined
    const active = arbiter.run('100', async () => {
      events.push('active-start')
      await new Promise<void>((resolve) => { releaseActive = resolve })
      events.push('active-end')
    })
    const maintenance = arbiter.runExclusive(async () => { events.push('maintenance') })
    const queued = arbiter.run('100', async () => { events.push('queued') })

    await Promise.resolve()
    expect(events).toEqual(['active-start'])
    releaseActive?.()
    await Promise.all([active, maintenance, queued])
    expect(events).toEqual(['active-start', 'active-end', 'maintenance', 'queued'])
  })

  it('serializes remote operations for one account without blocking another account', async () => {
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = arbiter.run('100', async () => {
      events.push('first-start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      events.push('first-end')
    })
    const second = arbiter.run('100', async () => { events.push('second') })
    const other = arbiter.run('101', async () => { events.push('other') })

    await other
    expect(events).toEqual(['first-start', 'other'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'other', 'first-end', 'second'])
  })

  it('runs queued operations by priority after the active operation finishes', async () => {
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const events: string[] = []
    let releaseActive: (() => void) | undefined
    const active = arbiter.run('100', async () => {
      events.push('active')
      await new Promise<void>((resolve) => { releaseActive = resolve })
    })
    const bulk = arbiter.enqueue('100', { priority: 'bulk' }, async () => { events.push('bulk') })
    const reconcile = arbiter.enqueue('100', { priority: 'reconcile' }, async () => { events.push('reconcile') })

    releaseActive?.()
    await Promise.all([active, bulk, reconcile])

    expect(events).toEqual(['active', 'reconcile', 'bulk'])
  })

  it('replaces a pending intent for the same video with the newest intent', async () => {
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const events: string[] = []
    let releaseActive: (() => void) | undefined
    const active = arbiter.run('100', async () => {
      await new Promise<void>((resolve) => { releaseActive = resolve })
    })
    const first = arbiter.enqueue('100', { priority: 'bulk', videoKey: '100:42' }, async () => { events.push('first') })
    const latest = arbiter.enqueue('100', { priority: 'user-single', videoKey: '100:42' }, async () => { events.push('latest') })

    releaseActive?.()
    await expect(first).rejects.toMatchObject({ code: 'REMOTE_OPERATION_SUPERSEDED' })
    await latest

    expect(events).toEqual(['latest'])
  })
})
