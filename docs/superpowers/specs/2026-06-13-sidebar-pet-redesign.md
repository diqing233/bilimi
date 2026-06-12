# Bilimi Sidebar And Pet Redesign

- Date: 2026-06-13
- Status: Approved design for implementation planning
- Scope: Move floating assistant functions into the main app sidebar, and turn the floating entry into a desktop pet.

## 1. Goal

Bilimi should separate functional controls from companion presence.

The main application window will own all assistant functionality through an internal sidebar. The former floating entry will become a lightweight desktop pet: a hand-drawn Q-style palace maid that can restore the app, show status, and provide gentle prompts.

This keeps the product's "desk memorial review" concept while reducing duplicated floating panels and clarifying where users perform actions.

## 2. Current Context

The current experience has two surfaces:

1. A Bilimi desktop window with an embedded Bilibili browsing area.
2. A floating assistant panel opened from the floating button, containing tabs such as `批阅`, `礼记`, and `掌库`.

The requested redesign cancels the separate floating function panel. All of its functional controls move into the main Bilimi window.

## 3. Recommended Approach

Use a two-surface model:

1. Main app window: embedded Bilibili browser plus internal Bilimi sidebar.
2. Pet window: independent always-on-top desktop companion.

This is preferred over an in-window-only pet because the pet must remain available when the main window is minimized. It is also preferred over keeping both the old floating panel and the new sidebar because duplicate control surfaces would make state and user expectations harder to reason about.

## 4. Main Window Layout

The main Bilimi window becomes a two-column shell:

1. The embedded Bilibili browser remains the primary content area.
2. A Bilimi sidebar is fixed inside the right side of the main window.

The sidebar is open by default. The Bilibili browser area resizes to make room for it, so the sidebar does not cover webpage content.

The sidebar can collapse into a narrow icon rail. The icon rail must provide:

1. A collapse or expand control.
2. Icon entry points for `批阅`, `礼记`, and `掌库`.

Selecting a tab icon while collapsed expands the sidebar and switches to that tab.

## 5. Sidebar Features

The sidebar keeps the existing tab structure:

1. `批阅`
2. `礼记`
3. `掌库`

### 5.1 批阅

`批阅` is the default tab. It owns the main active workflow:

1. Show the current item under review.
2. Show lightweight recommendation judgment and brief assistant text.
3. Provide the active action controls, including existing actions such as light appreciation, archive into the Bilimi collection, coin appreciation, short-comment drafting, marking the current item as read, and opening the library view.
4. Surface actionable errors and confirmations that require user input.

All platform-affecting actions remain explicitly user-triggered.

### 5.2 礼记

`礼记` owns history and recall:

1. Items already read.
2. Appreciated or archived items.
3. Comment candidates and sent comment records.
4. Operation receipts.
5. Failed or retryable actions.

It is a review log and recovery surface, not the primary place for first-time item actions.

### 5.3 掌库

`掌库` owns collection management:

1. Bilimi dedicated collection status.
2. Archived items.
3. Items that need archive repair.
4. Entry points for old collection cleanup.

It should remain a management view rather than a duplicate of the active review workflow.

## 6. Floating Panel Removal

The old floating function panel is removed.

Clicking the pet must not reopen the old function panel. All functional content previously shown by that panel must be reachable inside the main sidebar.

This avoids maintaining two functional surfaces and gives the user one stable place for controls.

## 7. Desktop Pet

The former floating button becomes an independent desktop pet window.

The pet is a hand-drawn Q-style palace maid aligned with Bilimi's memorial-review world, not a pixel-art Codex clone. The reference is the Codex companion pattern: small, recognizable, expressive, and useful as a persistent app companion.

The pet window should:

1. Stay available when the main Bilimi window is minimized.
2. Remain lightweight and visually unobtrusive.
3. Support click-to-restore behavior for the main Bilimi window.
4. Show short state prompts or bubbles.
5. Avoid becoming another action menu.

Clicking the pet is equivalent to opening or restoring Bilimi. It should focus the main window when possible.

## 8. Pet States

The first implementation needs four states:

1. `待机`: normal calm presence.
2. `提示`: lightweight prompts such as pending review, archive completed, or confirmation needed.
3. `处理中`: short busy feedback while actions such as like, favorite, coin, archive, or comment drafting are in progress.
4. `出错`: recoverable failure feedback such as expired login, missing page target, collection creation failure, or comment send failure.

Detailed recovery instructions and retry controls belong in the sidebar. The pet only gives the user a gentle signal that attention is needed.

## 9. Interaction Rules

1. Sidebar controls are the only place for primary actions.
2. Pet click restores or opens the main app window.
3. Pet prompts may point the user back to the sidebar but must not perform platform-changing actions.
4. The sidebar is open by default.
5. Collapsing the sidebar preserves a narrow icon rail.
6. The embedded browser resizes when the sidebar opens or closes.
7. The separate floating function panel is removed.

## 10. Out Of Scope

This redesign does not include:

1. New Bilibili automation rules.
2. New platform actions beyond the existing assistant functions.
3. A pet marketplace or multi-pet selector.
4. Pet leveling, dressing, or long-term raising systems.
5. Replacing the Bilimi dedicated collection behavior.
6. Changing the existing consent requirement for coin or comment actions.

## 11. Error Handling

Errors should be split between the two surfaces:

1. Sidebar: specific explanation, retry options, manual takeover options, and any required confirmation.
2. Pet: short state cue that something needs attention.

For example, if login expires, the pet can enter `出错` with a short prompt. The sidebar should explain that the user needs to log in again inside the embedded browser.

## 12. Testing Strategy

Implementation should be verified with:

1. Layout tests or component tests for sidebar open and collapsed states where possible.
2. Window behavior verification for pet click restoring the main window.
3. State transition tests for pet status mapping.
4. Manual desktop verification on Windows for minimized app plus visible pet.
5. Regression checks that platform-changing actions still require explicit user action in the sidebar.

## 13. Acceptance Criteria

The redesign is complete when:

1. The main window shows Bilibili content and a right-side Bilimi sidebar by default.
2. The Bilibili content area resizes instead of being covered by the sidebar.
3. The sidebar can collapse to and expand from an icon rail.
4. `批阅`, `礼记`, and `掌库` remain available in the sidebar.
5. The old floating function panel no longer appears.
6. The floating entry is replaced by an independent palace-maid desktop pet.
7. Clicking the pet restores or opens the main Bilimi window.
8. The pet supports `待机`, `提示`, `处理中`, and `出错` states.
9. Primary actions are triggered from the sidebar, not from the pet.
