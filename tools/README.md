# Bundled Media Tools

Bilimi expects media tools to be present under a platform-specific directory:

- Windows: `tools/win32/yt-dlp.exe` and `tools/win32/ffmpeg.exe`
- macOS: `tools/darwin/yt-dlp` and `tools/darwin/ffmpeg`
- Linux: `tools/linux/yt-dlp` and `tools/linux/ffmpeg`

The app does not download these tools at runtime. Development and packaged builds must provide them before audio transcription can run.

For local Windows development, install the expected files with:

```bash
npm run setup:media-tools
```

Downloaded binaries are ignored by git. Re-run the command when setting up a new checkout or when the note flow reports that a bundled media tool is missing.

## Local Transcription Runtime

Video notes use local `faster-whisper` transcription. The app looks for Python in this order:

1. `BILIMI_PYTHON_PATH`
2. `python`
3. `python3`
4. Windows `py -3`

Install the Python dependency before using audio transcription:

```bash
python -m pip install faster-whisper
```

The transcription wrapper is `tools/transcribe_faster_whisper.py`.
