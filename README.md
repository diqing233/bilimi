# Bilimi

Bilimi is an Electron + React desktop app for browsing Bilibili with a local assistant sidebar. It helps classify videos into local ledgers, automate lightweight Bilibili actions, and create timestamped video notes.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Video Notes

The assistant can create notes from:

- Bilibili subtitle extraction when subtitles are available.
- Manually pasted transcript text.
- Current-video audio transcription when no transcript is available.

Audio transcription is initiated from the video note panel with `转写音频`. The renderer extracts current video metadata, while Electron main owns temporary cookies, media-tool execution, temporary files, and OpenAI transcription calls.

## Audio Transcription Prerequisites

- Configure an OpenAI API key from the video note panel. The key is stored with Electron desktop preferences and is not rendered back into the UI.
- Provide bundled media tools before running transcription. See [tools/README.md](tools/README.md).
- The app uses the current Bilibili session only for the user-started transcription job and removes temporary job files after completion or failure.
