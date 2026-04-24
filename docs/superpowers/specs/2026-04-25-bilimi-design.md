# Bilimi Design Spec

- Date: 2026-04-25
- Status: Approved design draft for planning
- Product: Bilimi
- Theme: "宫廷奏折风" B 站桌面小助手

## 1. Product Summary

Bilimi is a Windows desktop Bilibili helper that presents browsing and lightweight interaction as "批阅奏折".

The product body is an Electron desktop app with a web frontend UI and a local automation module. The app embeds a controlled Bilibili browsing experience, preserves the user's login locally, and overlays a playful court-memorial assistant on top of the browsing flow.

The assistant persona is `司礼监掌印官`. The tone is archaic, readable, lightly teasing, and consistently in-character. The experience should feel like reviewing memorials at a desk rather than using a generic floating utility.

## 2. Goals

Phase 1 goals:

1. Let the user browse Bilibili inside a controlled desktop app experience.
2. Provide a floating assistant that can expand from a small seal into a memorial-style review panel.
3. Support the four core actions `赏 / 赐 / 表 / 阅`.
4. Use a dedicated Bilimi favorites folder so the user's existing favorites structure is not disturbed.
5. Add lightweight recommendation annotations so the assistant can suggest "可赏 / 可阅 / 慎入 / 请陛下过目" and gradually reflect user preference.
6. Keep the visual and copy style strongly "奏折风", but still readable for everyday use.

Success criteria for Phase 1:

1. A user can log in once and later reopen the app without re-authenticating every session.
2. A user can open Bilibili, browse videos, and invoke assistant actions from the overlay.
3. `赏` and `赐` work against the real Bilibili UI or authenticated web flow.
4. The app creates or reuses a Bilimi-only favorites folder.
5. Recommendation labels appear both on recommendation cards and in the expanded assistant panel summary.

## 3. Phase 1 Non-Goals

The following are explicitly out of scope for the first implementation cycle:

1. Weekly and monthly report generation (`邸报`, `账本`, watch-history reports).
2. Auto-clicking "not interested", "block", or similar negative actions on behalf of the user.
3. A pure website version as the shipped product body.
4. Full autonomous browsing without the user present.
5. Reliance on undocumented app-specific private APIs as the primary implementation strategy.

## 4. Core User Experience

## 4.1 Primary flow

1. The user opens Bilimi.
2. If not authenticated, the user logs in manually inside the embedded Bilibili browser.
3. The app preserves that authenticated browser session locally.
4. While browsing, the user sees a small folded-state seal entry anchored at the bottom-right of the app view.
5. Hovering over the seal shows a short in-character prompt such as `是否开折批阅`.
6. Clicking the seal expands the assistant into an `案头奏折` review panel.
7. The expanded panel shows the current recommendation or current video as a memorial entry, with context, summary, and action sign-strips.
8. The user chooses `赏 / 赐 / 表 / 阅`.
9. The assistant performs the action through the embedded browser session and reflects the result in Bilimi tone.

## 4.2 Assistant states

### Folded state

- Visual form: a small seal /印玺, not a generic circular FAB
- Position: bottom-right corner of the embedded browsing experience
- Behavior: idle, hover prompt, click to expand

### Hover prompt

- Short, readable, in-character copy
- Example tone: `掌印官请旨：是否开折批阅？`
- Must feel like a polite prompt, not a tooltip from a normal productivity app

### Expanded state

- Form: a desk memorial sheet laid horizontally on a wooden desk
- Behavior: expands from the folded seal
- Function: presents current item summary, recommendation note, and action sign-strips

## 4.3 Action behavior

| Action | User-facing meaning | Product behavior |
| --- | --- | --- |
| `赏` | 轻赏此条 | Perform `点赞 + 加入 Bilimi 专用收藏夹` |
| `赐` | 厚赐此条 | Perform `点赞 + 投币 + 收藏`; before coin action ask user to choose `1 coin / 2 coins / cancel` |
| `表` | 拟奏评论 | Generate 3 memorial-style candidate comments and let the user choose one to post |
| `阅` | 皇帝已阅 | No platform action; dismiss or mark reviewed only |

Rules:

1. `赐` must not silently decide 1 coin vs 2 coins.
2. `表` must not auto-post without explicit user selection.
3. `阅` must remain a no-op in terms of platform mutation.
4. `赏` and `赐` should reuse the same dedicated Bilimi favorites folder.

## 4.4 Recommendation annotation behavior

Phase 1 recommendation intelligence is lightweight and assistive, not fully automatic.

The assistant should:

1. Add small sign-strip judgments to visible recommendation cards.
2. Repeat those judgments inside the expanded memorial panel summary.
3. Slightly vary recommendation copy by content type.

Example content-tone mapping:

1. Funny / light content: `解闷`, `失仪而不鄙`, `可赏`
2. Knowledge content: `增广见闻`, `可列案头`, `可阅`
3. Plot / story content: `请陛下亲览`, `不敢泄机`
4. Suspicious ad-like content: `市气过浓`, `商贩夹带`, `慎入`

Phase 1 preference handling:

1. Track lightweight local preferences from user actions and repeated patterns.
2. Use those signals to adjust recommendation copy and suggestion ranking.
3. Do not auto-hide, auto-dislike, or auto-block content in Phase 1.

## 5. Visual and Tone System

## 5.1 Visual direction

The visual reference is `horizontal memorial on a wooden desk`, not a poster and not a normal app card.

Required visual traits:

1. Warm wood desktop surface
2. Pale xuan-paper / parchment body
3. Red seals and red marginal annotations
4. Hanging sign-strips for actions
5. Quiet desk still-life composition
6. No skewed or intentionally crooked frames
7. More document-like than promotional

## 5.2 Expanded panel composition

The approved expanded composition is:

1. Left side: metadata slips (`题名`, category, duration, lightweight notes)
2. Middle: main memorial text area
3. Main text direction: horizontal body copy for readability in the approved direction
4. Right side: red `朱批` area and vertically styled action sign-strips
5. Bottom area: dedicated Bilimi favorites stamp / archive indication

## 5.3 Tone rules

The persona voice must stay consistent with `司礼监掌印官`.

Tone requirements:

1. Archaic but understandable
2. Respectful, playful, slightly theatrical
3. Never meme-spam or become pure parody
4. Use short ceremonial phrases where helpful

Preferred style examples:

1. `臣谨以此物 进呈陛下`
2. `臣特备薄礼 恭呈御览`
3. `此物臣不敢私用，特 敬献皇上`

## 6. Technical Architecture

## 6.1 High-level architecture

Bilimi Phase 1 uses three major parts:

1. Electron shell
2. React renderer UI
3. Local automation layer

Responsibilities:

### Electron shell

1. App lifecycle
2. Browser window creation
3. Persistent authenticated session storage
4. Secure IPC boundaries
5. Native window behavior and optional always-on-top capabilities if needed later

### React renderer UI

1. Assistant overlay UI
2. Folded seal state
3. Expanded memorial state
4. Copy rendering and action prompts
5. Local user feedback controls

### Local automation layer

1. Read current page context from the embedded browser
2. Locate actionable UI targets
3. Trigger browser actions for like, favorite, coin, and comment
4. Fall back safely when a control cannot be confidently identified

## 6.2 Embedded browser strategy

Phase 1 browsing happens inside the Electron app, not in the system browser.

Rules:

1. The user logs in manually inside the embedded browser once.
2. Bilimi stores the resulting browser session locally via Electron session persistence.
3. The app does not ask the user for Bilibili credentials directly.
4. The assistant acts within the same authenticated web context the user is already using.

## 6.3 Automation strategy

The automation priority order is:

1. Browser DOM / text / stable structure detection inside the embedded experience
2. Controlled event triggering against the embedded web page
3. Visual recognition plus simulated input only where DOM-level control is insufficient or unstable

This means Phase 1 is not a pure computer-vision bot. It is a hybrid local assistant that prefers embedded-browser awareness and uses visual fallback where necessary.

Safety rules:

1. Never perform blind clicks when the target cannot be identified confidently.
2. If a target is ambiguous, surface a retry or manual-takeover prompt.
3. Keep mutation actions user-initiated.

## 6.4 Local data storage

Phase 1 keeps data local to the device.

Local storage includes:

1. Assistant preferences and lightweight taste signals
2. Bilimi favorites folder metadata
3. Overlay state preferences
4. Cached generated comment candidates if needed for immediate reuse

Phase 1 does not store the user's raw credentials.

## 7. Bilibili Integration Boundaries

Bilimi should prefer the same authenticated web flows the user already has inside the embedded browser.

Integration needs in Phase 1:

1. Like state detection and mutation
2. Favorite state detection and mutation
3. Creation or reuse of a dedicated Bilimi favorites folder
4. Coin action prompting and submission
5. Comment submission after explicit user choice

Important boundary:

1. Do not disturb the user's existing favorites organization.
2. Create a Bilimi-only folder on first use if it does not exist.
3. If folder creation fails, prompt the user and do not silently use another folder.

Recommended folder naming:

- `Bilimi 内库`

The UI can describe it more poetically, but the actual folder identity should stay stable.

## 8. Component Breakdown

The implementation should be structured around clear units:

1. `Session Manager`
2. `Embedded Browser Host`
3. `Assistant Overlay`
4. `Recommendation Annotator`
5. `Action Executor`
6. `Comment Composer`
7. `Local Preference Store`

Responsibilities:

### Session Manager

- Owns persisted browser session and auth checks

### Embedded Browser Host

- Hosts the Bilibili browsing surface and exposes safe inspection hooks

### Assistant Overlay

- Owns folded seal, hover bubble, expanded memorial, and status feedback

### Recommendation Annotator

- Maps page content and local preference signals to lightweight labels and summary copy

### Action Executor

- Performs `赏 / 赐 / 阅` and folder management

### Comment Composer

- Produces 3 candidate memorial-style comments based on current context

### Local Preference Store

- Stores local assistant memory that affects annotations and copy choices

## 9. Error Handling and Recovery

The assistant should fail gracefully and stay in-character without hiding the failure.

Required behaviors:

1. If login expires, prompt the user to re-enter Bilibili inside the embedded browser.
2. If an action target cannot be found, show a retry/manual prompt instead of guessing.
3. If favorite-folder creation fails, stop before touching another folder.
4. If coin flow changes unexpectedly, ask the user to confirm before retrying.
5. If comment submission fails, keep the 3 drafted comments visible so the user can retry.

Error tone guidance:

1. Use respectful, readable copy
2. Avoid technical panic language in the main UI
3. Keep detailed logs in development mode for debugging

## 10. Testing Strategy

Phase 1 requires testing at three levels:

### Unit tests

1. Recommendation label mapping
2. Comment candidate generation rules
3. Action-to-platform behavior mapping
4. Preference-store updates

### Integration tests

1. Folded seal to expanded memorial transition
2. IPC boundaries between Electron and renderer
3. Session persistence behavior
4. Action executor against mocked page structures

### Manual validation

1. Windows smoke test with a real Bilibili login
2. Favorites-folder creation and reuse test
3. `赏 / 赐 / 表 / 阅` behavior verification
4. Recommendation annotation sanity check on a live recommendation feed

CI should not depend on live Bilibili behavior. Live-site verification remains a manual acceptance step.

## 11. Deferred Phase 2 Direction

The next major phase after Phase 1 is the `邸报 / 账本` reporting layer.

Target direction for that later phase:

1. Use watch-history time and entry count as the main source
2. Prompt once per week whether to `抄录账本`
3. Present weekly/monthly output in `邸报条列体 / 仪式感` style

This direction is intentionally deferred and should not expand the Phase 1 implementation plan.

## 12. Scope Lock for Planning

The implementation plan written after this spec should cover only:

1. Electron shell setup
2. Embedded browsing experience
3. Folded and expanded assistant UI
4. Recommendation annotations
5. `赏 / 赐 / 表 / 阅`
6. Bilimi dedicated favorites folder handling
7. Local session and lightweight preference persistence

Anything outside that list is out of scope unless a later spec revision explicitly adds it.
