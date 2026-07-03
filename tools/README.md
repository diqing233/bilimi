# Bundled Media Tools

bilimi expects media tools to be present under a platform-specific directory:

- Windows: `tools/win32/yt-dlp.exe`, `tools/win32/ffmpeg.exe`, `tools/win32/ffprobe.exe`, `tools/win32/whisper/whisper-cli.exe`, and `tools/win32/whisper/models/ggml-small.bin`
- macOS: `tools/darwin/yt-dlp`, `tools/darwin/ffmpeg`, and `tools/darwin/ffprobe`
- Linux: `tools/linux/yt-dlp`, `tools/linux/ffmpeg`, and `tools/linux/ffprobe`

The app does not download these tools at runtime. Development and packaged builds must provide them before audio transcription can run.

For local Windows x64 development or packaging, install the expected files with:

```bash
npm run setup:media-tools
```

The setup script downloads pinned Windows x64 binaries for yt-dlp, FFmpeg, whisper.cpp, and the `ggml-small.bin` model. It verifies the model SHA1 before reporting success. On macOS and Linux, place matching executable files in the platform directory listed above.

Downloaded binaries are ignored by git. Re-run the command when setting up a new checkout or when the note flow reports that a bundled media tool is missing.

## Local Transcription Runtime

Windows video notes use bundled `whisper.cpp` with `ggml-small.bin`. End users do not need Python, pip, faster-whisper, ffmpeg, yt-dlp, or command-line setup after installing the packaged Windows app.
