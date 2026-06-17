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

The default `整理札记` action uses local audio transcription when it is available. Generated notes include a study-oriented overview with a one-sentence takeaway, key points, a revisit prompt, open questions, keywords, timeline items, and highlights. Timeline items and transcript segments expose `加批注`, which starts a timestamped annotation draft for that moment.

## Audio Transcription Prerequisites

- Install Python and `faster-whisper` before running local transcription:

```bash
python -m pip install faster-whisper
```

- Optional: set `BILIMI_PYTHON_PATH` when Bilimi should use a specific Python executable.
- Local transcription defaults to CPU with `int8` compute, so CUDA is not required.
- Provide bundled media tools before running transcription. The app needs `yt-dlp`, `ffmpeg`, and `ffprobe`. See [tools/README.md](tools/README.md).
  On Windows development checkouts, install them with:

```bash
npm run setup:media-tools
```

- Restart Bilimi after changing main-process code or installing local transcription prerequisites.
- The app uses the current Bilibili session only for the user-started transcription job and removes temporary job files after completion or failure.
