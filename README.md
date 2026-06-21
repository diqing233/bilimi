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

The workspace tabs use Xiao Mi pet icons and keep each tab label horizontal. In sidebar mode the four tabs divide the available tab row evenly.

Collapsing the sidebar removes the sidebar column instead of leaving a vertical rail. A small floating boundary button labeled `折叠` or `展开` stays on the browser/sidebar edge, keeps its left-boundary position, and is sized to fit inside the blue browser tab strip.

When the floating desktop pet restores or focuses the main window, the sidebar also expands if it was collapsed.

## Assistant Actions

`批阅` actions run in the active Bilibili webview. Likes, coins, favorites, and comments first use page automation through the embedded page context. Favorite actions then have two modes:

- Default mode may use the Bilibili favorite API as a confirmation or fallback layer. API usage is visible in automation steps such as `api:favorite:list`, `api:favorite:add`, or `api:favorite:create-folder`.
- `仅页面点击` disables the favorite API path. If page automation succeeds, Bilimi returns that result directly. If page automation fails because a favorite target is missing, Bilimi opens the favorite dialog with the Bilibili `e` shortcut and finishes through visual text recognition plus webview input events.

In `仅页面点击` mode, logs that only contain steps such as `favorite:open`, `favorite:folder`, `favorite`, and `visual:favorite:*` did not use the favorite API.

## DeepSeek Assistant Features

Assistant settings include a DeepSeek group for the AI-backed features used by review comments, one-image note summaries, and Xiao Mi pet chat. The API key is saved through the Electron main process and is not exposed to renderer state; normal preferences only store whether a key is present, whether DeepSeek is enabled, the model, and the base URL.

The DeepSeek settings surface uses Chinese labels and provides `保存 DeepSeek`, `测试 DeepSeek`, and `重置 DeepSeek` actions in one row. Test feedback is localized to Chinese, and reset clears the key draft, disables DeepSeek, and restores the default model `deepseek-v4-flash` plus base URL `https://api.deepseek.com`.

The settings also include a relay recommendation for [云枢智元](https://yunshulink.com/). It lists `deepseek-v4-pro` and `https://api.yunshulink.com/v1`, each with a small copy icon button.

## Desktop Pet

Bilimi includes a small transparent Electron desktop pet window rendered by `PalaceMaidPetApp` and `LayeredPetRenderer`. The pet is a lightweight 2D blue-white porcelain chibi maid with transparent PNG character states plus small effect layers.

The assistant persona is Xiao Mi: `我是 bilimi，主人可以叫我小mi~`. The app icon, floating seal, sidebar collapse button, workspace tabs, and review actions reuse the blue-white maid pet assets for a consistent identity.

Assistant settings expose two pet styles: `big-head` for the compact big-head Q-version sprites and `classic` for the clearer full-body reset sprites. Pet style is persisted with the other assistant preferences and broadcast after saving so the main window, floating assistant, and desktop pet stay in sync without restarting.

The pet supports `idle`, `hint`, `working`, and `error` status feedback, can be dragged, and restores or focuses the main Bilimi window when clicked. Dragging suppresses the follow-up click reaction. Right-clicking the pet shows compact pill quick actions for `对话宠物` and `关闭宠物`; the quick actions disappear when the pet window loses focus. `对话宠物` opens the top prompt bubble chat, and `关闭宠物` closes the pet window. Assistant settings also expose `唤醒宠物` and `关闭宠物` buttons for explicit pet window control.

The top prompt bubble can expand into a short Xiao Mi chat form. Messages are kept in memory only for the active pet session and are sent through the same main-process DeepSeek bridge as review comments and note posters. If DeepSeek is not enabled or no key is stored, Xiao Mi shows `主人，想要跟小mi交流的话去设置开启DeepSeek支持吧` instead of sending a request.

The pet is intentionally companion-only: it does not add platform trays, teapots, cups, or other props.

## Video Notes

The assistant can create notes from:

- Current-video audio transcription with local `faster-whisper`.
- Manually pasted transcript text.

Video note generation reads the current Bilibili video metadata for title, BV ID, URL, and archive context, then downloads the current video audio and transcribes it locally. Manually pasted transcript text remains available as a fallback and does not download audio.

When local audio transcription is available, the note page exposes `转写音频` and `档案库` as the primary actions. Without an existing note, the page still uses the flat A layout: current video details, generation/archive actions, disabled result entries, and a pasted-transcript fallback. Generated notes include a study-oriented overview with a one-sentence takeaway, key points, a revisit prompt, open questions, keywords, timeline items, and highlights. Timeline items and transcript segments expose `加批注`, which starts a timestamped annotation draft for that moment.

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
