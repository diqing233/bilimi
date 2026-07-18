import { describe, expect, it } from 'vitest'
import { OldFavoritePersistenceDirtyTracker } from './oldFavoritePersistenceDirtyTracker'

describe('OldFavoritePersistenceDirtyTracker', () => {
  it('returns to clean after an ordinary successful mutation', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    const mutation = tracker.beginMutation()
    expect(tracker.isDirty()).toBe(true)

    tracker.finishMutation(mutation)
    expect(tracker.isDirty()).toBe(false)
  })

  it('stays dirty until every concurrent mutation succeeds', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    const first = tracker.beginMutation()
    const second = tracker.beginMutation()
    tracker.finishMutation(second)

    expect(tracker.isDirty()).toBe(true)
    tracker.finishMutation(first)
    expect(tracker.isDirty()).toBe(false)
  })

  it('keeps a failed mutation dirty until an explicit flush succeeds', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    tracker.beginMutation()
    const checkpoint = tracker.captureFlushCheckpoint()

    expect(tracker.isDirty()).toBe(true)
    tracker.completeFlush(checkpoint)
    expect(tracker.isDirty()).toBe(false)
  })

  it('preserves mutations that begin after a flush checkpoint', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    const beforeFlush = tracker.beginMutation()
    const checkpoint = tracker.captureFlushCheckpoint()
    tracker.finishMutation(beforeFlush)
    tracker.beginMutation()
    tracker.completeFlush(checkpoint)

    expect(tracker.isDirty()).toBe(true)
  })

  it('does not clear an earlier failure when a later mutation succeeds', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    tracker.beginMutation()
    const laterSuccess = tracker.beginMutation()
    tracker.finishMutation(laterSuccess)

    expect(tracker.isDirty()).toBe(true)
  })

  it('clears only the failed mutation captured by a flush when a later mutation succeeds', () => {
    const tracker = new OldFavoritePersistenceDirtyTracker()

    tracker.beginMutation()
    const checkpoint = tracker.captureFlushCheckpoint()
    const laterSuccess = tracker.beginMutation()
    tracker.finishMutation(laterSuccess)
    tracker.completeFlush(checkpoint)

    expect(tracker.isDirty()).toBe(false)
  })
})
