# Crying Pet Interactions Design

- Date: 2026-06-29
- Scope: Add a local crying XiaoMi expression at emotionally appropriate moments, while keeping the current pet shortcut layout stable.

## Goal

XiaoMi should feel more alive and cute by reacting with a light wronged/crying expression when the owner's behavior naturally justifies it. The expression should be brief, contextual, and recover quickly so Bilimi remains a quiet companion instead of a noisy pet game.

The user-provided local image should become the crying expression source for this behavior. During implementation, the image should be copied into the pet asset tree instead of being referenced from a temporary clipboard path.

## Current Context

Bilimi already has:

1. A floating XiaoMi pet rendered by `PalaceMaidPetApp` and `LayeredPetRenderer`.
2. Persistent pet states such as `idle`, `hint`, `working`, `error`, `sleepy`, `shy`, `happy`, `cheer`, and `done`.
3. A click transient that swaps character art briefly.
4. Local pet hints and global assistant pet hints.
5. A right-click prompt with `对话宠物` and `关闭宠物`.
6. Separate pet hover shortcuts such as `赞`, `踢`, `表`, and `库`.
7. Separate `-` and `+` resize controls.

The new behavior should extend these paths rather than introducing a new pet control system.

## Product Direction

Use a light wronged crying expression, not a heavy sad state.

1. Crying should feel like XiaoMi is being cute and emotionally responsive.
2. It should appear only at meaningful moments.
3. It should auto-recover after a short time or after a positive owner action.
4. It should not replace successful, working, or normal hint feedback.
5. It should not move or redesign existing pet shortcut buttons.

## Layout Requirements

The existing pet hover shortcut buttons stay where they are.

Do not move or merge:

1. `赞`
2. `踢`
3. `表`
4. `库`

Only the pet self-controls should align into one bottom row:

1. `对话宠物`
2. `关闭宠物`
3. `-`
4. `+`

This row should remain near the bottom of XiaoMi's floating surface. It should avoid overlapping XiaoMi's face, the speech bubble, or the shortcut fan.

## Crying Expression State

Add a semantic crying state, tentatively named `crying`.

`crying` means XiaoMi is lightly wronged, teary, or asking for attention. It should use the user-provided crying image. If the image cannot load, it should fall back to the existing `error` or `idle` art according to the surrounding context.

Recommended visual duration:

1. 4 to 6 seconds for ordinary crying reactions.
2. While hovering `关闭宠物`, keep crying only as long as the hover intent remains active.
3. Cancel or recover immediately when the owner performs a positive action.

Recommended cooldown:

1. Repeated-click crying: 20 to 30 seconds.
2. Long-idle crying: 3 to 5 minutes.
3. Close-hover crying: no global cooldown, but only after the 1-second hover threshold.

## Trigger Rules

### Close-Hover Crying

When the right-click prompt is open and the pointer stays over `关闭宠物` for 1 second:

1. XiaoMi switches to `crying`.
2. The bubble can say: `主人要把小咪收起来了吗……`
3. Moving the pointer away before 1 second cancels the timer.
4. Moving the pointer away after crying restores the previous local state or hint.
5. Clicking `关闭宠物` still performs the actual close action.
6. Hovering never closes XiaoMi by itself.

### Repeated Click Crying

When the owner repeatedly clicks XiaoMi in a short window, such as 3 valid clicks within about 2 seconds:

1. XiaoMi switches to `crying`.
2. The bubble can say: `主人你坏……小咪会被点晕的。`
3. The normal restore-main-window click behavior should still work.
4. Dragging and long-press suppression should not count as teasing clicks.

### Long-Idle Crying

After a longer idle period than the existing ordinary idle greeting, XiaoMi may occasionally switch to `crying`.

Suggested timing:

1. Keep the existing normal idle greeting around 45 seconds.
2. Add crying only after a longer quiet period, such as 2 to 3 minutes.
3. Do not trigger long-idle crying while the owner is hovering XiaoMi, dragging XiaoMi, typing in pet chat, or running an action.

Example bubble:

`主人是不是忘记小咪了……`

### Failure Or Blocked Action Crying

Use `crying` for soft user-correctable failures, while keeping `error` for harder technical failures.

Good `crying` cases:

1. No current video when a video shortcut is used.
2. Pet chat is disabled when the owner tries to talk.
3. DeepSeek pet chat cannot answer but the app itself is still fine.
4. A requested action is unavailable because the current context is missing.

Keep `error` for:

1. Runtime bridge failures.
2. Asset load failures.
3. Transcription or automation exceptions.
4. Cases where the user should inspect the assistant workspace for a real problem.

### Slow Work Reassurance

For long-running operations such as transcription or note generation, XiaoMi may use one soft crying line if the operation takes noticeably long and no progress update has appeared.

Example bubble:

`小咪还在努力，不要丢下我呀。`

This should be rate-limited and must not replace normal `working`, `cheer`, or `done` feedback.

## Recovery Rules

Crying should recover to a happier state when the owner re-engages.

Good recovery actions:

1. Owner opens the main assistant.
2. Owner clicks `对话宠物`.
3. Owner sends a pet chat message.
4. A shortcut or assistant action succeeds.
5. Owner moves away from `关闭宠物`.

Example recovery line:

`主人又理小咪啦。`

## Non-Goals

1. Do not redesign the pet shortcut fan.
2. Do not add a new pet menu system.
3. Do not add a full affection, mood, or memory system.
4. Do not make XiaoMi cry constantly during ordinary use.
5. Do not reference the temporary clipboard image path directly from production code.

## Acceptance Criteria

1. The crying expression is represented by a semantic pet state.
2. The user-provided crying image is stored as a durable app asset.
3. Hovering `关闭宠物` for 1 second triggers crying without closing XiaoMi.
4. Moving away from `关闭宠物` cancels or recovers the crying reaction.
5. Repeated valid clicks can trigger the crying reaction without counting drags.
6. Long idle can trigger crying only after a longer quiet period and with cooldown.
7. Soft blocked actions can use crying, while technical failures continue to use `error`.
8. The pet shortcut buttons `赞 / 踢 / 表 / 库` keep their current layout.
9. `对话宠物 / 关闭宠物 / - / +` share one bottom control row.
10. Tests cover state normalization, asset mapping, close-hover timing, repeated-click timing, idle cooldown, and the bottom-row layout behavior.
