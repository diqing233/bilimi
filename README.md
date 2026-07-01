# bilimi

bilimi is an Electron + React desktop app for browsing Bilibili with a local assistant sidebar and the 小咪 desktop companion. It helps classify videos into local favorite ledgers, run lightweight Bilibili page actions, and create timestamped video notes.

## Install

Download the latest Windows installer from GitHub Releases and run:

```text
bilimi Setup 0.1.0.exe
```

The current Windows installer is unsigned. Windows may show a warning before installation.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Package For Windows

```bash
npm install
npm test
npm run dist:win
```

The installer is written to `dist/`. The packaged Windows app uses the 小咪 avatar as its icon and `bilimi` as the visible app name. `npm run dist:win` also prepares the bundled Windows media and transcription runtime so end users do not need Node.js, Python, ffmpeg, yt-dlp, or command-line setup.

## Core Features

- Embedded Bilibili browser with an assistant sidebar.
- 小咪 desktop companion window for quick actions and assistant entry.
- Bilibili favorite-ledger organization using Bilimi-prefixed folders.
- Review actions for like, coin, favorite, and short comment drafts.
- Video notes from pasted transcript text or local audio transcription.
- Optional DeepSeek-backed comment, summary, and 小咪 chat features.

## Privacy And Credentials

bilimi stores local preferences on the user's machine. DeepSeek API keys are saved through the Electron main process and are not exposed as renderer state. Bilibili login state, cookies, CSRF tokens, account IDs, and API keys must never be committed to this repository or pasted into public issue reports.

## Automation Limits

bilimi automates selected Bilibili page actions inside the desktop app. Bilibili UI changes, login state, network failures, account restrictions, or browser permission changes can cause automation to fail. Users should review actions before relying on them for important account changes.

## DeepSeek Features

DeepSeek support is optional. Users must configure their own API key before using DeepSeek-backed comment drafting, note summaries, or 小咪 chat. When DeepSeek is disabled or no key is configured, bilimi should keep local features available and show a clear disabled-state message.

## Audio Transcription Runtime

Windows installers include the local audio transcription runtime:

- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `whisper.cpp`
- `ggml-small.bin`

For Windows development checkouts, install the same local tools with:

```bash
npm run setup:media-tools
```

The setup script downloads pinned Windows x64 binaries and verifies the bundled transcription model checksum.

## Security

Please do not open public issues for secrets, credential leaks, or account-safety problems. See `SECURITY.md` for reporting guidance.

## License

Copyright is retained by the project owner. See `LICENSE`.
