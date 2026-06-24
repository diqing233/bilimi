# Transcription Queue Design

## Goal

Bilimi should let users click the existing `转写音频` action across multiple Bilibili videos, process those requests one at a time, and save each successful audio note into the existing archive as a new version.

## Scope

The first version supports Bilibili video URLs already visible to the assistant. It does not add arbitrary local audio imports, background processing after the app exits, or parallel transcription.

## Behavior

Users add the current video through the existing `转写音频` button. If no transcription is running, that click starts the first queued job. If another video is already running, the same button enqueues the current video and shows a message such as `正在转写「A」，「B」已加入队列。` Running is limited to one job so local `faster-whisper`, `yt-dlp`, and `ffmpeg` do not compete for CPU, disk, or session cookies.

Each job stores the video title, URL, BV ID when available, status, timestamps, current progress, and any failure message. Completed jobs keep the generated archive note id so users can see that the item landed in the archive. Failed jobs stay visible and can be retried. Pending jobs can be canceled before they start.

The notes panel does not add a separate queue button. It shows only a compact running status for the current active job, including the running video title, progress, and a lightweight pending count.

If a video already has an archive entry, queue completion still saves a new archive version rather than overwriting prior text.

## Architecture

The Electron main process owns the queue because it already owns audio download, cookie export, temporary files, and archive persistence. A focused queue manager serializes jobs and emits queue snapshots to renderer windows.

The renderer only enqueues the current video through the primary transcription action and renders compact queue state. Current single-video transcription remains as a fallback when the queue bridge is unavailable, but normal audio transcription flows through the queue.

## Error Handling

A failed job records the error message and the queue immediately advances to the next pending job. Temporary transcription files are still cleaned by the existing transcription service. Closing the app stops any active child work naturally; on the next launch, persisted running jobs are normalized back to failed so the user can retry.

## Testing

Tests cover the queue manager, store persistence, IPC/preload shape, and the notes UI. The most important behavior is serial execution: adding two jobs starts only the first, completes or fails it, then starts the next.
