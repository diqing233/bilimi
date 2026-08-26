# Remove Bili WebView Loading Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the retired central, full-page “正在加载 B 站页面…” feedback without changing WebView navigation, error recovery, target reporting, tab switching, or B 站 business actions.

**Architecture:** `BiliWebview` will no longer create a React loading-display state or render `.browser-loading`. Its WebView readiness and failure event handlers remain responsible for account/target reporting, archival seeking, and failure-card recovery. The existing error cards remain the only full-page browser feedback because they represent real load failures and expose recovery actions.

**Tech Stack:** React, TypeScript, Electron `<webview>`, Vitest, Testing Library, CSS, Electron development build.

---

### Task 1: Retire the central loading overlay with a RED → GREEN regression

**Files:**

- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write the failing UI regression test.**

  Remove the three old lifecycle tests that assert a loading status is first visible and later disappears (already-ready guest, `dom-ready`, and `did-stop-loading`). Replace the obsolete navigation test that expects `screen.getByRole('status')` during navigation with the following assertion. Keep the existing proxy-failure and generic-load-failure tests unchanged.

  ```tsx
  it('never renders retired full-page loading feedback while the page initializes or navigates', () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag

    expect(screen.queryByRole('status', { name: 'B 站页面加载中' })).not.toBeInTheDocument()

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true }))
    })

    expect(screen.queryByRole('status', { name: 'B 站页面加载中' })).not.toBeInTheDocument()
  })
  ```

- [x] **Step 2: Run the isolated regression and verify RED.**

  Run:

  ```powershell
  npm exec vitest -- run src/renderer/src/features/browser/BiliWebview.test.tsx -t "never renders retired full-page loading feedback"
  ```

  Expected: the assertion fails because the current component initially renders the `role="status"` overlay.

- [x] **Step 3: Make the smallest production change.**

  In `BiliWebview.tsx`, remove the `loading` React state and only its `setLoading(true|false)` calls. Retain `handleLoadSuccess`, `handleDomReady`, `did-stop-loading`, `settleInitialLoadIfReady`, `reportTargetState`, all failure-state resets, link capture, danmaku repaint, archival seek, and navigation-epoch reporting. Remove the JSX section whose class is `browser-loading`. In `styles.css`, delete only `.browser-loading` and `.browser-loading p`; leave `.browser-proxy-error` unchanged.

- [x] **Step 4: Run GREEN and browser-module regressions.**

  Run:

  ```powershell
  npm exec vitest -- run src/renderer/src/features/browser/BiliWebview.test.tsx src/renderer/src/styles.test.ts
  ```

  Expected: zero failures; no test may assert that a loading status is visible, while existing real failure-card tests still pass.

### Task 2: Read-only Electron acceptance and auditable evidence

**Files:**

- Create: `.codex-artifacts/2026-08-26-webview-navigation-without-loading-overlay.jpg`
- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`

- [x] **Step 1: Start the Electron development app and navigate/read-only refresh a B 站 page.**

  Verify separately that initial navigation and a manual page refresh never show “正在加载 B 站页面…”, while the page remains visible and usable. Do not create, bind, delete, move, collect, or write any B 站 data or videos.

  Status: the existing video page and a manual read-only refresh were accepted and captured. A fresh-tab navigation was not performed because Computer Use detected user input in the target Electron window before that click; the automated regression covers initial render and main-frame navigation instead.

- [x] **Step 2: Save evidence and update I003.**

  Save the screenshot at the specified artifact path. Add an I003 implementation record containing exact code paths, test command/result, Electron screenshot path, retained failure-card boundary, and the fact that no real B 站 side effect was performed.

### Task 3: Whole-task verification and selective local commit

**Files:**

- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`
- Create: `docs/superpowers/plans/2026-08-26-remove-bili-webview-loading-overlay.md`

- [ ] **Step 1: Verify static integrity and the required test surface.**

  Run:

  ```powershell
  npm exec vitest -- run src/renderer/src/features/browser/BiliWebview.test.tsx src/renderer/src/styles.test.ts
  npm run build
  git diff --check
  git diff --stat
  git status --short
  ```

  Expected: tests and build exit 0; `git diff --check` has no whitespace error; only the task files above are selected for commit.

  Status: `npm exec vitest -- run src/renderer/src/features/browser/BiliWebview.test.tsx src/renderer/src/styles.test.ts` fresh through at 89/89; `npm run build` fresh through. `git diff --check` has no whitespace error. The full-suite terminal session completed, but its output was truncated before its final summary, so it is not used as passing evidence for this commit.

- [ ] **Step 2: Re-read the full ledger and index, then commit only I003.**

  Confirm the I003 evidence covers central-overlay absence, preserved real failure feedback, unchanged navigation/target reporting boundary, Electron read-only acceptance, and no B 站 write. Stage only the five task files listed above, explicitly excluding `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then create one local commit.
