# Changelog

## Unreleased

- Added archive-health checks for protected old favorites, including incomplete/invalid counts and an explicit abnormal-only reorganization action.

- Allowed old-favorite organization rounds with zero archive tasks to end directly from the confirmation page without sending an archive request.
- Reordered settings so organization strategy follows DeepSeek and close settings appear last in both navigation and page content.
- Refined assistant status lights so long-running scan, DeepSeek, transcription queue, and old-favorite organization states stay visible without occupying the realtime feedback line.
- Updated the in-app browser tab strip so multiple open video tabs compress before horizontal scrolling, without leading tab icons.
- Improved old-favorite archive preview with stronger local classification, editable and reversible target choices, optional DeepSeek-assisted organization, and safer correction/keyword learning settings.
- Added incremental protection for completed old-favorite organization, with source-scoped reorganization that safely reconciles only Bilimi-managed folders to the configured target limit.
- Added DeepSeek constraint favorite ledgers so enabled folders can provide AI-only classification guidance without affecting local keyword matching.
- Scoped classification learning so only DeepSeek produces reviewable keyword suggestions, while correction records are kept as reference evidence instead of direct local-classification inputs.
- Locked the default favorite categories to keyword rules while keeping names and keywords editable, with a warning when non-staging defaults lose all local keywords.
- Split DeepSeek constraints into a dedicated one-line editor field for keyword, UP, and tag favorite ledgers.
- Added batch archive-preview change summaries and card-level source notices for DeepSeek moves, staging moves, and generated-ledger selections, with undo/redo preserving generated ledger choices.
- Kept the note archive's opened video detail visible when returning from review or a folded assistant session, while avoiding restore after a new app session.
- Added close settings for minimizing to the system tray or exiting bilimi, with an optional remembered confirmation choice before direct exit.
- Preserved DeepSeek API key secrecy in settings by clearing saved drafts, showing only saved/readable status, and keeping failed-save drafts recoverable.
- Clarified transcription queue scope: user cancellation remains, restart archives recoverable drafts before clearing unfinished queue work, session completion count is visible, and fixed automatic timeouts are not included.

## 0.1.1 - 2026-07-05

- Fixed favorite-ledger editing so the editor `保存` action only saves the local draft; users must select the folder and click `同步` before Bilibili folders are updated.
- Moved DeepSeek settings status messages above the 云枢智元 acknowledgement panel.

## 0.1.0 - 2026-06-30

- Initial public Windows release.
- Added Electron desktop shell for Bilibili browsing.
- Added local assistant sidebar and 小咪 desktop companion surfaces.
- Added bilimi-prefixed favorite-ledger organization workflows.
- Added optional DeepSeek-backed comment, note summary, and 小咪 chat features.
- Added local audio transcription workflow for video notes.
- Added 小咪 avatar application icon and `bilimi` visible app name.
- Added Windows NSIS installer packaging.
- Bundled Windows media tools, whisper.cpp, and the `ggml-small.bin` model so local transcription does not require user-installed Python or command-line tools.

## Known Notes

- The Windows installer is unsigned, so Windows may show a warning before installation.
- Bilibili automation depends on page layout, login state, network behavior, and account permissions.
- DeepSeek features require users to provide their own API key.
