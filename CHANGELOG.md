# Changelog

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
