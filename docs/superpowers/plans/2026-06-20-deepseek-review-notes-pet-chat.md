# DeepSeek Review Notes Pet Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one secure DeepSeek service that powers review comment candidates, note poster summaries, and direct 小咪 chat in the desktop pet prompt bubble.

**Architecture:** Store the DeepSeek key and call the API only in Electron main. Renderer code uses typed preload functions. Review, notes, and pet UI each add a thin feature flow over the same `generateDeepSeek` bridge.

**Tech Stack:** Electron main/preload, React 19, TypeScript, Vitest, Testing Library, Electron store, browser `fetch`.

---

## File Structure

- `src/shared/types.ts`: DeepSeek preference and generation types.
- `src/renderer/src/features/state/assistantState.ts`: DeepSeek preference defaults and normalization.
- `electron/main/store.ts`: non-secret DeepSeek settings plus key status/key helpers.
- `electron/main/deepseekService.ts`: main-process DeepSeek request builder, response parser, and error mapper.
- `electron/main/index.ts`, `electron/preload/index.ts`, `src/renderer/src/global.d.ts`: IPC/preload bridge.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: settings UI, review intent flow, note poster bridge.
- `src/renderer/src/features/assistant/CommentIntentDialog.tsx`: intent prompt before generating comments.
- `src/renderer/src/features/notes/VideoNotesPanel.tsx`, `src/renderer/src/features/notes/notePoster.ts`: poster preview/export.
- `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`: top prompt bubble chat.
- Existing adjacent test files plus new tests for new helper/component files.

### Task 1: Shared Types and Preference Defaults

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Test: `src/renderer/src/features/state/assistantState.test.ts`

- [x] **Step 1: Write the failing tests**

Add tests that assert `createInitialAssistantPreferences()` returns:

```ts
{
  deepseekEnabled: false,
  deepseekApiKeyStored: false,
  deepseekModel: 'deepseek-v4-flash',
  deepseekBaseUrl: 'https://api.deepseek.com'
}
```

Also add a test where persisted `deepseekModel: ''` and `deepseekBaseUrl: 'bad-url'` normalize back to those defaults.

- [x] **Step 2: Run red test**

Run:

```bash
npm run test -- src/renderer/src/features/state/assistantState.test.ts
```

Expected: FAIL because DeepSeek fields do not exist.

- [x] **Step 3: Implement shared types**

Extend `AssistantPreferences` in `src/shared/types.ts` with:

```ts
deepseekEnabled: boolean
deepseekApiKeyStored: boolean
deepseekModel: string
deepseekBaseUrl: string
```

Add these shared types:

```ts
export type DeepSeekErrorCode = 'not-configured' | 'network-error' | 'api-error' | 'invalid-output' | 'unknown'
export type DeepSeekChatMessage = { role: 'user' | 'assistant'; content: string }
export type NotePosterSummary = { title: string; subtitle: string; keyPoints: string[]; keywords: string[]; prompt: string }
export type DeepSeekGenerateRequest =
  | { kind: 'review-comment'; intent: string; title: string; author?: string; description?: string; tags: string[]; classification: string }
  | { kind: 'note-poster'; note: VideoNote }
  | { kind: 'pet-chat'; messages: DeepSeekChatMessage[]; context?: { title?: string; pageText?: string } }
export type DeepSeekGenerateResult =
  | { kind: 'review-comment'; comments: string[] }
  | { kind: 'note-poster'; poster: NotePosterSummary }
  | { kind: 'pet-chat'; message: string }
export type DeepSeekKeyStatus = { configured: boolean }
export type DeepSeekConnectionTestResult = { ok: boolean; message: string }
```

- [x] **Step 4: Implement preference normalization**

In `assistantState.ts`, add defaults and URL/model normalization. Return the four new fields from `createInitialAssistantPreferences`.

- [x] **Step 5: Run green test**

Run:

```bash
npm run test -- src/renderer/src/features/state/assistantState.test.ts
```

Expected: PASS.

### Task 2: Store DeepSeek Settings and Key Status

**Files:**
- Modify: `electron/main/store.ts`
- Test: `electron/main/store.test.ts`

- [x] **Step 1: Write the failing tests**

Add tests that:

1. `saveAssistantPreferences` persists `deepseekEnabled`, `deepseekModel`, and `deepseekBaseUrl`.
2. `saveDeepSeekApiKey(store, 'sk-test')` makes `loadDeepSeekApiKeyStatus(store)` return `{ configured: true }`.
3. `clearDeepSeekApiKey(store)` returns status to `{ configured: false }`.
4. `loadAssistantPreferences(store).deepseekApiKeyStored` reflects key presence.

- [x] **Step 2: Run red test**

Run:

```bash
npm run test -- electron/main/store.test.ts
```

Expected: FAIL because store fields and helpers do not exist.

- [x] **Step 3: Implement store fields**

Add to `DesktopStoreState`:

```ts
deepseekEnabled: boolean
deepseekApiKeyStored: boolean
deepseekModel: string
deepseekBaseUrl: string
deepseekApiKey: string
```

Add matching defaults. Update test helper `createFakeStore`.

- [x] **Step 4: Implement key helpers**

Export:

```ts
loadDeepSeekApiKeyStatus(store?): DeepSeekKeyStatus
loadDeepSeekApiKey(store?): string
saveDeepSeekApiKey(store, key): DeepSeekKeyStatus
clearDeepSeekApiKey(store?): DeepSeekKeyStatus
```

Keep the key out of `loadAssistantPreferences`; only return `deepseekApiKeyStored`.

- [x] **Step 5: Run green test**

Run:

```bash
npm run test -- electron/main/store.test.ts
```

Expected: PASS.

### Task 3: DeepSeek Main Service

**Files:**
- Create: `electron/main/deepseekService.ts`
- Test: `electron/main/deepseekService.test.ts`

- [x] **Step 1: Write the failing service tests**

Create tests with injected `fetchImpl` for:

1. Missing key rejects with `{ code: 'not-configured' }`.
2. `review-comment` parses `{"comments":["a","b","c"]}` into three comments.
3. `note-poster` parses poster JSON into `NotePosterSummary`.
4. `pet-chat` returns a short message string.
5. A non-OK response rejects with `{ code: 'api-error' }`.

- [x] **Step 2: Run red test**

Run:

```bash
npm run test -- electron/main/deepseekService.test.ts
```

Expected: FAIL because the service file does not exist.

- [x] **Step 3: Implement service**

Create:

```ts
export type DeepSeekConfig = { enabled: boolean; apiKey: string; model: string; baseUrl: string }
export class DeepSeekServiceError extends Error { constructor(public readonly code: DeepSeekErrorCode, message: string) { super(message) } }
export async function generateDeepSeekResult(options: { config: DeepSeekConfig; request: DeepSeekGenerateRequest; fetchImpl?: typeof fetch }): Promise<DeepSeekGenerateResult>
```

Behavior:

- Require `config.enabled` and non-empty `apiKey`.
- POST to `${baseUrl without trailing slash}/chat/completions`.
- Send `Authorization: Bearer <key>`, model, messages, and temperature.
- Prompt `review-comment` and `note-poster` to return JSON only.
- Parse JSON from the first choice message content.
- Limit comments to exactly 3, poster points to 5, keywords to 8, pet reply to 220 chars.

- [x] **Step 4: Run green test**

Run:

```bash
npm run test -- electron/main/deepseekService.test.ts
```

Expected: PASS.

### Task 4: IPC and Preload Bridge

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [x] **Step 1: Add type signatures first**

Add to `BilimiDesktopApi` in `global.d.ts`:

```ts
generateDeepSeek?: (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
testDeepSeekConnection?: () => Promise<DeepSeekConnectionTestResult>
saveDeepSeekApiKey?: (apiKey: string) => Promise<DeepSeekKeyStatus>
clearDeepSeekApiKey?: () => Promise<DeepSeekKeyStatus>
loadDeepSeekApiKeyStatus?: () => Promise<DeepSeekKeyStatus>
```

- [x] **Step 2: Run build red**

Run:

```bash
npm run build
```

Expected: FAIL until imports/preload/main are complete.

- [x] **Step 3: Register main handlers**

In `registerAssistantPreferenceHandlers`, add handlers:

- `deepseek:key-status`
- `deepseek:save-key`
- `deepseek:clear-key`
- `deepseek:generate`
- `deepseek:test-connection`

Use `loadAssistantPreferences`, `loadDeepSeekApiKey`, and `generateDeepSeekResult`.

- [x] **Step 4: Expose preload methods**

Expose matching `window.bilimiDesktop` methods in `electron/preload/index.ts`.

- [x] **Step 5: Run green build and focused tests**

Run:

```bash
npm run build
npm run test -- electron/main/store.test.ts electron/main/deepseekService.test.ts
```

Expected: PASS.

### Task 5: DeepSeek Settings UI

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify/Test: `src/renderer/src/styles.css`, `src/renderer/src/styles.test.ts`

- [x] **Step 1: Write failing UI tests**

Add tests that switch to settings and assert:

1. A checkbox named `Enable DeepSeek` toggles `preferences.deepseekEnabled`.
2. `DeepSeek API Key`, `DeepSeek Model`, and `DeepSeek Base URL` inputs render.
3. Clicking `Save DeepSeek` calls `saveDeepSeekApiKey('sk-test')` when the key draft is non-empty, then calls `savePreferences` with model/base URL.
4. Clicking `Test DeepSeek` calls `testDeepSeekConnection` and shows the returned message in `role="status"`.

- [x] **Step 2: Run red test**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: FAIL because controls do not exist.

- [x] **Step 3: Implement settings controls**

In the existing settings section, add a `fieldset.assistant-settings__group--deepseek` with English labels:

- `Enable DeepSeek`
- `DeepSeek API Key`
- `DeepSeek Model`
- `DeepSeek Base URL`
- `Save DeepSeek`
- `Test DeepSeek`

Update local `preferences` for checkbox/model/base URL changes. Save key through `saveDeepSeekApiKey`, then save preferences through `savePreferences`.

- [x] **Step 4: Add styles and style tests**

Add CSS for `.assistant-settings__group--deepseek` and `.assistant-settings__actions`. Add style tests that check those selectors exist.

- [x] **Step 5: Run green tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/styles.test.ts
```

Expected: PASS.

### Task 6: Review Intent Dialog and AI Comments

**Files:**
- Create: `src/renderer/src/features/assistant/CommentIntentDialog.tsx`
- Test: `src/renderer/src/features/assistant/CommentIntentDialog.test.tsx`
- Modify/Test: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`, `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write failing dialog tests**

Create tests for `CommentIntentDialog`:

- Input label: `Comment intent`
- Submit button: `Generate comments`
- Cancel button: `Cancel`
- Trims submitted intent.
- Does not submit empty intent.
- Shows `role="alert"` when `error` prop is set.

- [x] **Step 2: Run dialog red test**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/CommentIntentDialog.test.tsx
```

Expected: FAIL because component does not exist.

- [x] **Step 3: Implement dialog**

Create a small `role="dialog"` component with props:

```ts
busy: boolean
error: string
onSubmit: (intent: string) => void
onCancel: () => void
```

- [x] **Step 4: Add stable test id to review action**

In `MemorialPanel.tsx`, add:

```tsx
data-testid={`review-action-${action}`}
```

to each review action button. This avoids depending on the existing garbled label text.

- [x] **Step 5: Write failing review flow test**

In `FloatingAssistantApp.test.tsx`, click the table action via:

```ts
fireEvent.click(await screen.findByTestId('review-action-琛?))
```

If the current source action literal is still garbled in tests, derive the selector from the action array after adding a stable ASCII test id such as `review-action-comment`.

Assert:

1. `Comment intent` appears.
2. Enter `praise technical detail`.
3. Click `Generate comments`.
4. `generateDeepSeek` is called with `{ kind: 'review-comment', intent: 'praise technical detail' }`.
5. The three AI comments are shown in `CommentChooser`.
6. Clicking one calls `runAssistantAction` with that `commentDraft`.

- [x] **Step 6: Run red test**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: FAIL because `FloatingAssistantApp` still opens static comments directly.

- [x] **Step 7: Implement review flow**

In `FloatingAssistantApp.tsx`:

- Add state for `commentIntentOpen`, `commentIntentBusy`, `commentIntentError`, and `aiCommentDrafts`.
- On table/comment action, open `CommentIntentDialog` instead of `CommentChooser`.
- Build a `review-comment` request from current video title, page text, classification, and user intent.
- On success, close intent dialog, set `aiCommentDrafts`, and open `CommentChooser`.
- On select, run existing action with selected draft and clear `aiCommentDrafts`.
- On cancel, clear intent and drafts.

- [x] **Step 8: Add styles**

Add `.assistant-dialog--intent` and input sizing styles.

- [x] **Step 9: Run green tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/CommentIntentDialog.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: PASS.

### Task 7: Note Poster Summary

**Files:**
- Create/Test: `src/renderer/src/features/notes/notePoster.ts`, `src/renderer/src/features/notes/notePoster.test.ts`
- Modify/Test: `src/renderer/src/features/notes/VideoNotesPanel.tsx`, `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write failing poster helper tests**

Test `normalizePosterSummary` and `createPosterSvgDataUrl`. The data URL must start with `data:image/svg+xml;charset=utf-8,` and contain encoded poster text.

- [x] **Step 2: Run helper red test**

Run:

```bash
npm run test -- src/renderer/src/features/notes/notePoster.test.ts
```

Expected: FAIL because helper does not exist.

- [x] **Step 3: Implement poster helper**

Implement:

```ts
normalizePosterSummary(summary: NotePosterSummary): NotePosterSummary
createPosterSvgDataUrl(summary: NotePosterSummary): string
```

Use an SVG data URL for first version export. Keep the poster palette light and compact.

- [x] **Step 4: Write failing panel test**

Add `VideoNotesPanel` prop:

```ts
onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
```

Test:

1. Open the existing summary tab.
2. Click `Generate one-image summary`.
3. Assert `onGeneratePoster(sampleNote)` was called.
4. Assert returned title appears in a `region` named `One-image poster preview`.
5. Assert link `Save image` has an SVG data URL.

- [x] **Step 5: Run panel red test**

Run:

```bash
npm run test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: FAIL because prop/UI do not exist.

- [x] **Step 6: Implement poster panel**

In `VideoNotesPanel.tsx`, add poster state, a generate handler, preview markup, and save link. Use English labels for the new controls:

- `Generate one-image summary`
- `One-image poster preview`
- `Save image`

- [x] **Step 7: Wire through MemorialPanel and FloatingAssistantApp**

Add `onGeneratePoster` prop to `MemorialPanel` and pass it to `VideoNotesPanel`.

In `FloatingAssistantApp`, implement:

```ts
async function generateNotePoster(note: VideoNote) {
  const result = await window.bilimiDesktop?.generateDeepSeek?.({ kind: 'note-poster', note })
  if (!result || result.kind !== 'note-poster') throw new Error('Poster generation failed.')
  return result.poster
}
```

- [x] **Step 8: Add styles**

Add `.video-notes__poster` styles.

- [x] **Step 9: Run green tests**

Run:

```bash
npm run test -- src/renderer/src/features/notes/notePoster.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: PASS.

### Task 8: Pet Prompt Bubble Chat

**Files:**
- Modify/Test: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`, `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write failing pet chat tests**

Add tests using new English labels:

1. Click a bubble button named `打开小咪对话`.
2. Fill `和小咪说话` with `watch this page`.
3. Click `Send`.
4. Assert `generateDeepSeek` receives `{ kind: 'pet-chat', messages: [{ role: 'user', content: 'watch this page' }] }`.
5. Assert reply text renders.
6. Rejecting API call shows `role="alert"`.

- [x] **Step 2: Run pet red test**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected: FAIL because chat UI does not exist.

- [x] **Step 3: Implement pet chat**

In `PalaceMaidPetApp.tsx`:

- Add `chatOpen`, `chatDraft`, `chatMessages`, `chatBusy`, `chatError`.
- Replace the static bubble content with a button `aria-label="打开小咪对话"` and an expanded form when open.
- Use input label `和小咪说话` and submit button `Send`.
- Call `window.bilimiDesktop?.generateDeepSeek?.({ kind: 'pet-chat', messages })`.
- Keep only the last six chat messages in memory.

- [x] **Step 4: Add styles**

Add bounded bubble styles for `[data-chat-open='true']`, `.palace-maid-pet__bubble-toggle`, `.palace-maid-pet__chat`, `.palace-maid-pet__chat-log`, and chat input.

- [x] **Step 5: Run green test**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected: PASS.

### Task 9: Verification and Single Implementation Commit

**Files:**
- All touched files.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm run test -- src/renderer/src/features/state/assistantState.test.ts electron/main/store.test.ts electron/main/deepseekService.test.ts src/renderer/src/features/assistant/CommentIntentDialog.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/notes/notePoster.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx src/renderer/src/styles.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [x] **Step 4: Inspect status**

Run:

```bash
git status --short
```

Expected: only intentional implementation files are changed.

- [x] **Step 5: Create one implementation commit**

Stage all implementation changes and commit once, per `AGENTS.md`:

```bash
git add src electron docs/superpowers/plans/2026-06-20-deepseek-review-notes-pet-chat.md
git commit -m "feat: add deepseek assistant features"
```

Expected: one implementation commit after the design commit.
