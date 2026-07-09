# Changelog

## Unreleased

- Improved old-favorite archive preview with stronger local classification, editable and reversible target choices, optional DeepSeek-assisted organization, and safer correction/keyword learning settings.
- Added batch archive-preview change summaries and card-level source notices for DeepSeek moves, staging moves, and generated-ledger selections, with undo/redo preserving generated ledger choices.
- Kept the note archive's opened video detail visible when returning from review or a folded assistant session, while avoiding restore after a new app session.

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
