# DeepSeek Feature Toggles Design

## Goal

Add separate DeepSeek feature switches for review comment generation and pet chat while keeping the existing DeepSeek connection settings and note summary switch unchanged.

## Scope

- Add `deepseekCommentEnabled` to control DeepSeek-generated fun review comments.
- Add `deepseekPetChatEnabled` to control DeepSeek-backed pet chat from the speech bubble and right-click pet menu.
- Keep `deepseekEnabled` as the provider-level master switch.
- Keep `deepseekAutoSummaryEnabled` independent for transcription summary generation.

## Behavior

- Existing users with `deepseekEnabled: true` inherit both new feature switches as enabled unless a saved value exists.
- New users keep both feature switches off by default.
- If comment generation is disabled, the review comment action uses local 小咪 comment candidates and does not call DeepSeek.
- If pet chat is disabled, opening chat shows a compact settings hint and does not call DeepSeek.
- Turning off the master DeepSeek switch disables all DeepSeek-backed feature access at runtime without clearing the per-feature switch choices.

## UI

- In the DeepSeek settings group, show the new comment switch above the existing automatic summary switch.
- Show the new pet chat switch below the automatic summary switch.
- Save both new switches through the existing preference persistence path.

## Testing

- Preference defaults and persisted values cover the new fields.
- Settings UI tests cover rendering and saving the two new switches.
- Review flow tests cover local fallback when only comment generation is disabled.
- Pet tests cover disabled pet chat despite the master DeepSeek switch and API key being configured.
