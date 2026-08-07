# Old Favorite Last-Write And Save Controls Plan

## Goal

Restore the agreed old-favorite workflow: the latest classification action wins, local saves are repeatable projections, finishing a round is explicit, and current-batch data never uses whole-run totals.

## Scope

- Main-process classification and workspace recovery behavior.
- DeepSeek completion projection.
- Current-batch and whole-run confirmation navigation.
- Repeatable batch/round local save controls and explicit local-only finish.
- Per-batch unmatched counts and blue informational copy.

## Steps

1. Add regression tests for last-write-wins classification and recommendation adoption across unloaded segments.
2. Add regression tests for completed DeepSeek checkpoints no longer blocking actions.
3. Add renderer tests for separate current-batch/whole-run views, repeatable save controls, explicit finish, and per-batch unmatched copy.
4. Implement the smallest coordinator and renderer changes required by those tests.
5. Run focused automated checks and Git whitespace/status checks. Manual Electron acceptance is left to the user.
