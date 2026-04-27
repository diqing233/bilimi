# Auto Favorite Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify the active Bilibili video from local page content and save it into Bilimi-owned category folders without modifying personal folders.

**Architecture:** Add a local keyword classifier under renderer recommendation code. `AssistantOverlay` will compute the current category from title/page content and pass that category to the existing favorite automation, which already creates/selects `Bilimi` category folders. `App` will provide a page-content reader backed by the active webview.

**Tech Stack:** React 19, Electron webview, TypeScript, Vitest.

---

### Task 1: Local Video Classifier

**Files:**
- Create: `src/renderer/src/features/recommendation/videoClassifier.ts`
- Test: `src/renderer/src/features/recommendation/videoClassifier.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' })).toBe('knowledge')
expect(classifyVideoContent({ title: '第十二集剧情反转名场面' })).toBe('story')
expect(classifyVideoContent({ title: '爆笑整活合集' })).toBe('funny')
expect(classifyVideoContent({ title: '带货广告避雷测评' })).toBe('suspicious')
```

- [ ] **Step 2: Run tests and see failure**

Run: `npm test -- src/renderer/src/features/recommendation/videoClassifier.test.ts`

- [ ] **Step 3: Implement classifier and page context script**

Use weighted local keywords. Prefer `suspicious` on risk signals, otherwise select the highest score; default to `funny` when no signal exists.

- [ ] **Step 4: Run classifier tests**

Run: `npm test -- src/renderer/src/features/recommendation/videoClassifier.test.ts`

### Task 2: Wire Classification Into Assistant Actions

**Files:**
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Test: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`

- [ ] **Step 1: Write failing tests**

Verify `runScript` receives `"recommendationKind":"knowledge"` when page content contains knowledge keywords, and `onRecordFeedback` records `knowledge`.

- [ ] **Step 2: Run tests and see failure**

Run: `npm test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx`

- [ ] **Step 3: Implement prop and action-time classification**

Add optional `videoContentContext` and `readVideoContentContext` props. Resolve the category before calling `executeAssistantAction`.

- [ ] **Step 4: Run assistant overlay tests**

Run: `npm test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx`

### Task 3: Read Active Webview Content

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing integration test**

Mock `executeJavaScript` so the first call returns page context and the second call returns automation success. Assert the automation script uses the classified category.

- [ ] **Step 2: Run tests and see failure**

Run: `npm test -- src/renderer/src/App.test.tsx`

- [ ] **Step 3: Implement active webview context reader**

Call `buildVideoContentContextScript()` on the active webview, fall back to the tab title if the read fails, and pass the reader to `AssistantOverlay`.

- [ ] **Step 4: Run app tests**

Run: `npm test -- src/renderer/src/App.test.tsx`

### Task 4: Full Verification

**Files:**
- Existing favorite automation tests remain the guard for Bilimi folder isolation.

- [ ] Run focused favorite automation tests:

```bash
npm test -- src/renderer/src/features/actions/pageAutomation.test.ts
```

- [ ] Run the full suite:

```bash
npm test
```

- [ ] Run the production build:

```bash
npm run build
```
