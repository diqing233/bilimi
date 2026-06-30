# Release Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare bilimi for a public GitHub release and produce a Windows `.exe` installer that a new user can install, run, and uninstall cleanly.

**Architecture:** Treat the release as three gates: repository hygiene, installer packaging, and public release readiness. Each gate produces a verifiable artifact before moving to the next gate, and each completed change set is committed once as required by `C:\Users\diqing\bilimi\AGENTS.md`.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, npm, GitHub Releases, Windows NSIS installer via `electron-builder`.

---

## File Structure

- Modify `C:\Users\diqing\bilimi\package.json`: add release/build scripts, packaging metadata, and installer configuration.
- Modify `C:\Users\diqing\bilimi\package-lock.json`: lock any added packaging dependencies.
- Create `C:\Users\diqing\bilimi\build\icon.ico`: Windows application icon exported from the 小咪 avatar head only, without embedded text.
- Create `C:\Users\diqing\bilimi\build\installer-sidebar.bmp` only if the final NSIS installer needs branded sidebar art.
- Modify `C:\Users\diqing\bilimi\.gitignore`: keep installer output, generated logs, and local signing files out of Git.
- Modify `C:\Users\diqing\bilimi\README.md`: fix visible mojibake, add install, build, privacy, and release notes sections.
- Create `C:\Users\diqing\bilimi\LICENSE`: define public reuse rights before GitHub publication.
- Create `C:\Users\diqing\bilimi\CHANGELOG.md`: document release history starting with `0.1.0`.
- Create `C:\Users\diqing\bilimi\SECURITY.md`: explain supported versions and how to report sensitive issues.
- Create `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\bug_report.yml`: collect reproducible bug reports.
- Create `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\feature_request.yml`: collect feature requests without forcing users into code details.
- Create `C:\Users\diqing\bilimi\.github\workflows\release.yml`: optional later step for automated release builds after manual packaging is proven.

---

### Task 1: Repository Release Audit

**Files:**
- Read: `C:\Users\diqing\bilimi\AGENTS.md`
- Read: `C:\Users\diqing\bilimi\package.json`
- Read: `C:\Users\diqing\bilimi\README.md`
- Read: `C:\Users\diqing\bilimi\.gitignore`
- Verify: Git working tree and commit history

- [ ] **Step 1: Confirm current Git state**

Run:

```powershell
git status --short --branch
git remote -v
git log --oneline --decorate --graph --max-count=20
```

Expected:
- The branch name is known.
- All modified and untracked files are intentionally either kept, committed, or deferred.
- The relationship to `origin/main` is understood before pushing.

- [ ] **Step 2: Identify files that must not be public**

Run:

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!out/**' --glob '!dist/**' --glob '!build/**' "api[_-]?key|secret|token|cookie|authorization|DeepSeek|BILI|bili_jct|SESSDATA|DedeUserID|access[_-]?token|refresh[_-]?token|password|passwd|pwd|私钥|密钥"
```

Expected:
- No real API key, Bilibili credential, cookie, token, password, signing key, local user data, or private endpoint is present.
- Documentation examples use fake values such as `sk-example` rather than real secrets.

- [ ] **Step 3: Check ignored build and local files**

Run:

```powershell
git check-ignore -v node_modules out dist build .env .env.local tools/win32 2>$null
git ls-files node_modules out dist build .env .env.local tools/win32
```

Expected:
- Generated outputs and environment files are ignored.
- No dependency folder, compiled output, private env file, or downloaded tool binary is tracked.

- [ ] **Step 4: Commit only audit-related documentation changes if any were made**

Run only after making audit-related file edits:

```powershell
git add C:\Users\diqing\bilimi\.gitignore C:\Users\diqing\bilimi\README.md
git commit -m "docs: prepare repository for public release"
```

Expected:
- A commit is created only if files changed.
- Existing unrelated working-tree changes are not staged.

---

### Task 2: Add Windows Installer Packaging And Branding

**Files:**
- Modify: `C:\Users\diqing\bilimi\package.json`
- Modify: `C:\Users\diqing\bilimi\package-lock.json`
- Create: `C:\Users\diqing\bilimi\build\icon.ico`
- Optional create: `C:\Users\diqing\bilimi\build\installer-sidebar.bmp`

- [ ] **Step 1: Install packager dependency**

Run:

```powershell
npm install -D electron-builder
```

Expected:
- `electron-builder` is added to `devDependencies`.
- `package-lock.json` is updated.

- [ ] **Step 2: Add packaging scripts and metadata**

Edit `C:\Users\diqing\bilimi\package.json` so the relevant sections contain:

```json
{
  "name": "bilimi",
  "productName": "bilimi",
  "version": "0.1.0",
  "private": false,
  "description": "Electron desktop app for browsing Bilibili with a local assistant sidebar.",
  "author": "diqing",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "setup:media-tools": "node scripts/setup-media-tools.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "npm run build && electron-builder",
    "dist:win": "npm run build && electron-builder --win nsis"
  },
  "build": {
    "appId": "cn.diqing.bilimi",
    "productName": "bilimi",
    "directories": {
      "output": "dist",
      "buildResources": "build"
    },
    "files": [
      "out/**",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "tools",
        "to": "tools",
        "filter": [
          "**/*",
          "!README.md"
        ]
      }
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64"
          ]
        }
      ],
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "bilimi"
    }
  }
}
```

Expected:
- `npm run build` remains unchanged in behavior.
- `npm run dist:win` produces a Windows installer under `C:\Users\diqing\bilimi\dist`.
- If `tools` should not be bundled, remove `extraResources` before running the build and verify runtime behavior without bundled tools.

- [ ] **Step 3: Provide the final 小咪 avatar Windows icon**

Create or export the final icon from the approved 小咪 avatar head artwork:

```text
C:\Users\diqing\bilimi\build\icon.ico
```

Expected:
- The icon contains at least `256x256`, `128x128`, `64x64`, `48x48`, `32x32`, and `16x16` sizes.
- The icon artwork is the 小咪 avatar head only.
- The icon does not include the `bilimi` text, because small Windows icon sizes would make the text unreadable.
- The installed app, Start Menu shortcut, taskbar button, and taskbar right-click menu show the 小咪 avatar icon.

- [ ] **Step 4: Verify visible app names do not fall back to Electron**

Run:

```powershell
rg -n "\"Electron\"|'Electron'|productName|app\\.setName|setTitle|title:" C:\Users\diqing\bilimi\package.json C:\Users\diqing\bilimi\electron C:\Users\diqing\bilimi\src
```

Expected:
- The packaged app display name is `bilimi`.
- BrowserWindow titles, taskbar labels, Start Menu entries, installer title, and shortcut names do not show `Electron`.
- Any intentional documentation mention of Electron is separate from visible product naming.

- [ ] **Step 5: Build installer locally**

Run:

```powershell
npm run dist:win
```

Expected:
- The command exits with code `0`.
- `C:\Users\diqing\bilimi\dist` contains a `.exe` installer.
- The generated installer filename includes `bilimi` and version `0.1.0`.

- [ ] **Step 6: Commit packaging changes**

Run:

```powershell
git add C:\Users\diqing\bilimi\package.json C:\Users\diqing\bilimi\package-lock.json C:\Users\diqing\bilimi\build\icon.ico
git commit -m "build: add Windows installer packaging and branding"
```

Expected:
- Packaging config, visible app name, and icon are committed together.
- Generated installer files in `dist` are not committed.

---

### Task 3: Electron Runtime Safety Review

**Files:**
- Review: `C:\Users\diqing\bilimi\electron\main\index.ts`
- Review: `C:\Users\diqing\bilimi\electron\preload\index.ts`
- Review: renderer files under `C:\Users\diqing\bilimi\src\renderer`
- Add or update tests near the behavior under review

- [ ] **Step 1: Check BrowserWindow security defaults**

Run:

```powershell
rg -n "new BrowserWindow|webPreferences|nodeIntegration|contextIsolation|sandbox|preload|webviewTag|setWindowOpenHandler|shell.openExternal" C:\Users\diqing\bilimi\electron C:\Users\diqing\bilimi\src
```

Expected:
- App-owned renderer windows use `contextIsolation: true`.
- App-owned renderer windows do not use `nodeIntegration: true`.
- Any `webviewTag: true` usage is intentional and scoped to the Bilibili browser surface.
- External navigation is controlled through explicit handlers.

- [ ] **Step 2: Verify preload API is a whitelist**

Run:

```powershell
Get-Content C:\Users\diqing\bilimi\electron\preload\index.ts
```

Expected:
- Renderer receives named methods, not raw `ipcRenderer`.
- IPC channel names are explicit.
- Secret values are never exposed to renderer state.

- [ ] **Step 3: Run existing tests**

Run:

```powershell
npm test
```

Expected:
- Vitest exits with code `0`.
- Any failure is fixed before packaging continues.

- [ ] **Step 4: Commit safety fixes if any were required**

Run only after safety-related edits:

```powershell
git add C:\Users\diqing\bilimi\electron C:\Users\diqing\bilimi\src
git commit -m "chore: harden Electron runtime boundaries"
```

Expected:
- A commit is created only if runtime safety files changed.

---

### Task 4: Public Documentation

**Files:**
- Modify: `C:\Users\diqing\bilimi\README.md`
- Create: `C:\Users\diqing\bilimi\LICENSE`
- Create: `C:\Users\diqing\bilimi\CHANGELOG.md`
- Create: `C:\Users\diqing\bilimi\SECURITY.md`

- [ ] **Step 1: Fix README encoding before adding content**

Run:

```powershell
rg -n "�|鎵|鏈|灏|璁|瀵|鍏|褰|鏁|淇|娴|閲|鑷|澶|涓" C:\Users\diqing\bilimi\README.md
```

Expected:
- Existing mojibake is corrected into readable Chinese or rewritten in English.
- GitHub preview renders the README text correctly.

- [ ] **Step 2: Add public-facing README sections**

Update `C:\Users\diqing\bilimi\README.md` with these sections:

```markdown
## Install

Download the latest Windows installer from GitHub Releases and run `bilimi Setup <version>.exe`.

## Build From Source

```bash
npm install
npm test
npm run build
npm run dist:win
```

## Privacy And Credentials

bilimi stores local preferences on the user's machine. DeepSeek API keys, Bilibili login state, cookies, and tokens must not be committed to this repository or shared in issue reports.

## Automation Limits

bilimi automates selected Bilibili page actions inside the desktop app. Bilibili UI changes, login state, network failures, or account restrictions can cause automation to fail. Users should review actions before relying on them for important account changes.
```

Expected:
- New users know how to install, develop, and build.
- Users understand credential privacy and Bilibili automation limits.

- [ ] **Step 3: Add license**

Create `C:\Users\diqing\bilimi\LICENSE` with the exact license text chosen by the owner. Use MIT only if the owner agrees to permissive reuse.

Expected:
- The repository has explicit legal terms before being public.

- [ ] **Step 4: Add changelog**

Create `C:\Users\diqing\bilimi\CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0 - 2026-06-30

- Initial public release.
- Added Electron desktop shell for Bilibili browsing.
- Added 小咪 avatar application icon and `bilimi` visible app name.
- Added local assistant sidebar and floating assistant surfaces.
- Added favorite-ledger organization workflows.
- Added optional DeepSeek-backed assistant features.
- Added Windows installer packaging.
```

Expected:
- Release notes have a stable source before GitHub Release text is written.

- [ ] **Step 5: Add security policy**

Create `C:\Users\diqing\bilimi\SECURITY.md`:

```markdown
# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting A Vulnerability

Please do not open a public issue for secrets, credential leaks, or account-safety problems. Report the issue privately to the maintainer with reproduction steps, affected version, and relevant logs with secrets removed.
```

Expected:
- Sensitive reports are directed away from public GitHub issues.

- [ ] **Step 6: Commit documentation changes**

Run:

```powershell
git add C:\Users\diqing\bilimi\README.md C:\Users\diqing\bilimi\LICENSE C:\Users\diqing\bilimi\CHANGELOG.md C:\Users\diqing\bilimi\SECURITY.md
git commit -m "docs: add public release documentation"
```

Expected:
- Public-facing docs are committed together.

---

### Task 5: GitHub Repository Readiness

**Files:**
- Create: `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\bug_report.yml`
- Create: `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\feature_request.yml`
- Optional create: `C:\Users\diqing\bilimi\.github\workflows\release.yml`

- [ ] **Step 1: Add bug report template**

Create `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\bug_report.yml`:

```yaml
name: Bug report
description: Report a reproducible bilimi problem
title: "[Bug]: "
labels: ["bug"]
body:
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What happened?
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: bilimi version
      placeholder: "0.1.0"
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: "1. Open...\n2. Click...\n3. See..."
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Logs or screenshots
      description: Remove API keys, cookies, tokens, and account identifiers before posting.
```

Expected:
- Bug reports ask for reproduction details and remind users to remove secrets.

- [ ] **Step 2: Add feature request template**

Create `C:\Users\diqing\bilimi\.github\ISSUE_TEMPLATE\feature_request.yml`:

```yaml
name: Feature request
description: Suggest an improvement for bilimi
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What workflow is hard or missing?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed behavior
      description: What should bilimi do instead?
    validations:
      required: true
```

Expected:
- Feature requests focus on user workflow and expected behavior.

- [ ] **Step 3: Commit GitHub metadata**

Run:

```powershell
git add C:\Users\diqing\bilimi\.github
git commit -m "chore: add GitHub issue templates"
```

Expected:
- GitHub metadata is committed without generated installer artifacts.

---

### Task 6: Installer QA On Windows

**Files:**
- Generated only: `C:\Users\diqing\bilimi\dist\*.exe`
- Verify installed app behavior outside the repository folder

- [ ] **Step 1: Rebuild from a clean dependency state**

Run:

```powershell
npm ci
npm test
npm run build
npm run dist:win
```

Expected:
- Every command exits with code `0`.
- The installer is regenerated from locked dependencies.

- [ ] **Step 2: Install the generated `.exe`**

Run the installer from:

```text
C:\Users\diqing\bilimi\dist
```

Expected:
- Installer opens without Windows SmartScreen blocking local execution beyond the normal unsigned-app warning.
- User can choose install location.
- Desktop and Start Menu shortcuts launch bilimi.
- The taskbar right-click menu shows the 小咪 avatar icon and `bilimi`, not `Electron`.

- [ ] **Step 3: Smoke-test installed app**

Verify manually:
- App starts from Start Menu.
- Main Bilibili browser window opens.
- Assistant sidebar renders.
- Floating assistant surface appears or can be enabled.
- DeepSeek disabled state does not break the UI.
- DeepSeek test action gives a clear failure when no API key is configured.
- Closing and reopening the app preserves non-sensitive preferences.

Expected:
- No crash, blank window, missing asset, or startup error occurs.

- [ ] **Step 4: Verify uninstall**

Use Windows Apps settings or the Start Menu uninstaller.

Expected:
- bilimi uninstalls cleanly.
- Shortcuts are removed.
- User data behavior is understood and documented if data remains under the user profile.

- [ ] **Step 5: Record QA result in changelog if needed**

If QA discovers a known limitation that will ship in `0.1.0`, add it to `C:\Users\diqing\bilimi\CHANGELOG.md` under the release notes.

Expected:
- Known limitations are visible before the release is published.

- [ ] **Step 6: Commit QA documentation changes if any were made**

Run only after changelog or README edits:

```powershell
git add C:\Users\diqing\bilimi\README.md C:\Users\diqing\bilimi\CHANGELOG.md
git commit -m "docs: record installer QA notes"
```

Expected:
- QA notes are committed only if documentation changed.

---

### Task 7: Whole-Repository Adversarial Release Review

**Files:**
- Review every tracked file that will be public
- Review generated installer metadata under `C:\Users\diqing\bilimi\dist`
- Review release documentation and GitHub metadata

- [ ] **Step 1: Confirm exactly what would be public**

Run:

```powershell
git status --short --branch
git ls-files
git ls-files --others --exclude-standard
```

Expected:
- The working tree is clean except ignored generated artifacts.
- Every tracked file is intended to be public.
- No untracked public file is required for the release.

- [ ] **Step 2: Run a broad secret and privacy scan**

Run:

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!out/**' --glob '!dist/**' --glob '!build/**' "api[_-]?key|secret|token|cookie|authorization|DeepSeek|BILI|bili_jct|SESSDATA|DedeUserID|access[_-]?token|refresh[_-]?token|password|passwd|pwd|私钥|密钥|C:\\\\Users\\\\|AppData|localhost:[0-9]+|127\\.0\\.0\\.1:[0-9]+"
```

Expected:
- No real secret, account credential, local user path, private endpoint, or local-only release assumption is exposed.
- Test fixtures use fake values only.
- Documentation tells users not to paste secrets into public issues.

- [ ] **Step 3: Run an adversarial GitHub visitor review**

Open these files as if you are a stranger deciding whether to trust the project:

```powershell
Get-Content C:\Users\diqing\bilimi\README.md
Get-Content C:\Users\diqing\bilimi\LICENSE
Get-Content C:\Users\diqing\bilimi\CHANGELOG.md
Get-Content C:\Users\diqing\bilimi\SECURITY.md
```

Expected:
- The app purpose is clear in the first screen of the README.
- Install and build instructions are reproducible.
- Risks around Bilibili automation, DeepSeek keys, cookies, unsigned installers, and account actions are stated honestly.
- The license and security policy do not overpromise support.

- [ ] **Step 4: Run an adversarial installer review**

Inspect the generated release artifacts:

```powershell
Get-ChildItem C:\Users\diqing\bilimi\dist -Recurse | Select-Object FullName,Length,LastWriteTime
Get-Item C:\Users\diqing\bilimi\dist\win-unpacked\bilimi.exe | Select-Object Name,Length,VersionInfo
```

Expected:
- The installer is named with `bilimi` and version `0.1.0`.
- The unpacked executable is `bilimi.exe`.
- The executable and installer show the 小咪 avatar icon.
- No debug-only file, source map leak, private cache, or unnecessary tool binary is present.

- [ ] **Step 5: Run an adversarial Electron security review**

Run:

```powershell
rg -n "nodeIntegration|contextIsolation|sandbox|webviewTag|preload|ipcRenderer|ipcMain|executeJavaScript|shell\\.openExternal|setPermissionRequestHandler|setWindowOpenHandler" C:\Users\diqing\bilimi\electron C:\Users\diqing\bilimi\src
```

Expected:
- Any renderer API exposed through preload is explicit and narrow.
- Any use of `executeJavaScript` is scoped to the embedded Bilibili workflow and does not pass user secrets to arbitrary pages.
- External navigation and permission behavior are controlled.
- Security trade-offs, such as `sandbox: false` or `webviewTag: true`, are intentional and documented if still present.

- [ ] **Step 6: Run final automated checks**

Run:

```powershell
npm audit --audit-level=high
npm test
npm run build
npm run dist:win
```

Expected:
- `npm audit --audit-level=high` reports `found 0 vulnerabilities`.
- All tests pass.
- Build passes.
- Windows installer generation passes.

- [ ] **Step 7: Record and fix all Critical or Important findings**

For each finding, classify it:

```text
Critical: blocks public GitHub release.
Important: must be fixed before tag and installer upload.
Minor: can be documented or tracked after release.
False positive: safe with written reasoning.
```

Expected:
- No Critical or Important finding remains open.
- Any Minor finding is listed in `CHANGELOG.md` or a GitHub issue before release.
- Any false positive has a concrete technical reason.

- [ ] **Step 8: Commit adversarial review fixes**

Run only after review-related edits:

```powershell
git add C:\Users\diqing\bilimi
git commit -m "chore: address adversarial release review"
```

Expected:
- The commit includes only review fixes and documentation updates.
- Generated installer files in `dist` are not committed.

---

### Task 8: GitHub Release Publication

**Files:**
- No source changes required if previous tasks are complete
- Upload artifact: installer from `C:\Users\diqing\bilimi\dist`

- [ ] **Step 1: Final pre-release check**

Run:

```powershell
git status --short --branch
npm test
npm run build
npm run dist:win
```

Expected:
- Git working tree is clean except generated ignored artifacts.
- Tests pass.
- Build passes.
- Installer is present.

- [ ] **Step 2: Tag release**

Run:

```powershell
git tag -a v0.1.0 -m "bilimi v0.1.0"
```

Expected:
- Annotated tag `v0.1.0` exists locally.

- [ ] **Step 3: Push branch and tag**

Run only after confirming the local history is intended to become public:

```powershell
git push origin main
git push origin v0.1.0
```

Expected:
- GitHub receives the final branch and release tag.

- [ ] **Step 4: Create GitHub Release**

Create a release for `v0.1.0` with:

```markdown
# bilimi v0.1.0

Initial public release of bilimi, an Electron desktop app for browsing Bilibili with a local assistant sidebar.

## Install

Download and run the Windows installer attached to this release.

## Notes

- DeepSeek features require the user to configure their own API key.
- Bilibili automation depends on login state, page layout, and network behavior.
- The app is unsigned in this release, so Windows may show a warning during installation.
```

Expected:
- The `.exe` installer is attached.
- Release notes match `CHANGELOG.md`.
- The unsigned Windows warning is disclosed honestly.

---

## Self-Review

- Spec coverage: The plan covers repository hygiene, secret scanning, installer packaging, Electron safety review, public documentation, GitHub metadata, Windows QA, whole-repository adversarial release review, and release publication.
- Placeholder scan: The plan avoids unresolved placeholders and gives exact commands, files, and expected outcomes.
- Type consistency: Script names are consistent: `build`, `dist`, and `dist:win`. Release version is consistently `0.1.0`.
