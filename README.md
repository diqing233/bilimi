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

- Current-video audio transcription with local `faster-whisper`.
- Manually pasted transcript text.

Video note generation reads the current Bilibili video metadata for title, BV ID, URL, and archive context, then downloads the current video audio and transcribes it locally. Manually pasted transcript text remains available as a fallback and does not download audio.

## Audio Transcription Prerequisites

- Install Python and `faster-whisper` before running local transcription:

```bash
python -m pip install faster-whisper
```

- Optional: set `BILIMI_PYTHON_PATH` when Bilimi should use a specific Python executable.
- Provide bundled media tools before running transcription. See [tools/README.md](tools/README.md).
  On Windows development checkouts, run:

```bash
npm run setup:media-tools
```

- The app uses the current Bilibili session only for the user-started transcription job and removes temporary job files after completion or failure.
