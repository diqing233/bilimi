# Fresh Old Favorite Rejudge Design

- Date: 2026-06-28
- Scope: old favorite archive preview, unmatched item "再次判断" action
- Status: approved for implementation

## Problem

The current "再次判断" action reuses the stale preview item already held in React state. It can react to edited local ledger keywords, but it cannot see user changes made on Bilibili after "手动分类", such as new video tags or changed favorite folder membership.

It also auto-selects the newly found target, which makes the button feel close to staging an archive action. The desired behavior is only to judge again from fresh evidence.

## Product Decision

"再次判断" refreshes the single video's latest Bilibili evidence and reruns classification for that one item.

The action must not append the video to any favorite folder and must not automatically add the found target to the execution plan. The user still has to explicitly choose a target or use the later confirm flow before Bilimi writes to Bilibili.

## Data Flow

1. The panel calls a new rejudge callback with the pending preview item.
2. The app reads the latest Bilibili favorite data for that video's `aid`.
3. The app rebuilds a one-item preview using the current ledger definitions and latest target membership.
4. The panel replaces only that item in the current preview.
5. Any stale inbox staging key for that item is cleared.

## Fresh Evidence

The refresh should preserve the original source folder title when possible, while updating video content fields used by classification:

- title
- author
- description
- tags
- category
- current target membership

## Acceptance Criteria

1. Clicking "再次判断" calls the new refresh callback instead of only reusing the stale local item.
2. If the refreshed item matches a real target, it moves out of the unmatched pending section into that target group.
3. The refreshed target is not auto-selected for execution.
4. If the refreshed item still has no useful target, it remains pending.
5. The existing "存入暂存" action remains the only pending-section action that explicitly stages an inbox target.
6. No Bilibili favorite append API is called by "再次判断".
