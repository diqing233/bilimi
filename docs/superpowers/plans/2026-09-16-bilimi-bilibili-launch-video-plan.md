# Bilimi Bilibili Launch Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a 35-42 second 16:9 Bilibili product-launch video for Bilimi 1.2.0, narrated by a cute personified Xiaomiao voice, captioned in Chinese, and rendered as a deterministic MP4 through HyperFrames.

**Architecture:** Keep Bilimi source code read-only. Build a separate HyperFrames project under `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch`. Freeze approved Bilimi character assets and recorded application footage into that project, then compose the launch story as an HTML timeline with `data-start`, `data-duration`, `data-track-index`, and seek-safe GSAP animation. Deliver only user-facing media and publishing copy under the HyperFrames `outputs` directory.

**Tech Stack:** HyperFrames CLI, HTML, CSS, GSAP seekable timelines, Electron-window recordings of Bilimi, FFmpeg, FFprobe, Edge TTS `zh-CN-XiaoxiaoNeural` for the first narration draft, and manual visual review using extracted PNG frames. Codex in-app browser is excluded from acceptance.

---

## Scope And File Map

### Bilimi repository files read-only during video production

- `C:\Users\diqing\bilimi\README.md`: feature truth and product limitation wording.
- `C:\Users\diqing\bilimi\docs\codex-browser-bypass.md`: required visual-acceptance workaround.
- `C:\Users\diqing\bilimi\electron\assets\bilimi-avatar.png`: brand/avatar asset.
- `C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\idle.png`: idle Xiaomiao.
- `C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\working.png`: working Xiaomiao.
- `C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\hint.png`: hint Xiaomiao.
- `C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\clicked.png`: completed-interaction Xiaomiao.

### HyperFrames project files to create

- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\BRIEF.md`: locked creative brief and product-language boundaries.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\SHOTLIST.md`: recording checklist and exact clip names.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\index.html`: 1920x1080 HyperFrames composition.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\styles.css`: composition tokens, scene layout, captions, and UI framing.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\timeline.js`: seek-safe GSAP scene animation and caption timing.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\captions\narration.srt`: human-readable subtitle export.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\captions\narration.json`: caption timing used by the HTML composition.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.txt`: frozen text input for voice generation.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.wav`: Xiaomiao narration.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\music.wav`: licensed or original background music.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\`: short licensed or original sound effects.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\bilimi\`: frozen Bilimi PNG assets.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\`: sanitized Bilimi window recordings.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\manifest.json`: SHA-256 hashes, source paths, and usage notes for all frozen assets.
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\RENDER_LOG.md`: commands, versions, review findings, and final render metadata.

### User-facing deliverables to create

- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.srt`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-cover.png`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-post.txt`

The source project and intermediate captures stay under `work`; only the four files above are publishing deliverables.

## Task 1: Bootstrap The HyperFrames Project

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\BRIEF.md`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\SHOTLIST.md`

- [ ] **Step 1: Verify the local toolchain**

Run from PowerShell:

```powershell
node --version
ffmpeg -version
ffprobe -version
```

Expected: Node.js major version `22` or newer, and both FFmpeg commands resolve successfully. If the bundled Bilimi FFmpeg is needed, use `C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe` and the matching `ffprobe.exe`.

- [ ] **Step 2: Create the composition scaffold**

Run:

```powershell
Set-Location C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work
npx hyperframes skills update
npx hyperframes init bilimi-bilibili-launch --non-interactive --example blank
```

Expected: `bilimi-bilibili-launch` contains a runnable `index.html` composition and the HyperFrames project metadata. Do not replace the scaffold with a framework build system; the composition remains plain HTML.

- [ ] **Step 3: Write the locked brief**

Create `BRIEF.md` with these exact decisions:

```markdown
# Bilimi Bilibili Launch Video

- Product: Bilimi 1.2.0 Windows desktop app
- Platform: Bilibili
- Duration: 42 seconds maximum
- Canvas: 1920x1080, 16:9, 30fps
- Audience: heavy Bilibili users with overloaded favorites and watch-later lists
- Voice: personified Xiaomiao, cute but clear, addressing the viewer as 主人
- Core line: 主人负责发现好内容，小咪负责帮主人记住它。
- Slogan: Bilimi，陪主人逛 B 站，也帮主人把好内容留下来。
- Product claims: video browsing, transcript generation, timeline transcript, key-point summary, classification suggestions, favorite organization, searchable library
- Claims to avoid: fully automatic decisions, guaranteed accuracy, official Bilibili identity, no-login/no-configuration promises
- Visual rule: real Bilimi window footage carries product proof; Xiaomiao artwork carries character memory
- Privacy rule: use sanitized demonstration data only; no real UID, nickname, favorites, cookies, API keys, logs, or local paths
```

- [ ] **Step 4: Write the exact recording checklist**

Create `SHOTLIST.md` with these clip names and durations:

```markdown
# Bilimi Capture Shot List

1. 01-main-browser.mp4, 6s: Bilimi main window with a demonstration Bilibili video open.
2. 02-assistant-context.mp4, 6s: right assistant visible with the current video context.
3. 03-notes-processing.mp4, 6s: 札记 page showing audio transcription progress and working state.
4. 04-notes-result.mp4, 7s: plain transcript, timeline transcript, and summary result.
5. 05-library.mp4, 7s: 掌库 or 收藏库 three-column view with search/filter/detail.
6. 06-pet-states.mp4, 5s: Xiaomiao idle, working, hint, and completed states.

Recording rules:
- Record the Electron application window, not Codex in-app browser.
- Use a demonstration Bilibili account and synthetic or openly licensed content.
- Capture at 1920x1080, 30fps, with three seconds of clean handle before and after each action.
- Do not perform remote deletion or destructive batch operations for the recording.
- Keep the cursor visible only when it explains the next action.
```

## Task 2: Freeze Approved Bilimi Assets

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\bilimi\`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\manifest.json`

- [ ] **Step 1: Copy only the approved character and avatar files**

Run:

```powershell
$project = 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch'
New-Item -ItemType Directory -Force "$project\assets\bilimi" | Out-Null
Copy-Item -LiteralPath 'C:\Users\diqing\bilimi\electron\assets\bilimi-avatar.png' -Destination "$project\assets\bilimi\bilimi-avatar.png"
Copy-Item -LiteralPath 'C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\idle.png' -Destination "$project\assets\bilimi\xiaomiao-idle.png"
Copy-Item -LiteralPath 'C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\working.png' -Destination "$project\assets\bilimi\xiaomiao-working.png"
Copy-Item -LiteralPath 'C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\hint.png' -Destination "$project\assets\bilimi\xiaomiao-hint.png"
Copy-Item -LiteralPath 'C:\Users\diqing\bilimi\src\renderer\src\assets\pet\blue-white-maid\character\classic\clicked.png' -Destination "$project\assets\bilimi\xiaomiao-clicked.png"
```

- [ ] **Step 2: Generate provenance and hashes**

Run this PowerShell block after the five copies succeed. It creates every manifest entry with a non-empty SHA-256 value, so the manifest cannot be committed in a partially filled state:

```powershell
$manifestEntries = @(
  @{ file = 'assets/bilimi/bilimi-avatar.png'; source = 'C:/Users/diqing/bilimi/electron/assets/bilimi-avatar.png'; role = 'brand-avatar' },
  @{ file = 'assets/bilimi/xiaomiao-idle.png'; source = 'C:/Users/diqing/bilimi/src/renderer/src/assets/pet/blue-white-maid/character/classic/idle.png'; role = 'idle-character' },
  @{ file = 'assets/bilimi/xiaomiao-working.png'; source = 'C:/Users/diqing/bilimi/src/renderer/src/assets/pet/blue-white-maid/character/classic/working.png'; role = 'working-character' },
  @{ file = 'assets/bilimi/xiaomiao-hint.png'; source = 'C:/Users/diqing/bilimi/src/renderer/src/assets/pet/blue-white-maid/character/classic/hint.png'; role = 'hint-character' },
  @{ file = 'assets/bilimi/xiaomiao-clicked.png'; source = 'C:/Users/diqing/bilimi/src/renderer/src/assets/pet/blue-white-maid/character/classic/clicked.png'; role = 'clicked-character' }
) | ForEach-Object {
  $absoluteFile = Join-Path $project $_.file
  $hash = (Get-FileHash -LiteralPath $absoluteFile -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{
    file = $_.file
    source = $_.source
    role = $_.role
    sha256 = $hash
  }
}
[ordered]@{
  assets = @($manifestEntries)
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $project 'assets\manifest.json')
```

Verify that the generated file has five assets and that every `sha256` value matches the 64-character hexadecimal pattern:

```powershell
$manifest = Get-Content -Raw (Join-Path $project 'assets\manifest.json') | ConvertFrom-Json
if ($manifest.assets.Count -ne 5) { throw 'Expected five frozen Bilimi assets.' }
if (@($manifest.assets | Where-Object {$_.sha256 -notmatch '^[0-9a-f]{64}$'}).Count -ne 0) { throw 'Every asset needs a SHA-256 hash.' }
```

## Task 3: Capture Sanitized Bilimi Product Footage

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\01-main-browser.mp4`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\02-assistant-context.mp4`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\03-notes-processing.mp4`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\04-notes-result.mp4`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\05-library.mp4`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\06-pet-states.mp4`
- Modify: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\manifest.json`

- [ ] **Step 1: Prepare the demonstration state**

Run the current Bilimi version in its own Electron window:

```powershell
Set-Location C:\Users\diqing\bilimi
npm run dev
```

Use a demonstration account or synthetic local data. Open one clearly readable demonstration video, prepare a few non-sensitive favorite categories such as `教程`, `音乐`, `灵感`, and `待整理`, and ensure no real account identifiers or private content are visible.

- [ ] **Step 2: Record the main browser and assistant clips**

Use an existing external window recorder such as OBS with Window Capture. Set the capture canvas and output to 1920x1080 at 30fps. Record the six clips in `SHOTLIST.md`, leaving clean handles around each action.

When OBS is not available, use the bundled FFmpeg window capture from PowerShell:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
& $ffmpeg -y -f gdigrab -framerate 30 -draw_mouse 1 -i title=bilimi -t 6 -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\01-main-browser.mp4'
```

Repeat the command for each named clip while performing only the corresponding safe demonstration action in the Electron window. If the application window title differs, use the exact visible title returned by Windows before recording.

- [ ] **Step 3: Inspect every capture for privacy and readability**

Extract one frame per second:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
Get-ChildItem 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\*.mp4' | ForEach-Object {
  $frames = Join-Path $_.DirectoryName $_.BaseName
  New-Item -ItemType Directory -Force $frames | Out-Null
  & $ffmpeg -y -i $_.FullName -vf fps=1 (Join-Path $frames 'frame-%02d.png')
}
```

Review the extracted PNGs manually. Reject and re-record any clip showing a real UID, nickname, private title, cookie, token, API key, filesystem path, debug log, or unreadable UI text.

- [ ] **Step 4: Add capture metadata to the asset manifest**

For each MP4, record its relative path, source (`Bilimi Electron window`), duration, dimensions, frame rate, and SHA-256 hash. Verify the media metadata with:

```powershell
$ffprobe = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffprobe.exe'
& $ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of json 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\captures\01-main-browser.mp4'
```

## Task 4: Generate Xiaomiao Narration And Captions

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.txt`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.wav`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\captions\narration.srt`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\captions\narration.json`

- [ ] **Step 1: Freeze the narration script**

Create `audio\narration.txt` with this exact first-draft narration, preserving the address “主人”:

```text
主人，你是不是也收藏了好多视频，却一个都找不到啦？
别着急，小咪来帮主人整理一下。
打开 Bilimi，主人可以一边逛 B 站，一边把喜欢的内容留下来。
看不完的视频，小咪先帮主人转成文稿。
再把重点整理出来，回头查起来也方便。
收藏太乱了？小咪按主题给主人理一理。
以后想找好内容，就不用再考古啦。
Bilimi，陪主人逛 B 站，也帮主人把好内容留下来。
```

- [ ] **Step 2: Generate the first voice draft**

Use `zh-CN-XiaoxiaoNeural` with a clear, warm delivery:

```powershell
$project = 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch'
py -m pip install --user edge-tts
edge-tts --voice zh-CN-XiaoxiaoNeural --rate=+4% --pitch=+2Hz --text-file (Join-Path $project 'audio\narration.txt') --write-media (Join-Path $project 'audio\narration.mp3') --write-subtitles (Join-Path $project 'captions\narration.srt')
```

Convert to a deterministic WAV used by the composition:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
& $ffmpeg -y -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.mp3' -ar 48000 -ac 2 -c:a pcm_s16le 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\narration.wav'
```

The first voice draft must be reviewed for pronunciation of `Bilimi`, `B 站`, `札记`, `掌库`, and `主人`. Regenerate with punctuation or small pauses adjusted if any product name is unclear.

- [ ] **Step 3: Normalize captions into composition JSON**

Create `captions\narration.json` as an array of objects with the fields `start`, `end`, and `text`, using seconds from the generated SRT. Split captions at natural phrases so each caption is no longer than 18 Chinese characters per line and no more than two lines. Keep these scene anchors:

```json
[
  {"start": 0.0, "end": 4.0, "text": "主人，你是不是也收藏了好多视频，却一个都找不到啦？"},
  {"start": 4.0, "end": 8.0, "text": "别着急，小咪来帮主人整理一下。"},
  {"start": 8.0, "end": 14.0, "text": "一边逛 B 站，一边留下好内容"},
  {"start": 14.0, "end": 20.0, "text": "看不完的视频，小咪先帮主人转成文稿。"},
  {"start": 20.0, "end": 26.0, "text": "时间线文稿｜重点总结"},
  {"start": 26.0, "end": 33.0, "text": "分类建议｜收藏整理"},
  {"start": 33.0, "end": 37.0, "text": "想找的时候，真的找得到"},
  {"start": 37.0, "end": 42.0, "text": "Bilimi，陪主人逛 B 站，也帮主人把好内容留下来。"}
]
```

Adjust the exact `end` values to the reviewed SRT while keeping scene boundaries unchanged. The JSON is the source of truth for in-video captions; the SRT is the upload/download subtitle artifact.

## Task 5: Add Licensed Audio Bed And Sound Effects

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\music.wav`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\collect-stack.wav`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\pet-pop.wav`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\complete.wav`
- Modify: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\manifest.json`

- [ ] **Step 1: Select the audio source**

Use an original or clearly licensed light electronic music bed with no recognizable copyrighted melody. The bed must be at least 42 seconds long or loopable without an audible seam. Use original or clearly licensed short UI sound effects for the opening stack, Xiaomiao reveal, and completion moment.

- [ ] **Step 2: Normalize all audio to 48 kHz stereo WAV**

Place the approved original or licensed source files at these exact work paths before conversion:

- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\music-source.mp3`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\collect-stack-source.wav`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\pet-pop-source.wav`
- `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\complete-source.wav`

Convert them with these exact commands:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
& $ffmpeg -y -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\music-source.mp3' -ar 48000 -ac 2 -c:a pcm_s16le 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\music.wav'
& $ffmpeg -y -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\collect-stack-source.wav' -ar 48000 -ac 2 -c:a pcm_s16le 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\collect-stack.wav'
& $ffmpeg -y -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\pet-pop-source.wav' -ar 48000 -ac 2 -c:a pcm_s16le 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\pet-pop.wav'
& $ffmpeg -y -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\source\complete-source.wav' -ar 48000 -ac 2 -c:a pcm_s16le 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\audio\sfx\complete.wav'
```

- [ ] **Step 3: Record license provenance**

Add each audio file to `assets\manifest.json` with `source`, `license`, `attribution`, `duration`, and `sha256`. Do not proceed to publication if a music or effect source has no recorded license or original-creation note.

## Task 6: Implement The HyperFrames Composition

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\index.html`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\styles.css`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\timeline.js`
- Modify: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\BRIEF.md`

- [ ] **Step 1: Build the composition root and scene timing**

Use this structure in `index.html`, with the generated local media paths filled in:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bilimi Bilibili Launch</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main id="stage" data-composition-id="bilimi-bilibili-launch" data-start="0" data-duration="42" data-width="1920" data-height="1080">
      <section class="clip scene scene--chaos" data-start="0" data-duration="4" data-track-index="0">
        <div class="chaos-stack" aria-hidden="true"></div>
        <div class="caption caption--bottom" data-caption="0"></div>
      </section>
      <section class="clip scene scene--reveal" data-start="4" data-duration="4" data-track-index="1">
        <img class="xiaomiao xiaomiao--hint" src="./assets/bilimi/xiaomiao-hint.png" alt="" />
        <img class="brand-avatar" src="./assets/bilimi/bilimi-avatar.png" alt="" />
        <div class="caption caption--bottom" data-caption="1"></div>
      </section>
      <section class="clip scene scene--browse" data-start="8" data-duration="6" data-track-index="2">
        <video class="product-capture" src="./assets/captures/01-main-browser.mp4" muted playsinline></video>
        <div class="caption caption--bottom" data-caption="2"></div>
      </section>
      <section class="clip scene scene--transcribe" data-start="14" data-duration="6" data-track-index="3">
        <video class="product-capture" src="./assets/captures/03-notes-processing.mp4" muted playsinline></video>
        <img class="xiaomiao xiaomiao--working" src="./assets/bilimi/xiaomiao-working.png" alt="" />
        <div class="caption caption--bottom" data-caption="3"></div>
      </section>
      <section class="clip scene scene--summary" data-start="20" data-duration="6" data-track-index="4">
        <video class="product-capture" src="./assets/captures/04-notes-result.mp4" muted playsinline></video>
        <div class="feature-label">时间线文稿 · 重点总结</div>
        <div class="caption caption--bottom" data-caption="4"></div>
      </section>
      <section class="clip scene scene--organize" data-start="26" data-duration="7" data-track-index="5">
        <video class="product-capture" src="./assets/captures/05-library.mp4" muted playsinline></video>
        <img class="xiaomiao xiaomiao--hint" src="./assets/bilimi/xiaomiao-hint.png" alt="" />
        <div class="caption caption--bottom" data-caption="5"></div>
      </section>
      <section class="clip scene scene--find" data-start="33" data-duration="4" data-track-index="6">
        <video class="product-capture" src="./assets/captures/05-library.mp4" muted playsinline></video>
        <div class="search-callout">想找的时候，真的找得到</div>
        <div class="caption caption--bottom" data-caption="6"></div>
      </section>
      <section class="clip scene scene--cta" data-start="37" data-duration="5" data-track-index="7">
        <img class="xiaomiao xiaomiao--clicked" src="./assets/bilimi/xiaomiao-clicked.png" alt="" />
        <img class="brand-avatar" src="./assets/bilimi/bilimi-avatar.png" alt="" />
        <h1>Bilimi</h1>
        <p>陪主人逛 B 站，也帮主人把好内容留下来</p>
        <div class="caption caption--bottom" data-caption="7"></div>
      </section>

      <audio data-start="0" data-duration="42" data-track-index="20" data-volume="1" src="./audio/narration.wav"></audio>
      <audio data-start="0" data-duration="42" data-track-index="21" data-volume="0.18" src="./audio/music.wav"></audio>
      <audio data-start="0" data-duration="4" data-track-index="22" data-volume="0.35" src="./audio/sfx/collect-stack.wav"></audio>
      <audio data-start="4" data-duration="1" data-track-index="23" data-volume="0.4" src="./audio/sfx/pet-pop.wav"></audio>
      <audio data-start="37" data-duration="1" data-track-index="24" data-volume="0.4" src="./audio/sfx/complete.wav"></audio>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
    <script type="module" src="./timeline.js"></script>
  </body>
</html>
```

Use the exact scene boundaries from the approved design. If a source capture is reused for adjacent scenes, the animation and crop must make the two scenes visibly distinct.

- [ ] **Step 2: Implement stable visual tokens and caption layout**

In `styles.css`, define a fixed 1920x1080 stage, a blue-white Bilimi palette, a readable sans-serif Chinese font stack, and a caption rail with safe margins. Captions must remain inside the stage and never cover the product title, progress bar, or Xiaomiao face. Use `box-sizing: border-box` globally and avoid viewport-scaled font sizes.

The caption rail must use a stable two-line box:

```css
.caption--bottom {
  position: absolute;
  left: 120px;
  right: 120px;
  bottom: 72px;
  min-height: 92px;
  display: grid;
  place-items: center;
  padding: 18px 30px;
  color: #ffffff;
  background: rgba(13, 28, 68, 0.84);
  border: 2px solid rgba(255, 255, 255, 0.72);
  font-size: 42px;
  line-height: 1.22;
  text-align: center;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
}
```

Do not use a permanent opaque card around the whole video. The caption rail is the only repeated framed element.

- [ ] **Step 3: Implement seek-safe scene animation**

In `timeline.js`, create one paused GSAP timeline for the composition and expose it through `window.__timelines.bilimiBilibiliLaunch`. Use only timeline-controlled transforms, opacity, clip-path, and caption swaps; do not use `setInterval`, `Date.now()`, unbounded CSS animations, or wall-clock state.

The structure must include these timed beats:

```js
const timeline = gsap.timeline({ paused: true })

timeline
  .from('.scene--chaos .chaos-stack', { opacity: 0, scale: 0.92, duration: 0.6, ease: 'power4.out' }, 0)
  .from('.scene--reveal .xiaomiao', { opacity: 0, y: 80, scale: 0.86, duration: 0.55, ease: 'back.out(1.6)' }, 4)
  .from('.scene--browse .product-capture', { opacity: 0, x: 64, duration: 0.55, ease: 'power2.out' }, 8)
  .from('.scene--transcribe .product-capture', { opacity: 0, scale: 1.04, duration: 0.5, ease: 'expo.out' }, 14)
  .from('.scene--organize .product-capture', { opacity: 0, x: -64, duration: 0.55, ease: 'sine.inOut' }, 26)
  .from('.scene--cta .xiaomiao', { opacity: 0, y: 70, duration: 0.6, ease: 'back.out(1.4)' }, 37)

window.__timelines = window.__timelines || {}
window.__timelines.bilimiBilibiliLaunch = timeline
```

Expand this exact timeline with per-caption opacity and per-scene emphasis. Use hard cuts between most scenes; reserve at most two soft transitions for the Xiaomiao reveal at `4s` and the final CTA at `37s`.

- [ ] **Step 4: Wire caption JSON into the composition**

Load `captions/narration.json` from `timeline.js`, populate `[data-caption]` elements, and animate only the matching caption element in each scene. The timeline must still render correctly if a caption is one line or two lines; the reserved caption box keeps layout stable.

- [ ] **Step 5: Update the brief with the implemented scene map**

Append the final scene table, the exact audio files used, and any changed narration timing to `BRIEF.md`. Do not change the core product claims without updating the approved design document first.

## Task 7: Lint, Check, Preview, And Render

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\RENDER_LOG.md`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4`

- [ ] **Step 1: Run static and browser validation**

Run from the HyperFrames project:

```powershell
Set-Location C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch
npx hyperframes lint .
npx hyperframes check .
```

Expected: both commands pass without malformed timing attributes, missing local assets, runtime exceptions, overflow, inaccessible contrast, or invalid timeline registration.

- [ ] **Step 2: Preview in an external browser or local preview surface**

Run:

```powershell
npx hyperframes preview
```

Use the generated local preview URL in an external browser or the HyperFrames preview surface, never Codex in-app browser. Check all eight scene boundaries and the final hold. Stop the preview process after review.

- [ ] **Step 3: Render at 30fps**

Run:

```powershell
npx hyperframes render . -o C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4 --fps 30 --workers 1
```

Expected: an MP4 with a 1920x1080 video stream, approximately 42 seconds, one clear narration track, one music bed, and no unintended silent gaps.

- [ ] **Step 4: Verify output metadata and audio presence**

Run:

```powershell
$ffprobe = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffprobe.exe'
& $ffprobe -v error -show_entries format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate -of json 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4'
```

Expected:

- Video width `1920`
- Video height `1080`
- Video frame rate `30/1`
- Duration between `40` and `42` seconds
- At least one audio stream

- [ ] **Step 5: Extract review frames**

Run:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
$review = 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\review-frames'
New-Item -ItemType Directory -Force $review | Out-Null
0,4,8,14,20,26,33,37,41 | ForEach-Object {
  & $ffmpeg -y -ss $_ -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4' -frames:v 1 -q:v 2 (Join-Path $review ("frame-{0:D2}.png" -f $_))
}
```

Review these PNGs manually for:

- A readable pain-point hook in the first frame
- Xiaomiao visible by `4s`
- Bilimi window visible by `8s`
- Transcription and result views legible at `14s` and `20s`
- Collection organization legible at `26s` and `33s`
- A clean brand hold from `37s`
- No subtitle overlap with product controls or Xiaomiao

- [ ] **Step 6: Record validation evidence**

Create `RENDER_LOG.md` with:

```markdown
# Render Log

- Date:
- HyperFrames CLI version:
- Node version:
- FFmpeg version:
- Command:
- Lint: PASS/FAIL
- Check: PASS/FAIL
- Preview review: PASS/FAIL
- Render metadata:
- Privacy review: PASS/FAIL
- Visual review method: external browser/local preview, extracted PNG frames, and manual inspection; Codex in-app browser bypassed
- Findings:
- Output:
```

Fill every field before calling the render complete.

## Task 8: Package Bilibili Publishing Assets

**Files:**
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.srt`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-cover.png`
- Create: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-post.txt`

- [ ] **Step 1: Copy the reviewed SRT**

Copy the reviewed `captions\narration.srt` to `outputs\bilimi-bilibili-launch-v1.srt`. Confirm it contains valid sequential SRT blocks, no overlapping intervals, and the final subtitle ends before the final audio fades.

- [ ] **Step 2: Create the cover image**

Extract a clean frame from the opening pain-point scene and add only the title treatment:

```powershell
$ffmpeg = 'C:\Users\diqing\bilimi\dist\win-unpacked\resources\tools\win32\ffmpeg.exe'
& $ffmpeg -y -ss 1.2 -i 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-v1.mp4' -frames:v 1 -q:v 2 'C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-cover.png'
```

The cover text is `收藏了，然后呢？`; keep the text away from the center if it would cover the synthetic collection cards. Do not use a real Bilibili video thumbnail or real account data.

- [ ] **Step 3: Write the publishing copy**

Create `outputs\bilimi-bilibili-launch-post.txt` with:

```text
标题：
我的 B 站收藏夹，终于有人管了

简介：
你负责发现好内容，小咪负责帮你记住它。

Bilimi 是一个 Windows 桌面小助手：陪你逛 B 站，帮你把视频转成文稿、提炼重点、整理收藏。

bilimi 不是 Bilibili 官方客户端。登录、播放、点赞、投币、收藏等账号行为仍由 B 站页面和接口完成。

标签：
#B站 #桌面软件 #效率工具 #视频总结 #收藏整理 #Bilimi #小助手
```

- [ ] **Step 4: Verify the delivery directory**

Run:

```powershell
Get-ChildItem C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\outputs\bilimi-bilibili-launch-*
```

Expected: exactly one MP4, one SRT, one PNG cover, and one TXT publishing copy for this version. Intermediate captures and source files must remain under `work`.

## Task 9: Final Review And Handoff

**Files:**
- Modify: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\RENDER_LOG.md`
- Modify: `C:\Users\diqing\Documents\Codex\2026-07-09\hyperframes\work\bilimi-bilibili-launch\assets\manifest.json`

- [ ] **Step 1: Check claims against Bilimi 1.2.0**

Compare every spoken and on-screen claim with `C:\Users\diqing\bilimi\README.md`. Replace any wording that implies DeepSeek is mandatory, classification is unconditionally automatic, or Bilimi is an official Bilibili client.

- [ ] **Step 2: Check privacy and licensing**

Confirm no user-specific content, credentials, logs, or private identifiers are visible. Confirm every non-Bilimi audio source has license provenance in `assets\manifest.json`.

- [ ] **Step 3: Perform the final playback review**

Play the rendered MP4 from start to finish outside the Codex in-app browser. Confirm the narrator is understandable over the music, “主人” is pronounced naturally, “Bilimi” is clear at the end, captions match the audio, and the final brand hold lasts at least three seconds.

- [ ] **Step 4: Mark the final result**

Update `RENDER_LOG.md` with the final review result, exact output paths, and any known limitations. Do not claim completion until the MP4, SRT, cover, and publishing copy all exist and the validation evidence is recorded.

## Self-Review Checklist

- [ ] Spec coverage: the approved 35-42 second Bilibili concept, Xiaomiao voice, “主人” address, real Bilimi footage, captions, product-claim boundaries, privacy requirements, cover, publishing copy, HyperFrames render, and browser bypass each have a task.
- [ ] Placeholder scan: no `TBD`, `TODO`, empty license fields, or unresolved asset paths remain in the final project.
- [ ] Type/path consistency: `index.html` references the exact files generated by Tasks 2-5; caption JSON uses `start`, `end`, and `text`; render output matches the delivery filenames.
- [ ] Technical consistency: the stage duration, scene end time, narration duration, render duration, and SRT end time all fit within the 42-second envelope.
- [ ] Safety consistency: the plan never requires real Bilibili destructive operations, real account data, or Codex in-app browser usage.
