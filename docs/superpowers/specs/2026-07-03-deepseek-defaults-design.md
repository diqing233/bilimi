# DeepSeek Defaults Design

## Goal

Make the fresh-install pet hover shortcuts match the intended order, and make the DeepSeek master switch enable the three DeepSeek feature toggles once when users turn it on.

## Behavior

- Fresh installs default the pet hover shortcuts to `like`, `coin`, `comment`, and `transcribe`, matching the visible order `赞 / 赐 / 表 / 转`.
- The pet hover shortcut selector still allows at most four selected shortcuts, and users can add or remove shortcuts individually.
- Turning the DeepSeek master switch from off to on also enables:
  - `deepseekCommentEnabled`
  - `deepseekAutoSummaryEnabled`
  - `deepseekPetChatEnabled`
- After the master switch has been turned on, users can independently disable any of the three child toggles. Those child choices are preserved and are not overwritten unless the master switch is turned off and later turned on again.
- Legacy persisted preferences with `deepseekEnabled: true` and missing child toggle values inherit enabled child toggles, including automatic summary.

## Implementation Notes

- `src/shared/petHoverShortcuts.ts` owns the default hover shortcut order.
- `src/renderer/src/features/state/assistantState.ts` owns preference normalization for fresh and persisted state.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx` owns the settings UI event handler for the DeepSeek master switch.

## Tests

- Update shared shortcut normalization tests to expect `['like', 'coin', 'comment', 'transcribe']`.
- Update assistant state tests to cover automatic summary legacy inheritance.
- Add a settings UI test showing that enabling DeepSeek checks all three child toggles.
- Add or keep coverage showing child toggles can be changed independently after enabling DeepSeek.
