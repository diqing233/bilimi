# Bilimi Video Audio Transcription Fallback Design

- Date: 2026-06-15
- Status: Approved design draft
- Scope: Current-video audio transcription fallback for video notes
- Decision: Bundle `yt-dlp` and `ffmpeg`, reuse the current Bilibili login session through temporary cookies, and transcribe audio with OpenAI `whisper-1`

## Background

Bilimi already attempts to extract Bilibili subtitle JSON from the current video page and can fall back to user-pasted transcripts. Some videos expose no subtitle list through either the page state or the player API. For those videos, users still need a complete, viewable, copyable transcript before AI note generation can be useful.

This design adds an audio transcription fallback to the existing video note workflow. It is not a batch downloader, not a local transcription model, and not a way to bypass platform access rules. It works only for the currently open video and only with the user's current access rights.

## Goals

1. Let users create a transcript when Bilibili subtitle extraction returns no usable transcript.
2. Download or extract audio for the current Bilibili video with bundled `yt-dlp` and `ffmpeg`.
3. Support videos that require the user's current Bilibili login session.
4. Export Bilibili cookies only for the active transcription request and delete the temporary cookie file afterwards.
5. Split long or large audio into multiple parts automatically before transcription.
6. Use OpenAI `whisper-1` to produce timestamped transcript segments.
7. Merge segment transcripts into the existing `TranscriptSegment[]` shape.
8. Keep the transcript visible, copyable, saveable, and compatible with existing video note history.
9. Preserve the existing manual paste fallback.

## Non-Goals

1. No local transcription model in the first version.
2. No batch transcription or history scanning.
3. No attempt to download videos that the current user cannot play.
4. No persistent cookie storage.
5. No long-term storage of temporary audio files.
6. No AI summary expansion beyond the agreed default output: short summary, key points, timeline, and one-image long-card output.
7. No external-tool auto-download in the first version; `yt-dlp` and `ffmpeg` are bundled.

## User Experience

The video note panel keeps the current actions: automatic note organization and manual transcript paste. When automatic subtitle extraction finds no transcript, the panel shows a clear fallback state:

- No usable subtitles were found.
- The user can transcribe audio.
- The user can still paste a transcript manually.

When the user clicks "Transcribe audio", Bilimi shows progress steps:

1. Preparing current login session.
2. Downloading audio.
3. Preparing audio segments.
4. Transcribing segment N/M.
5. Merging transcript.
6. Generating video note.

When transcription succeeds, the generated transcript appears in the existing transcript tab with timestamps and can be copied. The existing overview tab can still use local rules at first. Later AI note generation uses the transcribed transcript as input.

If transcription fails, the current note state stays intact. The user gets a direct next step, such as checking Bilibili login, OpenAI API key, network access, or video permissions.

## Architecture

The renderer remains a thin UI and orchestration client. The main process owns filesystem access, temporary files, cookie export, external commands, and OpenAI API calls.

New main-process modules:

1. `electron/main/mediaToolPaths.ts`
   - Resolves bundled `yt-dlp` and `ffmpeg` paths.
   - Handles development and packaged-app paths.
   - Returns actionable errors when a bundled tool is missing.

2. `electron/main/bilibiliCookieExport.ts`
   - Reads cookies from the Electron session for Bilibili domains.
   - Writes a temporary Netscape-format cookie file for `yt-dlp`.
   - Does not persist cookies in `electron-store`.
   - Cleans up the cookie file after success, failure, or cancellation.

3. `electron/main/audioDownload.ts`
   - Wraps `yt-dlp`.
   - Inputs: current video URL, temporary cookie path, output directory.
   - Outputs: downloaded audio file path and basic metadata.
   - Uses conservative arguments that avoid playlist or batch behavior.

4. `electron/main/audioSegmenter.ts`
   - Wraps `ffmpeg`.
   - Converts audio into an OpenAI-supported format when needed.
   - Splits audio automatically when it would exceed the transcription request size limit.
   - Returns ordered segment files with start offsets.

5. `electron/main/openAiTranscription.ts`
   - Calls OpenAI Audio Transcriptions with `model: "whisper-1"`.
   - Requests timestamp-friendly output, such as verbose JSON.
   - Converts each response into `TranscriptSegment[]`.

6. `electron/main/videoTranscriptionService.ts`
   - Coordinates cookie export, audio download, segmentation, transcription, merge, and cleanup.
   - Emits progress updates to the renderer.
   - Accepts cancellation and guarantees best-effort cleanup.

Renderer changes:

1. Add a transcription action to `VideoNotesPanel`.
2. Add IPC methods to request transcription and receive progress.
3. Convert the returned transcript into an existing `VideoNote` through the current note draft pipeline.
4. Keep manual paste and auto subtitle extraction available.

## Data Flow

1. User clicks "Transcribe audio" in the current video note panel.
2. Renderer sends the current video URL and metadata to the main process.
3. Main process exports temporary Bilibili cookies from the current Electron session.
4. Main process runs bundled `yt-dlp` with the current video URL and cookie file.
5. Main process runs bundled `ffmpeg` to normalize and split audio.
6. Main process sends each segment to OpenAI `whisper-1`.
7. The service offsets segment timestamps and merges them into one transcript.
8. Renderer receives `TranscriptSegment[]`.
9. Renderer creates or updates the current video note using existing local note generation.
10. Main process deletes temporary cookie and audio files.

## Security And Privacy

1. Cookie export is user-action scoped. It only happens after the user starts audio transcription.
2. Cookie files are temporary and deleted after the job ends.
3. Cookies are never saved in `electron-store`.
4. Temporary audio files are deleted after the job ends.
5. Audio is sent to OpenAI only because the user explicitly started transcription and configured the app for cloud transcription.
6. Error messages must not print cookie values, API keys, or signed media URLs.
7. API keys are configured in-app, locally saved, not displayed in plain text by default, and can be tested, replaced, or cleared.

## Error Handling

The UI should preserve the current note and expose a clear next step for each failure:

1. Missing bundled tool: "The bundled media tool is missing. Reinstall or rebuild the app."
2. Cookie export failed: "Could not read the current Bilibili login session. Reopen the video and retry."
3. `yt-dlp` download failed: "Audio download failed. Confirm this video plays in Bilimi and retry."
4. `ffmpeg` failed: "Audio preparation failed. The downloaded media format may be unsupported."
5. OpenAI authentication failed: "OpenAI API key is invalid or missing."
6. OpenAI quota/network failed: "Transcription request failed. Check network, quota, or retry later."
7. User cancelled: "Audio transcription was cancelled."
8. Cleanup failed: Keep the user-facing error focused on the original failure, but log cleanup diagnostics without secrets.

## Testing Strategy

Unit tests:

1. Resolve media tool paths in development and packaged path shapes.
2. Format Bilibili cookies for `yt-dlp` without leaking unrelated domains.
3. Build `yt-dlp` arguments for a single current video only.
4. Build `ffmpeg` segmentation plans and preserve segment order.
5. Convert OpenAI verbose transcription JSON into `TranscriptSegment[]`.
6. Merge transcript segments with offset timestamps.
7. Verify cleanup runs after success, failure, and cancellation.

Component tests:

1. `VideoNotesPanel` shows audio transcription fallback when no transcript is available.
2. Progress states render in order.
3. Successful transcription populates the transcript tab.
4. Failure keeps manual paste available.

Manual verification:

1. A public video with no subtitles can produce a transcript through audio transcription.
2. A login-required video that plays in Bilimi can be downloaded with temporary cookies.
3. Long audio is split and merged with increasing timestamps.
4. Temporary cookie and audio files are deleted after completion.
5. Existing subtitle extraction and manual paste still work.

## Acceptance Criteria

1. When automatic subtitles are unavailable, the user can start audio transcription from the video note panel.
2. `yt-dlp` and `ffmpeg` are resolved from bundled app assets.
3. Current Bilibili session cookies are exported only for the running transcription job.
4. Long audio is split automatically before OpenAI transcription.
5. OpenAI `whisper-1` output becomes timestamped `TranscriptSegment[]`.
6. The transcript is visible and copyable in the existing transcript tab.
7. The generated note can be saved to existing local video note history.
8. Temporary cookie and audio artifacts are cleaned after success, failure, or cancellation.
9. Full tests and build pass.
