# Downloaded Model Uninstall Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete bilimi-managed downloaded transcription models when and only when the user selects the existing uninstall user-data cleanup option.

**Architecture:** The model manager persists downloaded models and shared runtimes below `%LOCALAPPDATA%\\bilimi\\transcription-models`, while Electron state is under `%APPDATA%\\bilimi`. Extend the existing checked-only NSIS `customUnInstall` branch to remove only that managed local model root and clearly disclose it in the uninstall page.

**Tech Stack:** NSIS, electron-builder, Vitest, Electron.

---

### Task 1: Regression Test for Uninstall Scope

**Files:**
- Modify: `electron/installer/nsisInstallDirectory.test.ts`
- Modify: `electron/installer/installer.nsh`

- [ ] **Step 1: Write the failing test**

```ts
expect(installerScript).toMatch(
  /\$\{If\} \$bilimiDeleteUserData == "1"[\s\S]*?RMDir \/r "\$LOCALAPPDATA\\bilimi\\transcription-models"[\s\S]*?\$\{EndIf\}/
)
expect(installerScript).toContain('已下载的转写模型和运行时')
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run electron/installer/nsisInstallDirectory.test.ts`

Expected: FAIL because the uninstaller lacks the `$LOCALAPPDATA\\bilimi\\transcription-models` cleanup command and disclosure text.

- [ ] **Step 3: Add the minimal NSIS cleanup**

```nsh
DetailPrint "Removing downloaded transcription models from $LOCALAPPDATA\bilimi\transcription-models"
RMDir /r "$LOCALAPPDATA\bilimi\transcription-models"
```

Place it inside the existing `${If} $bilimiDeleteUserData == "1"` branch and retain the current all-install `SetShellVarContext current` handling.

- [ ] **Step 4: Update the uninstall disclosure**

Add `已下载的转写模型和运行时` to the checked-cleanup description without changing the default unchecked checkbox.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `npm test -- --run electron/installer/nsisInstallDirectory.test.ts`

Expected: PASS.

### Task 2: Release Verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-12-uninstall-downloaded-model-cleanup.md`

- [x] **Step 1:** Record exact script/test locations and the final package evidence in R001.
- [x] **Step 2:** Run `npm test` and `npm run build`.
- [x] **Step 3:** Run `git status --short`, `git diff --stat`, and `git diff --check`; verify this topic contains only the installer script, test, plan, and ledger.
- [x] **Step 4:** Commit the complete topic on local `main`.
- [ ] **Step 5:** Run `npm run dist:win`, verify the NSIS artifact and SHA-256, and do not install it without additional authorization.
