# 全局提示、小咪反馈与启动响应 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按需求账本 R001/R002 修复全局提示、无备册小咪反馈和启动阶段输入响应，同时保护既有收藏业务。

**Architecture:** 全局提示只调整渲染投影；动作结果通过可选结构化 `petHint` 向助手传递事实；小咪调度保持现有 gate，仅替换固定短延时为可取消的事件循环让路任务。三部分通过独立单测验证，互不改变 B 站副作用。

**Tech Stack:** Electron, React, TypeScript, Vitest, CSS。

---

### Task 1: 需求与提示渲染回归测试

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`

- [ ] **Step 1: Write failing assertions** — 断言收起悬浮时不再存在按钮外 continuation sibling，展开按钮内包含完整 continuation，且指定掌库文案可由同一按钮承载。
- [ ] **Step 2: Run targeted tests**

Run: `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/feedbackContinuation.test.ts`
Expected: FAIL because current JSX still renders `.feedback-continuation` outside the button.

### Task 2: 无备册赏/藏/赐结构化反馈回归测试

**Files:**
- Modify: `src/renderer/src/features/actions/actionExecutor.test.ts`

- [ ] **Step 1: Write failing assertions** — 对赏、藏、赐分别断言 `favoriteProvisioned: false` 的结果包含动作对应 `petHint`，且包含未备册/未绑定、未写入 B 站和备册指引语义。
- [ ] **Step 2: Run targeted tests**

Run: `npm test -- --run src/renderer/src/features/actions/actionExecutor.test.ts`
Expected: FAIL because `AssistantAutomationResult` 当前没有 `petHint`。

### Task 3: 启动调度回归测试

**Files:**
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`

- [ ] **Step 1: Write failing assertions** — 断言调度器不再使用固定 `FLOATING_SEAL_IDLE_GRACE_MS` 猜测延时，且使用可取消的 `setImmediate`/`setTimeout(0)` 让路任务。
- [ ] **Step 2: Run targeted tests**

Run: `npm test -- --run electron/main/index.mainWindowPetStartup.test.ts`
Expected: FAIL against the existing 250ms timer implementation.

### Task 4: Implement the minimal production changes

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/features/actions/actionExecutor.ts`
- Modify: `src/shared/types.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`

- [ ] **Step 1:** Move continuation rendering entirely inside the feedback toggle and remove the external sibling; keep two-line clamp only in collapsed/non-hover state.
- [ ] **Step 2:** Add `petHint` to result type, populate it only for successful unprovisioned favorite actions, and have `runAction` prefer it.
- [ ] **Step 3:** Replace fixed grace scheduling with a cancellable event-loop yielding task; preserve cancellation and all existing startup gates.
- [ ] **Step 4:** Run targeted tests and then the full suite.

### Task 5: Verify, update ledger evidence, commit and package

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-02-global-feedback-pet-startup.md`
- Create: `.codex-artifacts/` verification logs as needed

- [ ] **Step 1:** Run `npm test`, `npm run build`, and `npm run preview` key paths; record results per R001/R002.
- [ ] **Step 2:** Confirm `git diff --check`, clean unrelated files, and commit the ledger, project book, design, plan, tests and implementation together.
- [ ] **Step 3:** Run `npm run dist:win`, install the generated NSIS package, and record development/preview/installed UI evidence; report any real mouse condition that remains user-only to verify.
