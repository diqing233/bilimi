import { describe, expect, it } from 'vitest'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

describe('FavoriteRepositoryRemoteOperationArbiter', () => {
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
})
