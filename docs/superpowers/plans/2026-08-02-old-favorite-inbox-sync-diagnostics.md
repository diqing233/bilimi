# Old Favorite Inbox And Sync Diagnostics Plan

## Goal

Keep the whole-run confirmation truthful and compact without changing archive or DeepSeek behavior.

## Changes

1. Count every completed, selected, organizable video even when no classification journal record exists.
2. Present unmatched videos as `bilimi·暂存`, with an explicit local-only/no-Bilibili-sync explanation.
3. Detect the development-only renderer/main-process version mismatch and tell the user to restart without implying the draft was lost.
4. Preserve the existing divider-row layout and remote plan exclusion of the inbox ledger.

## Verification

1. Add focused coordinator, confirmation UI, and hook regression tests before implementation.
2. Run the focused suites and the broader old-favorite renderer/main-process suites.
3. Restart `node_modules\.bin\electron-vite.cmd dev` completely.
4. Verify the real Electron overview and confirmation UI, stopping before any command that writes to Bilibili.
