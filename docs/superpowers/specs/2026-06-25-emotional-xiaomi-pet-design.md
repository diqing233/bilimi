# Emotional Xiaomi Pet Design

- Date: 2026-06-25
- Scope: Make XiaoMi feel more human at key moments without turning Bilimi into a noisy pet game.

## Goal

XiaoMi should stay quiet during normal watching, then react with stronger emotion at meaningful moments: when the owner returns from a collapsed state, when a video finishes, and when review actions succeed or fail.

## Current Context

Bilimi already has:

1. A transparent desktop pet window rendered by `PalaceMaidPetApp` and `LayeredPetRenderer`.
2. Persistent pet states: `idle`, `hint`, `working`, and `error`.
3. A clicked transient with heart effects.
4. A pet hint bridge through `setAssistantPetHint`.
5. Page interaction hint signals from the embedded Bilibili webview.
6. Review action progress and result hints from `FloatingAssistantApp`.

The first implementation should extend these paths instead of replacing them.

## Product Direction

The selected direction is strong-personality, key-moment-only XiaoMi:

1. Default behavior stays calm.
2. Key moments trigger emotional reactions.
3. Repeated reminders are cooled down.
4. The feature remains companion/status feedback, not a new action menu.

## Emotional State Set

Add persistent semantic states:

1. `happy`: warm success or welcome.
2. `shy`: affectionate return/welcome tone.
3. `thinking`: considered reminder or prompt.
4. `cheer`: encouragement or action momentum.
5. `sleepy`: quiet waiting or long idle.
6. `surprised`: sudden event such as video completion.
7. `done`: task finished.

Existing states stay valid for compatibility:

1. `idle`
2. `hint`
3. `working`
4. `error`

The first pass can map new states to existing PNG assets. This keeps behavior stable while leaving clear slots for future 4K state-specific images.

## Trigger Rules

### Return From Collapsed State

When the assistant sidebar is collapsed and the owner clicks XiaoMi to restore/focus Bilimi, XiaoMi should respond with a welcome-home style line and a warm state such as `shy` or `happy`.

### Video Finished

The embedded Bilibili webview should detect video completion inside the guest page and send one pet hint through the existing page-title signal channel:

`视频看完啦，要不要去批阅一下？小咪陪主人收个尾。`

The guest-page script should cool this down per video URL so the same video does not repeatedly trigger the reminder.

### Review Actions

Review actions should use more emotional tones:

1. In progress: `cheer` or `working`.
2. Success: `done` or `happy`.
3. Error: `error`.

The message should feel like XiaoMi reacted to the outcome, not like a generic system status.

### Page Interaction Buttons

Bilibili page button hints should use stronger XiaoMi voice, but still be short. Existing title-signal transport is enough.

## Asset Quality Policy

Do not generate or replace the full character sheet in this pass.

Instead:

1. Extend the asset manifest to support new semantic states.
2. Reuse current clear PNGs for now.
3. Document that final production assets should be 4K transparent PNG sources with clean alpha, then downscaled by the renderer.
4. Future 4K replacement should not require business-logic changes.

## Non-Goals

1. No full pet memory system.
2. No always-on chatter.
3. No new pet action menu.
4. No unreviewed batch-generated production sprites.

## Acceptance Criteria

1. New semantic pet states normalize correctly.
2. Layered pet rendering supports the new semantic states.
3. Clicking XiaoMi to restore Bilimi shows a welcome-home message.
4. Video completion in the embedded page sends a one-time review reminder.
5. Review actions send emotional pet hints for progress, success, and failure.
6. Tests cover the new behavior.
