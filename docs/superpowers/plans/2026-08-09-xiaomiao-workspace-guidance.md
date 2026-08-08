# 小咪工作区引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有业务动作的前提下，为工作区入口发布准确的全局说明和小咪提示。

**Architecture:** 新增一个纯数据模块，集中定义六个入口的中性说明和角色提示。`FloatingAssistantApp` 只在用户主动导航或首次打开小咪时发布入口说明，并保持实际动作反馈优先；`ControlledFavoriteLedgerPanel` 通过上层回调在本地收藏库窗口成功打开后发布专属说明。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron IPC。

---

### Task 1: 集中工作区引导文案

**Files:**
- Create: `src/renderer/src/features/assistant/workspaceGuidance.ts`
- Create: `src/renderer/src/features/assistant/workspaceGuidance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { WORKSPACE_GUIDANCE } from './workspaceGuidance'

describe('WORKSPACE_GUIDANCE', () => {
  it('keeps the approved global and pet copy for every workspace entry', () => {
    expect(WORKSPACE_GUIDANCE.review).toEqual({
      global: '批阅：可以一键三连、自动分类收藏（需先在掌库完成备册），发送弹幕（建议开启 DeepSeek 生成）。',
      pet: '小咪切到批阅啦，可以一键三连、自动分类收藏，还能发送弹幕哦～'
    })
    expect(WORKSPACE_GUIDANCE.archive.global).toContain('搜索、备注和批量导出')
    expect(WORKSPACE_GUIDANCE.favoriteLibrary.pet).toBe('主人，收藏库已经打开啦，快看看小咪整理得怎么样呀！')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/renderer/src/features/assistant/workspaceGuidance.test.ts`

Expected: FAIL because `./workspaceGuidance` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
type WorkspaceGuidance = { global: string; pet: string }
export type WorkspaceGuidanceKey =
  | 'review'
  | 'notes'
  | 'archive'
  | 'ledger'
  | 'favoriteLibrary'
  | 'settings'

export const WORKSPACE_GUIDANCE: Record<WorkspaceGuidanceKey, WorkspaceGuidance> = {
  review: { global: '批阅：可以一键三连、自动分类收藏（需先在掌库完成备册），发送弹幕（建议开启 DeepSeek 生成）。', pet: '小咪切到批阅啦，可以一键三连、自动分类收藏，还能发送弹幕哦～' },
  notes: { global: '札记：通过转写音频输出视频文稿；建议在设置页下载并启用识别率更高的转写模型。启用 DeepSeek 后可总结笔记。', pet: '小咪切到札记啦，点击转写音频就能输出视频文稿，还可以用 DeepSeek 总结笔记哦～' },
  archive: { global: '档案库：可以查看已转写成功的视频文稿，支持搜索、备注和批量导出。', pet: '主人，档案库已经打开啦，想看整理好的文稿，随时来找小咪哦～' },
  ledger: { global: '掌库：备册后批阅操作可自动分类保存；“整理收藏”可建立本地收藏库，并将整理结果同步到 B 站。', pet: '小咪切到掌库啦，备册后就可以在 B 站生成 bilimi 收藏夹；以后分类整理视频，安心交给我吧！' },
  favoriteLibrary: { global: '收藏库：bilimi 本地收藏库，支持批量管理所有已整理的视频。', pet: '主人，收藏库已经打开啦，快看看小咪整理得怎么样呀！' },
  settings: { global: '设置：建议配置 DeepSeek、下载更强的转写模型以提升使用体验；支持宠物设置、数据迁移等功能。', pet: '小咪切到设置啦，配置 DeepSeek、下载更好的转写模型，都可以大幅提升小咪的能力哦！' }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run src/renderer/src/features/assistant/workspaceGuidance.test.ts`

Expected: PASS.

### Task 2: Publish top-level and archive guidance from the assistant workspace

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

- [ ] **Step 1: Write failing tests for announcement policy**

Add pure policy coverage that distinguishes `both`, `global-only`, and `none` announcements. Assert that a manual switch to `notes` resolves to `both`, the first floating-window `review` entry resolves to `global-only`, and a status-light or archive-close navigation resolves to `none`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Expected: FAIL because the announcement-policy helper is absent.

- [ ] **Step 3: Implement explicit announcement modes**

Add an exported `WorkspaceGuidanceAnnouncement` union and a pure policy helper in `FloatingAssistantApp.tsx`. Extend `setActiveTab` with an optional announcement mode:

```ts
type WorkspaceGuidanceAnnouncement = 'none' | 'global-only' | 'both'

export function shouldAnnounceWorkspaceGuidance(
  activeTab: AssistantWorkspaceTab,
  nextTab: AssistantWorkspaceTab,
  source: 'top-tab' | 'initial-floating-review' | 'internal'
): WorkspaceGuidanceAnnouncement {
  if (source === 'initial-floating-review') return 'global-only'
  if (source === 'top-tab' && activeTab !== nextTab) return 'both'
  return 'none'
}

function announceWorkspaceGuidance(kind: keyof typeof WORKSPACE_GUIDANCE, mode: WorkspaceGuidanceAnnouncement) {
  if (mode === 'none') return
  const guidance = WORKSPACE_GUIDANCE[kind]
  setGlobalFeedback(guidance.global)
  if (mode === 'both') tellPet('success', guidance.pet)
}
```

Call it with the helper result only from a top-level tab click that changes the selected tab. For a no-action floating-window request that opens the default review workspace, call it with `global-only`. Keep status-light navigation, background-task navigation, archive-close navigation, and repeated tab clicks at `none`.

- [ ] **Step 4: Publish archive guidance only after archive loading succeeds**

Give `loadVideoNoteArchives` an `announceOpen` option. After it returns and the load generation can publish, call `announceWorkspaceGuidance('archive', 'both')` only when `announceOpen === true`; keep silent and background refreshes at `false`.

```ts
const archives = await loadVideoNoteArchives({ announceOpen: true })
setNotesWorkspaceView('noteArchive')
setActiveView('noteArchive')
```

Direct archive workspace requests must call `setActiveTab(..., { view: 'noteArchive' })` without tab guidance, so the archive message is the sole entry introduction.

- [ ] **Step 5: Run focused assistant tests**

Run: `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/AssistantSidebar.test.tsx`

Expected: PASS.

### Task 3: Announce successful local-collection-library opening

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: Write a failing panel test**

Extend the existing “收藏库” toolbar-entry test. Provide an `onFavoriteLibraryOpened` spy, resolve `openFavoriteLibrary`, click the button, wait for the promise, and expect the spy to receive one call. Add a rejected-IPC case and expect no callback.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: FAIL because the completion callback is not part of the panel props.

- [ ] **Step 3: Implement the completion callback and parent publisher**

Add an optional `onFavoriteLibraryOpened` prop. Replace the inline button callback with an async handler that awaits `window.bilimiDesktop?.openFavoriteLibrary?.()` and invokes the callback only after it resolves. In `FloatingAssistantApp`, pass a stable callback that publishes `WORKSPACE_GUIDANCE.favoriteLibrary` to both channels.

- [ ] **Step 4: Run focused panel and assistant tests**

Run: `npm test -- --run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Expected: PASS.

### Task 4: Verify the user-facing regression surface and record the design

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-xiaomiao-workspace-guidance-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-xiaomiao-workspace-guidance.md`

- [ ] **Step 1: Run all assistant-area regression tests**

Run: `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run repository hygiene checks**

Run: `git diff --check; git diff --stat; git status --short`

Expected: no whitespace errors; only the implementation, tests, and two guidance documents are changed.

- [ ] **Step 3: Manually verify in the Electron development build**

Run: `npm run dev`

Verify that opening the pet leaves the greeting visible while the global status shows review guidance; switching each top-level tab updates both channels once; archive and collection-library entry messages arrive only after opening; status lights and real action feedback do not produce duplicate introductions. Also verify mouse movement, clicks, scroll, window resize, minimize, and close remain responsive.

- [ ] **Step 4: Commit the completed discussion round**

Run:

```powershell
git add docs/superpowers/specs/2026-08-09-xiaomiao-workspace-guidance-design.md docs/superpowers/plans/2026-08-09-xiaomiao-workspace-guidance.md src/renderer/src/features/assistant/workspaceGuidance.ts src/renderer/src/features/assistant/workspaceGuidance.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
git commit -m "feat: guide assistant workspaces"
```

Expected: one local commit containing only this round’s work.
