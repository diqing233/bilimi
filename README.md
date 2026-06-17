# Bilimi

Bilimi is an Electron + React desktop app for browsing Bilibili with a local assistant sidebar. It helps classify videos into local ledgers, automate lightweight Bilibili actions, and create timestamped video notes.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Desktop Pet

Bilimi includes a small transparent Electron desktop pet window rendered by `PalaceMaidPetApp`. The current pet is a lightweight 2D blue-white porcelain chibi maid using generated transparent PNG character states plus small effect layers.

The pet supports `idle`, `hint`, `working`, and `error` status feedback, can be dragged, and restores or focuses the main Bilimi window when clicked. Dragging suppresses the follow-up click reaction. The pet is intentionally companion-only: it does not add platform controls, action menus, trays, teapots, cups, or other props.

## Video Notes

The assistant can create notes from:

- Current-video audio transcription with local `faster-whisper`.
- Manually pasted transcript text.

Video note generation reads the current Bilibili video metadata for title, BV ID, URL, and archive context, then downloads the current video audio and transcribes it locally. Manually pasted transcript text remains available as a fallback and does not download audio.

When local audio transcription is available, the note page exposes `转写音频` and `档案库` as the primary actions. Without an existing note, the page still uses the flat A layout: current video details, generation/archive actions, disabled result entries, and a pasted-transcript fallback. Generated notes include a study-oriented overview with a one-sentence takeaway, key points, a revisit prompt, open questions, keywords, timeline items, and highlights. Timeline items and transcript segments expose `加批注`, which starts a timestamped annotation draft for that moment.

Generated audio notes are also saved into the global video note archive. The archive stores one entry per video, merges by BV ID before falling back to URL, keeps every transcription as a version, and supports searching by title, author, BV ID, transcript, and summary. The archive panel provides dual-pane history browsing, version switching, copyable plain transcripts, copyable summaries, source opening, and deletion confirmation.

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
