# Bundled Media Tools

Bilimi expects media tools to be present under a platform-specific directory:

- Windows: `tools/win32/yt-dlp.exe` and `tools/win32/ffmpeg.exe`
- macOS: `tools/darwin/yt-dlp` and `tools/darwin/ffmpeg`
- Linux: `tools/linux/yt-dlp` and `tools/linux/ffmpeg`

The app does not download these tools at runtime. Development and packaged builds must provide them before audio transcription can run.
