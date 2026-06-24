# Transcription Queue Design

## Goal

Bilimi should let users add multiple Bilibili videos to a local transcription queue, process them one at a time, and save each successful audio note into the existing archive as a new version.

## Scope

The first version supports Bilibili video URLs already visible to the assistant. It does not add arbitrary local audio imports, background processing after the app exits, or parallel transcription.

## Behavior

Users can add the current video to the queue from the notes panel. The queue shows pending, running, completed, failed, and canceled jobs. Running is limited to one job so local `faster-whisper`, `yt-dlp`, and `ffmpeg` do not compete for CPU, disk, or session cookies.

Each job stores the video title, URL, BV ID when available, status, timestamps, current progress, and any failure message. Completed jobs keep the generated archive note id so users can see that the item landed in the archive. Failed jobs stay visible and can be retried. Pending jobs can be canceled before they start.

If a video already has an archive entry, queue completion still saves a new archive version rather than overwriting prior text.

## Architecture

The Electron main process owns the queue because it already owns audio download, cookie export, temporary files, and archive persistence. A focused queue manager serializes jobs and emits queue snapshots to renderer windows.

The renderer only enqueues the current video, renders queue state, and calls retry/cancel actions. Current single-video transcription remains available for direct use, but the multi-video flow goes through the queue.

## Error Handling

A failed job records the error message and the queue immediately advances to the next pending job. Temporary transcription files are still cleaned by the existing transcription service. Closing the app stops any active child work naturally; on the next launch, persisted running jobs are normalized back to failed so the user can retry.

## Testing

Tests cover the queue manager, store persistence, IPC/preload shape, and the notes UI. The most important behavior is serial execution: adding two jobs starts only the first, completes or fails it, then starts the next.
