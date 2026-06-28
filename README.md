# Bilimi

Bilimi is an Electron + React desktop app for browsing Bilibili with a local assistant sidebar. It helps classify videos into local ledgers, automate lightweight Bilibili actions, and create timestamped video notes.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Assistant Sidebar

The main Bilimi window keeps native window controls but hides the default Electron application menu bar. It uses a two-column layout: the embedded Bilibili browser on the left and the Bilimi assistant sidebar on the right. The sidebar opens on `批阅` by default, with `札记`, `掌库`, and `设置` available as tabs inside the same workspace.

The default main window width is sized for the embedded browser plus assistant sidebar: the initial window keeps at least 1360px of browser space beside the roughly 430px sidebar.

The workspace tabs use 小咪 pet icons and keep each tab label horizontal. In sidebar mode the four tabs divide the available tab row evenly.

Collapsing the sidebar removes the sidebar column instead of leaving a vertical rail. A small floating boundary button labeled `折叠` or `展开` stays on the browser/sidebar edge, keeps its left-boundary position, and is sized to fit inside the blue browser tab strip.

Each browser tab keeps its own URL and page title. The assistant snapshot always follows the active tab, so switching videos refreshes the right-side `批阅` and `札记` context without allowing background tabs to overwrite the current workspace. Snapshot refresh signals are broadcast to both the in-window sidebar and the floating assistant window.

The embedded Bilibili page captures Bilibili HTTPS links into Bilimi's internal browser tabs. Direct anchors and explicit video card shells may open a new in-app tab, but broad feed containers and native interactive controls such as buttons, inputs, and menu items remain owned by the Bilibili page so refresh controls do not become accidental tab-open triggers.

When the floating desktop pet restores or focuses the main window, the sidebar also expands if it was collapsed.

## Floating Surfaces

Bilimi starts a transparent 小咪 desktop pet window beside the main app. The transparent host window stays at the fixed 336x380 stage size; resize controls adjust the character inside that stage rather than resizing the Electron window shell. Clicking the pet restores or focuses the main window, right-clicking it opens quick actions for `对话宠物` and `关闭宠物`, and hover controls can resize the pet character or reveal up to four user-selected round shortcut buttons in a left-side fan. Holding the left mouse button by itself does not resize or animate the pet; dragging only starts after pointer movement crosses the drag threshold, and a long stationary press suppresses the follow-up click restore. The pet window can also be woken or closed from assistant settings.

The floating entry uses the same assistant workspace as the sidebar. It can run review actions, open video notes, manage favorite ledgers, and request the active main-window webview through the Electron bridge.

## Favorite Ledgers

The `掌库` tab manages Bilimi-prefixed Bilibili favorite folders. Recommended category folders are defined in `src/shared/favoriteLedgers.ts` and use eight broad stable IDs: `knowledge`, `game`, `movie-tv`, `creative-aesthetic`, `life-interest`, `music`, `entertainment`, and `inbox`.

The stable `inbox` ledger is named `Bilimi·暂存`. It is a real Bilibili favorite folder used as a safe landing place for new favorites that cannot be classified confidently.

Old-favorite organization shows unresolved videos in a top `待分类` section inside the current `归档预览`. Pending items are scoped to that scan round: users can open the video for manual sorting, explicitly add it to `Bilimi·暂存`, or run another judgment pass; anything still pending is discarded when the round ends.

In the recommended category grid, clicking a category name only selects it for editing. The adjacent `+` or `✓` button directly adds or removes that folder from sync without a confirmation dialog. A dashed `+` shortcut appears after the recommended category folders and focuses the new custom-ledger form.

`整理旧藏` scans existing non-Bilimi favorite folders, shows a preview, and appends only checked items into Bilimi folders after `确认整理`. It does not move, delete, or unfavorite items from the user's original folders.

Bilimi archive planning is shared by old-favorite organization and new review actions. The eight recommended category folders are mutually exclusive: one video can enter at most one of those default folders. User-created Bilimi topic folders take priority when their keywords match. The settings panel provides a `Bilimi 收藏策略` option. It controls how many Bilimi favorite folders a pending video can be saved into at the same time; original Bilibili favorite folders are never moved, deleted, or counted toward this limit:

- `最多存入 1 个 Bilimi 收藏夹`: save to the strongest generated or custom Bilimi target only.
- `最多存入 2 个 Bilimi 收藏夹`: save to one default category plus one other matching Bilimi favorite folder.
- `最多存入 3 个 Bilimi 收藏夹`: save to one default category plus two other matching Bilimi favorite folders.

## Assistant Actions

`批阅` actions run in the active Bilibili webview. Likes, coins, favorites, and comments first use page automation through the embedded page context. Favorite actions then have two modes:

- Default mode may use the Bilibili favorite API as a confirmation or fallback layer. API usage is visible in automation steps such as `api:favorite:list`, `api:favorite:add`, or `api:favorite:create-folder`.
- `仅页面点击` disables the favorite API path. If page automation succeeds, Bilimi returns that result directly. If page automation fails because a favorite target is missing, Bilimi opens the favorite dialog with the Bilibili `e` shortcut and finishes through visual text recognition plus webview input events.

In `仅页面点击` mode, logs that only contain steps such as `favorite:open`, `favorite:folder`, `favorite`, and `visual:favorite:*` did not use the favorite API.

When API confirmation is enabled, favorite confirmation can append the current video to every planned Bilimi target in one safe `resource/deal` request with `del_media_ids` left empty. In page-click-only mode, Bilimi keeps the page/visual flow focused on the primary target.

For the `表` action, DeepSeek-enabled sessions generate three video-aware funny comments directly from the current video title, author, description, tags, and local classification. There is no required comment-direction prompt in the active flow. If DeepSeek is disabled or returns an unusable result, Bilimi falls back to three local 小咪 comments that still include the UP name and video title when available. Bilimi never publishes a comment until the user explicitly selects one candidate.

## DeepSeek Assistant Features

Assistant settings include a DeepSeek group for the AI-backed features used by review comments, video note summaries, and 小咪 pet chat. The API key is saved through the Electron main process and is not exposed to renderer state; normal preferences only store whether a key is present, whether DeepSeek is enabled, the model, and the base URL.

DeepSeek old-favorite assistance is limited to generating and improving topic-folder candidates. It can suggest names, keywords, and reasons, but final archive targets still come from local Bilimi archive planning rules.

The DeepSeek settings surface uses Chinese labels and provides `保存 DeepSeek`, `测试 DeepSeek`, and `重置 DeepSeek` actions in one row. Test feedback is localized to Chinese, and reset clears the key draft, disables DeepSeek, and restores the default model `deepseek-v4-flash` plus base URL `https://api.deepseek.com`.

The settings also include a relay recommendation for [云枢智元](https://yunshulink.com/). It lists `deepseek-v4-pro` and `https://api.yunshulink.com/v1`, each with a small copy icon button.

## Desktop Pet

Bilimi includes a small transparent Electron desktop pet window rendered by `PalaceMaidPetApp` and `LayeredPetRenderer`. The pet is a lightweight 2D blue-white porcelain chibi maid with transparent PNG character states plus small effect layers.

The assistant persona is 小咪: `我是 bilimi，主人可以叫我小咪~`. The app icon, floating seal, sidebar collapse button, workspace tabs, and review actions reuse the blue-white maid pet assets for a consistent identity.

Assistant settings expose two pet styles: `big-head` for the compact big-head Q-version sprites and `classic` for the clearer full-body reset sprites. Pet style and the pet hover shortcut list are persisted with the other assistant preferences and broadcast after saving so the main window, floating assistant, and desktop pet stay in sync without restarting. The default hover shortcuts are `赏`, `赐`, `表`, and `转`; settings let the user choose from `赏藏赐表转库备整`, cap the visible list at four buttons, allow clearing all shortcuts, and show selected shortcuts with their current order number instead of a checkbox tick.

The pet supports `idle`, `hint`, `working`, and `error` status feedback, can be dragged, and restores or focuses the main Bilimi window when clicked. Dragging suppresses the follow-up click reaction. Right-clicking the pet shows compact pill quick actions for `对话宠物` and `关闭宠物`; the quick actions disappear when the pet window loses focus. `对话宠物` opens the top prompt bubble chat, and `关闭宠物` closes the pet window. Assistant settings also expose `唤醒宠物` and `关闭宠物` buttons for explicit pet window control.

The top prompt bubble can expand into a short 小咪 chat form. Messages are kept in memory only for the active pet session and are sent through the same main-process DeepSeek bridge as review comments and note posters. If DeepSeek is not enabled or no key is stored, 小咪 shows `主人，想要跟小咪交流的话去设置开启DeepSeek支持吧` instead of sending a request.

The pet is intentionally companion-only: it does not add platform trays, teapots, cups, or other props.

## Video Notes

The assistant can create notes from:

- Current-video audio transcription with local `faster-whisper`.
- Manually pasted transcript text.

Video note generation reads the current Bilibili video metadata for title, BV ID, URL, and archive context, then downloads the current video audio and transcribes it locally. Manually pasted transcript text remains available as a fallback and does not download audio.

When local audio transcription is available, the note page exposes `转写音频` and `档案库` as the primary actions. Without an existing note, the page still uses the flat A layout: current video details, generation/archive actions, disabled result entries, and a pasted-transcript fallback. Generated notes include plain transcript, timed transcript, and `DeepSeek 总结` result tabs. The summary tab shows the local note summary by default and can ask DeepSeek for a richer structured Chinese summary when DeepSeek is enabled. A generated DeepSeek summary is cached for the current note `id` and `updatedAt`, so reopening the tab reuses the existing result instead of generating again.

Generated audio notes are also saved into the global video note archive. The archive stores one entry per video, merges by BV ID before falling back to URL, keeps every transcription as a version, and supports searching by title, author, BV ID, transcript, and summary. The archive panel provides dual-pane history browsing, version switching, copyable plain transcripts, copyable summaries, source opening, and deletion confirmation.

The archive detail pane is intentionally wider than the video list pane. Long titles, transcript text, and summaries should wrap inside the visible detail pane without introducing horizontal scrolling.

## Audio Transcription Prerequisites

- Install Python and `faster-whisper` before running local transcription:

```bash
python -m pip install faster-whisper
```

- Optional: set `BILIMI_PYTHON_PATH` when Bilimi should use a specific Python executable.
- Local transcription defaults to CPU with `int8` compute, so CUDA is not required.
- Provide bundled media tools before running transcription. The app needs `yt-dlp`, `ffmpeg`, and `ffprobe`. See [tools/README.md](tools/README.md).
  On Windows development checkouts, install them with:

```bash
npm run setup:media-tools
```

- Restart Bilimi after changing main-process code or installing local transcription prerequisites.
- The app uses the current Bilibili session only for the user-started transcription job and removes temporary job files after completion or failure.
