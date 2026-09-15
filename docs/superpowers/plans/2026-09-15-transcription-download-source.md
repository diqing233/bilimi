# Transcription Download Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore ModelScope as the working primary source for the shared faster-whisper runtime, always expose the actual active download source, make user cancellation a normal terminal outcome, and keep model-switch errors scoped to the selected model.

**Architecture:** The ModelScope repository is a content fix: upload the verified runtime at the exact path already configured by the client. The main-process download IPC owns the durable current-source state because progress callbacks and later phases do not all carry a source. The manager reports the runtime fallback using the same event contract already used for ordinary model artifacts; the renderer remains a simple display of that snapshot.

**Tech Stack:** Electron IPC, TypeScript, React, Vitest, Git LFS, ModelScope Git remote.

---

### Task 1: Capture cancellation and source-fallback regressions

**Files:**
- Modify: `electron/main/transcriptionModelIpc.test.ts:122-141`
- Modify: `electron/main/transcriptionModelManager.test.ts:456-550`

- [x] **Step 1: Change the cancellation expectation to the requested normal result.**

```ts
await expect(installing).resolves.toEqual([])
expect(send).toHaveBeenLastCalledWith(
  7,
  'video-audio:transcription-model-progress',
  expect.objectContaining({ id: model.id, stage: 'canceled' })
)
```

- [x] **Step 2: Add a shared-runtime fallback test.**

```ts
const phases: Array<{ phase: string; source?: string; sourceFallbackMessage?: string }> = []
await manager.install('faster-whisper-large-v3-turbo', undefined, undefined, (phase, details) => phases.push({ phase, ...details }))
expect(phases).toContainEqual({
  phase: 'connecting',
  source: 'GitHub Release',
  sourceFallbackMessage: 'ModelScope 连接失败，正在尝试 GitHub Release'
})
```

- [x] **Step 3: Run the targeted tests and confirm both fail for the existing behavior.**

Run: `npm test -- electron/main/transcriptionModelIpc.test.ts electron/main/transcriptionModelManager.test.ts`

Expected: cancellation still rejects with `AbortError`; shared-runtime fallback has no source-switch progress event.

### Task 2: Preserve actual source across all active download phases

**Files:**
- Modify: `electron/main/transcriptionModelIpc.ts:43-88`
- Modify: `electron/main/transcriptionModelManager.ts:459-480`
- Modify: `electron/main/transcriptionModelIpc.test.ts`
- Modify: `electron/main/transcriptionModelManager.test.ts`
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

- [x] **Step 1: Add a failing IPC assertion for a source retained at a non-download phase.**

```tsx
progress={{ id: 'faster-whisper-large-v3', stage: 'validating-runtime', source: 'ModelScope' }}
expect(screen.getByText('当前来源：ModelScope')).toBeInTheDocument()
```

- [x] **Step 2: Retain the latest explicit source in the IPC progress snapshot.**

```ts
let activeSource: TranscriptionModelInstallProgress['source']
const updateProgress = (value: TranscriptionModelInstallProgress) => {
  if (value.source) activeSource = value.source
  currentProgress = { ...value, ...(activeSource ? { source: activeSource } : {}) }
  publish(event.sender.id, currentProgress)
}
```

- [x] **Step 3: Emit the same concise fallback event for the shared runtime.**

```ts
const nextSource = FASTER_WHISPER_RUNTIME.sources[FASTER_WHISPER_RUNTIME.sources.indexOf(source) + 1]
if (nextSource) {
  onPhase?.('connecting', {
    source: nextSource.label,
    sourceFallbackMessage: `${source.label} 连接失败，正在尝试 ${nextSource.label}`
  })
}
```

- [x] **Step 4: Treat a user abort as the normal return path without changing non-cancellation failures.**

```ts
if (isAbortError(error)) {
  updateProgress({ id, stage: 'canceled' })
  return manager.list()
}
updateProgress({ id, stage: 'failed', error: error instanceof Error ? error.message : String(error) })
throw error
```

- [x] **Step 5: Run the targeted tests.**

Run: `npm test -- electron/main/transcriptionModelIpc.test.ts electron/main/transcriptionModelManager.test.ts src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

Expected: all selected tests pass; cancellation resolves and source remains visible in later active stages.

### Task 3: Keep model-switch state scoped to the selected model

**Files:**
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.tsx:73-147`
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

- [x] **Step 1: Add a failing model-switch regression test.**

```tsx
fireEvent.click(screen.getByRole('option', { name: /Whisper small/ }))
expect(screen.queryByRole('alert')).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: '迁移到应用模型目录' })).toBeEnabled()
```

- [x] **Step 2: Clear the panel-local installation error when the candidate changes.**

```ts
useEffect(() => {
  setCandidate(selectedModelId)
  setInstallationError(null)
}, [selectedModelId])

// Model chooser click
setCandidate(model.id)
setInstallationError(null)
```

- [x] **Step 3: Run the component and model-download regressions.**

Run: `npm test -- src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx electron/main/transcriptionModelIpc.test.ts electron/main/transcriptionModelManager.test.ts`

Expected: a prior model failure does not display after switching, and the selected legacy Whisper model keeps its migration action.

### Task 4: Restore the missing ModelScope runtime object

**Files:**
- External remote: `https://www.modelscope.cn/bilimi/transcription-models.git` on `master`
- Source only: `C:/Users/diqing/AppData/Local/bilimi/transcription-models/faster-whisper-runtime/bilimi-faster-whisper.exe`

- [x] **Step 1: Create an isolated, no-smudge clone under `.codex-artifacts/` and inspect its LFS tracking.**

```powershell
$env:GIT_LFS_SKIP_SMUDGE = '1'
git clone --depth 1 https://www.modelscope.cn/bilimi/transcription-models.git .codex-artifacts/modelscope-transcription-models
git -C .codex-artifacts/modelscope-transcription-models lfs ls-files
```

- [x] **Step 2: Copy only the verified runtime to its configured remote path and track the executable through Git LFS.**

```powershell
git -C .codex-artifacts/modelscope-transcription-models lfs track '*.exe'
New-Item -ItemType Directory -Force .codex-artifacts/modelscope-transcription-models/faster-whisper-runtime
Copy-Item C:/Users/diqing/AppData/Local/bilimi/transcription-models/faster-whisper-runtime/bilimi-faster-whisper.exe .codex-artifacts/modelscope-transcription-models/faster-whisper-runtime/bilimi-faster-whisper.exe
```

- [x] **Step 3: Verify the staged object before pushing.**

```powershell
Get-FileHash .codex-artifacts/modelscope-transcription-models/faster-whisper-runtime/bilimi-faster-whisper.exe -Algorithm SHA256
git -C .codex-artifacts/modelscope-transcription-models add .gitattributes faster-whisper-runtime/bilimi-faster-whisper.exe
git -C .codex-artifacts/modelscope-transcription-models diff --cached --stat
```

Expected: exactly one 1,230,066,949-byte executable, SHA-256 `79922ca2a61918bad0447d9327316f013072d7a7d8e07a0d3a75a29cc26c06ac`, plus required LFS attributes.

- [ ] **Step 4: Commit and push the remote content change.**

```powershell
git -C .codex-artifacts/modelscope-transcription-models commit -m "fix: add faster-whisper runtime"
git -C .codex-artifacts/modelscope-transcription-models push origin master
```

- [ ] **Step 5: Verify the public direct object with a one-kilobyte Range request.**

```powershell
curl.exe -sS -L -i -H 'Range: bytes=0-1023' https://www.modelscope.cn/models/bilimi/transcription-models/resolve/master/faster-whisper-runtime/bilimi-faster-whisper.exe
```

Expected: `206 Partial Content` and `Content-Range: bytes 0-1023/1230066949`.

### Task 5: Full verification and delivery

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-15-faster-whisper-download-source.md`
- Modify: `docs/superpowers/plans/2026-09-15-transcription-download-source.md`

- [x] **Step 1: Run the full unit suite, build, development check, and preview check.**

```powershell
npm test
npm run build
npm run dev
npm run preview
```

- [x] **Step 2: Record per-item code locations and validation evidence in the ledger.**

- [x] **Step 3: Check the final working tree and create the single local implementation commit.**

```powershell
git diff --check
git status --short
git diff --stat
git add electron/main/transcriptionModelIpc.ts electron/main/transcriptionModelIpc.test.ts electron/main/transcriptionModelManager.ts electron/main/transcriptionModelManager.test.ts src/renderer/src/features/assistant/TranscriptionModelSettings.tsx src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx docs/requirement-ledgers/2026-09-15-faster-whisper-download-source.md docs/superpowers/plans/2026-09-15-transcription-download-source.md
git commit -m "fix: restore transcription download source handling"
```

## Execution Notes

- The source-retention check belongs to the main-process IPC snapshot contract, so its regression test is in `electron/main/transcriptionModelIpc.test.ts`, not a renderer-only assertion. The renderer already displays the received source snapshot.
- The old production logic was temporarily restored after adding the regressions: all four new assertions failed for the intended root causes. The minimal production changes were then restored and the three relevant files passed 88 tests.
- The ModelScope content upload remains blocked only by missing local write credentials. The public range request still returns `404`; this does not block the local client-code commit, but it prevents validating a first-install download until the verified file is uploaded.
- `npm test` passed with 260 files and 4715 tests. `npm run build`, `npm run dev`, and `npm run preview` passed their build/startup checks. Electron visual interaction remains unverified because the available automation service reports `unsupported Codex auth method: apikey`.
