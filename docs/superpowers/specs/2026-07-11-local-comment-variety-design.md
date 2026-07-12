# Local Comment Variety Design

## Goal

Make comments generated without DeepSeek feel less repetitive and more human while preserving the existing three-choice dialog and random-send behavior.

## Behavior

- Keep showing three local comment candidates at a time.
- Build those candidates by sampling without replacement from a larger pool for the detected content type.
- Mix sincere, reflective phrasing with a smaller amount of lively, conversational phrasing.
- Prefer the current video's cleaned author name in comments; use `UP 主` when no usable author is available.
- Keep every comment within Bilibili's 100-character send limit.
- Avoid unsupported claims about editing, music, visuals, plot, or other video details that local metadata cannot establish.

## Scope

Only the local fallback comment composer and its tests change. DeepSeek generation, dialog layout, send strategy, and preference storage remain unchanged.

## Verification

Tests cover three unique sampled comments, author interpolation and fallback, richer sentence length, unsupported-detail avoidance, and the send limit.
