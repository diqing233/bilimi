# Settings Background Preference Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settings clicks update immediately while ordinary preference persistence is coalesced and moved out of the hot click path.

**Architecture:** Add a small renderer-side preference save scheduler that performs optimistic updates, debounces ordinary saves, serializes in-flight saves, and exposes `flush()`. Keep the main process preference handler compatible with the existing store, but make it accept already-normalized full snapshots and avoid snapshot refreshes; the current single batched store write remains the durable sink for this implementation pass. If manual verification still shows a mouse hitch after this pass, the next follow-up is a worker/utility-process disk writer.

**Tech Stack:** React 19, Electron IPC, TypeScript, Vitest, Testing Library.

---

## File Structure

- Create `src/renderer/src/features/state/preferenceSaveScheduler.ts`
  - Pure TypeScript scheduler with no React dependency.
  - Owns debounce, latest-wins queueing, in-flight serialization, and flush behavior.
- Create `src/renderer/src/features/state/preferenceSaveScheduler.test.ts`
  - Unit tests for optimistic scheduling behavior, coalescing, serialization, flush, and retry.
- Modify `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
  - Replace direct ordinary settings persistence with scheduler-backed patch persistence.
  - Keep explicit DeepSeek save/reset/test paths awaiting `flush()`.
  - Use preference patches merged against `preferencesRef.current` so rapid clicks do not lose earlier local changes.
- Modify `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
  - Add interaction tests for immediate control response before save resolves.
  - Add rapid-click test covering latest preference state.
  - Keep the existing "no snapshot refresh" regression.
- Modify `electron/main/store.test.ts`
  - Keep the single-batch store write test.
  - Add a guard that `saveAssistantPreferences` still returns normalized preferences after batched writes.

---

### Task 1: Pure Preference Save Scheduler

**Files:**
- Create: `src/renderer/src/features/state/preferenceSaveScheduler.ts`
- Create: `src/renderer/src/features/state/preferenceSaveScheduler.test.ts`

- [ ] **Step 1: Write failing tests for coalescing and serialization**

Create `src/renderer/src/features/state/preferenceSaveScheduler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createPreferenceSaveScheduler } from './preferenceSaveScheduler'

type TestPreferences = {
  defaultCoinCount: 1 | 2
  commentSubmitMode: 'choose' | 'random'
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

describe('createPreferenceSaveScheduler', () => {
  it('debounces rapid changes and saves the latest snapshot only', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (preferences: TestPreferences) => preferences)
    const scheduler = createPreferenceSaveScheduler<TestPreferences>({
      delayMs: 250,
      save
    })

    scheduler.schedule({ defaultCoinCount: 1, commentSubmitMode: 'random' })
    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'choose' })

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    vi.useRealTimers()
  })

  it('serializes in-flight saves and only writes the latest pending snapshot next', async () => {
    vi.useFakeTimers()
    const first = createDeferred<TestPreferences>()
    const save = vi
      .fn<(_: TestPreferences) => Promise<TestPreferences>>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (preferences) => preferences)
    const scheduler = createPreferenceSaveScheduler<TestPreferences>({
      delayMs: 100,
      save
    })

    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'random' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)

    scheduler.schedule({ defaultCoinCount: 1, commentSubmitMode: 'choose' })
    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve({ defaultCoinCount: 2, commentSubmitMode: 'random' })
    await vi.runOnlyPendingTimersAsync()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/renderer/src/features/state/preferenceSaveScheduler.test.ts
```

Expected: fail because `preferenceSaveScheduler.ts` does not exist.

- [ ] **Step 3: Implement the scheduler**

Create `src/renderer/src/features/state/preferenceSaveScheduler.ts`:

```ts
type PreferenceSaveSchedulerOptions<TPreferences> = {
  delayMs: number
  save: (preferences: TPreferences) => Promise<TPreferences>
}

export type PreferenceSaveScheduler<TPreferences> = {
  flush: () => Promise<TPreferences | null>
  schedule: (preferences: TPreferences) => void
}

export function createPreferenceSaveScheduler<TPreferences>({
  delayMs,
  save
}: PreferenceSaveSchedulerOptions<TPreferences>): PreferenceSaveScheduler<TPreferences> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<TPreferences | null> | null = null
  let pending: TPreferences | null = null
  let lastSaved: TPreferences | null = null

  function clearTimer() {
    if (timer === null) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  async function drain(): Promise<TPreferences | null> {
    if (inFlight) {
      return inFlight
    }

    inFlight = (async () => {
      try {
        while (pending) {
          const next = pending
          pending = null
          lastSaved = await save(next)
        }

        return lastSaved
      } finally {
        inFlight = null
        if (pending) {
          void drain()
        }
      }
    })()

    return inFlight
  }

  function schedule(preferences: TPreferences) {
    pending = preferences
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void drain()
    }, delayMs)
  }

  async function flush() {
    clearTimer()
    return drain()
  }

  return { flush, schedule }
}
```

- [ ] **Step 4: Run scheduler tests to verify they pass**

Run:

```bash
npm test -- src/renderer/src/features/state/preferenceSaveScheduler.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit scheduler**

Run:

```bash
git add src/renderer/src/features/state/preferenceSaveScheduler.ts src/renderer/src/features/state/preferenceSaveScheduler.test.ts
git commit -m "feat: add preference save scheduler"
```

---

### Task 2: Settings UI Integration and Frontend Stability

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Write failing tests for immediate UI response and rapid patch merging**

Add tests near the existing settings persistence tests in `FloatingAssistantApp.test.tsx`:

```tsx
  it('updates review action settings before the background save resolves', async () => {
    let resolveSave!: (preferences: AssistantPreferences) => void
    const savePreferences = vi.fn(
      (preferences: AssistantPreferences) =>
        new Promise<AssistantPreferences>((resolve) => {
          resolveSave = resolve
        })
    )
    installDesktopApi({ savePreferences })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    expect(screen.getByRole('radio', { name: '默认投 2 枚硬币' })).toBeChecked()
    expect(savePreferences).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    })

    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce())
    await act(async () => {
      resolveSave(createPreferences({ defaultCoinCount: 2 }))
    })
  })

  it('keeps rapid settings clicks merged against the latest local preferences', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({ savePreferences })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))
    fireEvent.click(
      screen.getByRole('radio', {
        name: '生成 3 条候选，选择后发送（也可以复制后发评论）'
      })
    )

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          commentSubmitMode: 'choose',
          defaultCoinCount: 2
        })
      )
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: at least the immediate response/background save test fails because direct `persistPreferences` calls save immediately.

- [ ] **Step 3: Integrate scheduler in `FloatingAssistantApp`**

Modify imports:

```ts
import { createPreferenceSaveScheduler } from '../state/preferenceSaveScheduler'
```

Add refs inside `FloatingAssistantApp` after `lastPreferenceSaveAt`:

```ts
  const preferenceSaveScheduler = useRef<ReturnType<
    typeof createPreferenceSaveScheduler<AssistantPreferences>
  > | null>(null)
```

Replace `persistPreferences` with patch helpers:

```ts
  function applyPreferenceSnapshot(nextPreferences: AssistantPreferences) {
    preferencesRef.current = nextPreferences
    setPreferences(nextPreferences)
  }

  function getPreferenceSaveScheduler() {
    if (!preferenceSaveScheduler.current) {
      preferenceSaveScheduler.current = createPreferenceSaveScheduler<AssistantPreferences>({
        delayMs: 250,
        save: async (nextPreferences) => {
          if (!window.bilimiDesktop?.savePreferences) {
            return nextPreferences
          }

          const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
          const savedPreferences = createInitialAssistantPreferences(saved)
          preferencesRef.current = savedPreferences
          setPreferences(savedPreferences)
          lastPreferenceSaveAt.current = Date.now()
          return savedPreferences
        }
      })
    }

    return preferenceSaveScheduler.current
  }

  function persistPreferencePatch(patch: Partial<AssistantPreferences>) {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferencesRef.current,
      ...patch
    })
    applyPreferenceSnapshot(nextPreferences)
    getPreferenceSaveScheduler().schedule(nextPreferences)
  }

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    const normalizedPreferences = createInitialAssistantPreferences(nextPreferences)
    applyPreferenceSnapshot(normalizedPreferences)
    getPreferenceSaveScheduler().schedule(normalizedPreferences)
    const savedPreferences = await getPreferenceSaveScheduler().flush()
    if (savedPreferences) {
      applyPreferenceSnapshot(savedPreferences)
      return savedPreferences
    }

    return normalizedPreferences
  }
```

Update ordinary settings handlers from object-spread snapshots to patches:

```ts
  function choosePetStyle(petStyle: AssistantPreferences['petStyle']) {
    tellPet('success', petStyle === 'big-head' ? '小咪换回萌版大头啦。' : '小咪换成Q版小人啦。')
    persistPreferencePatch({ petStyle })
  }

  function toggleVideoFullscreenPetVisibility(hidePetDuringVideoFullscreen: boolean) {
    tellPet(
      'success',
      hidePetDuringVideoFullscreen
        ? '全屏看视频时，小咪会先让出画面。'
        : '小咪会常驻陪主人看视频啦。'
    )
    persistPreferencePatch({ hidePetDuringVideoFullscreen })
  }
```

For inline radio changes, replace each `void persistPreferences({ ...preferences, key: value })` with `persistPreferencePatch({ key: value })`. Keep explicit `await persistPreferences(...)` in `saveDeepSeekSettings`, `resetDeepSeekSettings`, and ledger fallback paths.

- [ ] **Step 4: Run FloatingAssistantApp tests**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit UI integration**

Run:

```bash
git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
git commit -m "feat: save settings preferences in background"
```

---

### Task 3: Store Guard Tests and Final Verification

**Files:**
- Modify: `electron/main/store.test.ts`

- [ ] **Step 1: Add a normalization guard test for batched preference saves**

Add near the existing single-batch test in `electron/main/store.test.ts`:

```ts
  it('normalizes invalid preference values during a batched save', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      petStyle: 'invalid' as never,
      defaultCoinCount: 9 as never,
      commentSubmitMode: 'manual' as never,
      favoriteArchiveMultiMode: 'many' as never
    })

    expect(saved).toMatchObject({
      commentSubmitMode: 'choose',
      defaultCoinCount: 1,
      favoriteArchiveMultiMode: 'off',
      petStyle: 'big-head'
    })
    expect(store.setCalls).toHaveLength(1)
  })
```

- [ ] **Step 2: Run store tests**

Run:

```bash
npm test -- electron/main/store.test.ts
```

Expected: pass.

- [ ] **Step 3: Run focused regression tests**

Run:

```bash
npm test -- src/renderer/src/features/state/preferenceSaveScheduler.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx electron/main/store.test.ts
```

Expected: pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass. Existing unrelated React `act(...)` warnings may appear in `PalaceMaidPetApp.test.tsx`; do not change those unless a test fails.

- [ ] **Step 5: Commit final test guard**

Run:

```bash
git add electron/main/store.test.ts
git commit -m "test: guard settings preference normalization"
```

---

## Spec Coverage Self-Review

- Optimistic UI updates: Task 2.
- Background/coalesced renderer persistence: Task 1 and Task 2.
- In-flight save serialization: Task 1.
- No snapshot refresh for ordinary settings: already covered by existing regression and preserved in Task 2.
- Explicit DeepSeek save/test behavior: Task 2 keeps `persistPreferences(...).flush()` behavior for explicit paths.
- Store compatibility and normalization: Task 3.
- Verification and manual acceptance: Task 3.

This plan intentionally defers a custom async file writer or worker process. The current code already reduced disk persistence to one batched store write; this implementation removes it from the immediate click path and coalesces bursts. If manual testing still shows mouse hitches after this plan, create a follow-up plan for a worker/utility-process persistence backend.
