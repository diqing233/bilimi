# Video Audio Transcription Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audio transcription fallback for current-video notes using bundled `yt-dlp`, bundled `ffmpeg`, temporary Bilibili cookies, and OpenAI `whisper-1`.

**Architecture:** Keep browser/page extraction in the renderer and move filesystem, cookies, external commands, temporary files, and OpenAI calls into Electron main-process modules. The renderer receives progress and final `TranscriptSegment[]`, then reuses the existing video note draft pipeline.

**Tech Stack:** Electron main/preload IPC, React, TypeScript, Vitest, `electron-store`, Node `child_process`, Node `fs/promises`, OpenAI Audio Transcriptions HTTP API, bundled `yt-dlp` and `ffmpeg`.

---

## File Structure

- Modify `src/shared/types.ts`
  - Add audio transcription request/result/progress types.
  - Extend `VideoNote.transcriptSource` to include `'audio'`.
- Modify `src/shared/videoNotes.test.ts`
  - Add compatibility coverage for `transcriptSource: 'audio'`.
- Modify `src/renderer/src/features/notes/videoNoteSummarizer.ts`
  - Accept `'audio'` transcript source when creating video note drafts.
- Create `electron/main/mediaToolPaths.ts`
  - Resolve bundled `yt-dlp` and `ffmpeg` paths.
- Create `electron/main/mediaToolPaths.test.ts`
  - Verify path resolution and missing-tool errors.
- Create `electron/main/bilibiliCookieExport.ts`
  - Convert Electron cookies to Netscape cookie file text and write temporary cookie files.
- Create `electron/main/bilibiliCookieExport.test.ts`
  - Verify Bilibili-only filtering, secure/session fields, and cleanup shape.
- Create `electron/main/audioDownload.ts`
  - Build and run `yt-dlp` commands for a single current video.
- Create `electron/main/audioDownload.test.ts`
  - Verify command arguments and failure sanitization.
- Create `electron/main/audioSegmenter.ts`
  - Build and run `ffmpeg` commands to normalize and segment audio.
- Create `electron/main/audioSegmenter.test.ts`
  - Verify segmentation command arguments and returned offsets.
- Create `electron/main/openAiTranscription.ts`
  - Build OpenAI transcription requests and map verbose JSON to `TranscriptSegment[]`.
- Create `electron/main/openAiTranscription.test.ts`
  - Verify request fields, error mapping, and timestamp conversion.
- Create `electron/main/videoTranscriptionService.ts`
  - Orchestrate cookie export, audio download, segmenting, OpenAI transcription, merge, progress, and cleanup.
- Create `electron/main/videoTranscriptionService.test.ts`
  - Verify success path, offset merge, failure cleanup, and cancellation.
- Modify `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
  - Add runtime request/response types for `generate-video-note-from-audio`.
- Modify `src/renderer/src/App.tsx`
  - Add a renderer function that returns current video transcription input and calls the desktop transcription API.
- Modify `src/renderer/src/App.test.tsx`
  - Add runtime/desktop integration coverage for transcription.
- Modify `electron/preload/index.ts`
  - Expose `transcribeCurrentVideoAudio` and progress listener APIs.
- Modify `src/renderer/src/global.d.ts`
  - Add new desktop bridge methods.
- Modify `electron/main/index.ts`
  - Register IPC handlers and progress events.
- Modify `src/renderer/src/features/notes/VideoNotesPanel.tsx`
  - Add "转写音频" action, progress display, completion handling, and failure messages.
- Modify `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
  - Add UI tests for fallback action, progress, success, and failure.
- Create: `tools/README.md`
  - Document the expected bundled media tool locations for development and packaging.

---

### Task 1: Shared Types And Audio Transcript Source

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/videoNotes.test.ts`
- Modify: `src/renderer/src/features/notes/videoNoteSummarizer.ts`
- Test: `src/shared/videoNotes.test.ts`
- Test: `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`

- [ ] **Step 1: Write the failing shared type compatibility test**

Add this test to `src/shared/videoNotes.test.ts`:

```ts
it('keeps audio transcript source when normalizing notes', () => {
  const note = createNote({ transcriptSource: 'audio' })

  expect(normalizeVideoNote(note).transcriptSource).toBe('audio')
})
```

- [ ] **Step 2: Run the shared test and verify it fails**

Run:

```bash
npm test -- src/shared/videoNotes.test.ts
```

Expected: TypeScript or Vitest fails because `'audio'` is not assignable to the current transcript source union.

- [ ] **Step 3: Extend shared types**

In `src/shared/types.ts`, add a reusable union and use it in existing note shapes:

```ts
export type VideoNoteTranscriptSource = 'auto' | 'manual' | 'audio'
```

Change:

```ts
transcriptSource: 'auto' | 'manual'
```

to:

```ts
transcriptSource: VideoNoteTranscriptSource
```

in both `VideoNote` and `VideoNoteExtractionResult`.

Add transcription types near the video note types:

```ts
export type VideoAudioTranscriptionProgressStep =
  | 'preparing-session'
  | 'downloading-audio'
  | 'preparing-segments'
  | 'transcribing-segment'
  | 'merging-transcript'
  | 'generating-note'

export type VideoAudioTranscriptionProgress = {
  step: VideoAudioTranscriptionProgressStep
  message: string
  segmentIndex?: number
  segmentCount?: number
}

export type VideoAudioTranscriptionRequest = {
  url: string
  title: string
  bvid?: string
  aid?: number | string
  cid?: number | string
}

export type VideoAudioTranscriptionResult = {
  transcript: TranscriptSegment[]
  transcriptSource: 'audio'
}
```

- [ ] **Step 4: Update note draft input to accept audio**

In `src/renderer/src/features/notes/videoNoteSummarizer.ts`, import the type:

```ts
import type {
  TranscriptChapter,
  TranscriptSegment,
  VideoNote,
  VideoNoteOverview,
  VideoNoteSourceMetadata,
  VideoNoteTimelineItem,
  VideoNoteTranscriptSource
} from '@shared/types'
```

Change the `CreateLocalVideoNoteDraftInput` field:

```ts
transcriptSource: VideoNoteTranscriptSource
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.ts
git commit -m "feat: support audio transcript source"
```

---

### Task 2: Bundled Media Tool Path Resolution

**Files:**
- Create: `electron/main/mediaToolPaths.ts`
- Create: `electron/main/mediaToolPaths.test.ts`

- [ ] **Step 1: Write failing tests for tool path resolution**

Create `electron/main/mediaToolPaths.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createMediaToolPaths, resolveMediaToolPaths } from './mediaToolPaths'

describe('media tool paths', () => {
  it('resolves development tool paths from the project tools directory', () => {
    const exists = vi.fn((path: string) => path.includes('tools'))

    expect(
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists
      })
    ).toEqual({
      ytdlpPath: 'C:/Users/diqing/bilimi/tools/win32/yt-dlp.exe',
      ffmpegPath: 'C:/Users/diqing/bilimi/tools/win32/ffmpeg.exe'
    })
  })

  it('resolves packaged tool paths from resources', () => {
    const exists = vi.fn(() => true)

    expect(
      createMediaToolPaths({
        appPath: 'C:/Program Files/Bilimi/resources/app.asar',
        isPackaged: true,
        platform: 'win32',
        resourcesPath: 'C:/Program Files/Bilimi/resources',
        exists
      })
    ).toEqual({
      ytdlpPath: 'C:/Program Files/Bilimi/resources/tools/win32/yt-dlp.exe',
      ffmpegPath: 'C:/Program Files/Bilimi/resources/tools/win32/ffmpeg.exe'
    })
  })

  it('throws an actionable error when a tool is missing', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists: () => false
      })
    ).toThrow('Bundled media tool is missing')
  })

  it('uses the current Electron app paths in the default resolver', () => {
    expect(typeof resolveMediaToolPaths).toBe('function')
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- electron/main/mediaToolPaths.test.ts
```

Expected: fails because `electron/main/mediaToolPaths.ts` does not exist.

- [ ] **Step 3: Implement media tool path resolution**

Create `electron/main/mediaToolPaths.ts`:

```ts
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type MediaToolPaths = {
  ytdlpPath: string
  ffmpegPath: string
}

type MediaToolPathInput = {
  appPath: string
  isPackaged: boolean
  platform: NodeJS.Platform
  resourcesPath: string
  exists: (path: string) => boolean
}

function executableName(baseName: 'yt-dlp' | 'ffmpeg', platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName
}

export function createMediaToolPaths(input: MediaToolPathInput): MediaToolPaths {
  const root = input.isPackaged ? input.resourcesPath : input.appPath
  const toolRoot = join(root, 'tools', input.platform)
  const ytdlpPath = join(toolRoot, executableName('yt-dlp', input.platform)).replace(/\\/g, '/')
  const ffmpegPath = join(toolRoot, executableName('ffmpeg', input.platform)).replace(/\\/g, '/')

  for (const path of [ytdlpPath, ffmpegPath]) {
    if (!input.exists(path)) {
      throw new Error(`Bundled media tool is missing: ${path}`)
    }
  }

  return { ytdlpPath, ffmpegPath }
}

export function resolveMediaToolPaths(): MediaToolPaths {
  return createMediaToolPaths({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    exists: existsSync
  })
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/mediaToolPaths.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/mediaToolPaths.ts electron/main/mediaToolPaths.test.ts
git commit -m "feat: resolve bundled media tools"
```

---

### Task 3: Temporary Bilibili Cookie Export

**Files:**
- Create: `electron/main/bilibiliCookieExport.ts`
- Create: `electron/main/bilibiliCookieExport.test.ts`

- [ ] **Step 1: Write failing tests for cookie formatting**

Create `electron/main/bilibiliCookieExport.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  createBilibiliCookieExportText,
  exportBilibiliCookiesToFile
} from './bilibiliCookieExport'

describe('bilibili cookie export', () => {
  it('exports only bilibili cookies in Netscape format', () => {
    const text = createBilibiliCookieExportText([
      {
        domain: '.bilibili.com',
        hostOnly: false,
        httpOnly: true,
        name: 'SESSDATA',
        path: '/',
        secure: true,
        session: false,
        value: 'secret',
        expirationDate: 1780000000
      },
      {
        domain: '.example.com',
        hostOnly: false,
        httpOnly: false,
        name: 'ignored',
        path: '/',
        secure: false,
        session: true,
        value: 'nope'
      }
    ])

    expect(text).toContain('# Netscape HTTP Cookie File')
    expect(text).toContain('.bilibili.com\tTRUE\t/\tTRUE\t1780000000\tSESSDATA\tsecret')
    expect(text).not.toContain('example.com')
  })

  it('writes a temporary cookie file through injected dependencies', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          {
            domain: '.bilibili.com',
            hostOnly: false,
            httpOnly: false,
            name: 'DedeUserID',
            path: '/',
            secure: false,
            session: true,
            value: '123'
          }
        ])
      }
    }

    const result = await exportBilibiliCookiesToFile({
      session,
      tempDir: 'C:/tmp/bilimi-transcribe',
      writeFile,
      mkdir,
      now: () => 1780000000000
    })

    expect(session.cookies.get).toHaveBeenCalledWith({ domain: 'bilibili.com' })
    expect(mkdir).toHaveBeenCalledWith('C:/tmp/bilimi-transcribe', { recursive: true })
    expect(result.path).toBe('C:/tmp/bilimi-transcribe/bilibili-cookies-1780000000000.txt')
    expect(writeFile).toHaveBeenCalledWith(
      result.path,
      expect.stringContaining('DedeUserID\t123'),
      'utf8'
    )
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- electron/main/bilibiliCookieExport.test.ts
```

Expected: fails because the cookie export module does not exist.

- [ ] **Step 3: Implement cookie export helpers**

Create `electron/main/bilibiliCookieExport.ts`:

```ts
import type { Session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type CookieLike = {
  domain: string
  hostOnly?: boolean
  name: string
  path?: string
  secure?: boolean
  session?: boolean
  value: string
  expirationDate?: number
}

type CookieSessionLike = {
  cookies: {
    get: (filter: { domain: string }) => Promise<CookieLike[]>
  }
}

function isBilibiliCookie(cookie: CookieLike): boolean {
  return cookie.domain === 'bilibili.com' || cookie.domain.endsWith('.bilibili.com')
}

export function createBilibiliCookieExportText(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File']

  for (const cookie of cookies.filter(isBilibiliCookie)) {
    const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE'
    const path = cookie.path || '/'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    const expires = cookie.session ? '0' : String(Math.floor(cookie.expirationDate ?? 0))
    lines.push(
      [
        cookie.domain,
        includeSubdomains,
        path,
        secure,
        expires,
        cookie.name,
        cookie.value
      ].join('\t')
    )
  }

  return `${lines.join('\n')}\n`
}

export async function exportBilibiliCookiesToFile({
  session,
  tempDir,
  writeFile: write = writeFile,
  mkdir: makeDir = mkdir,
  now = Date.now
}: {
  session: CookieSessionLike | Session
  tempDir: string
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
  now?: () => number
}): Promise<{ path: string; cookieCount: number }> {
  const cookies = await session.cookies.get({ domain: 'bilibili.com' })
  const text = createBilibiliCookieExportText(cookies)
  const cookieCount = cookies.filter(isBilibiliCookie).length
  const path = join(tempDir, `bilibili-cookies-${now()}.txt`).replace(/\\/g, '/')

  await makeDir(tempDir, { recursive: true })
  await write(path, text, 'utf8')

  return { path, cookieCount }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/bilibiliCookieExport.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/bilibiliCookieExport.ts electron/main/bilibiliCookieExport.test.ts
git commit -m "feat: export temporary bilibili cookies"
```

---

### Task 4: yt-dlp Audio Download Wrapper

**Files:**
- Create: `electron/main/audioDownload.ts`
- Create: `electron/main/audioDownload.test.ts`

- [ ] **Step 1: Write failing tests for yt-dlp arguments**

Create `electron/main/audioDownload.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildYtdlpAudioArgs, downloadVideoAudio } from './audioDownload'

describe('audio download', () => {
  it('builds conservative yt-dlp args for one current video', () => {
    expect(
      buildYtdlpAudioArgs({
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s'
      })
    ).toEqual([
      '--no-playlist',
      '--cookies',
      'C:/tmp/cookies.txt',
      '-f',
      'bestaudio/best',
      '-o',
      'C:/tmp/audio.%(ext)s',
      '--print',
      'after_move:filepath',
      'https://www.bilibili.com/video/BV1demo'
    ])
  })

  it('returns the downloaded filepath from stdout', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: 'C:/tmp/audio.m4a\n',
      stderr: '',
      exitCode: 0
    })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess
      })
    ).resolves.toEqual({ audioPath: 'C:/tmp/audio.m4a' })
  })

  it('sanitizes signed urls from failure messages', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'failed https://example.test/audio.m4a?token=secret',
      exitCode: 1
    })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess
      })
    ).rejects.toThrow('Audio download failed')
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- electron/main/audioDownload.test.ts
```

Expected: fails because `audioDownload.ts` does not exist.

- [ ] **Step 3: Implement audio download wrapper**

Create `electron/main/audioDownload.ts`:

```ts
import { spawn } from 'node:child_process'

type ProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type RunProcess = (command: string, args: string[]) => Promise<ProcessResult>

export function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 })
    })
  })
}

export function buildYtdlpAudioArgs({
  url,
  cookiePath,
  outputTemplate
}: {
  url: string
  cookiePath: string
  outputTemplate: string
}): string[] {
  return [
    '--no-playlist',
    '--cookies',
    cookiePath,
    '-f',
    'bestaudio/best',
    '-o',
    outputTemplate,
    '--print',
    'after_move:filepath',
    url
  ]
}

function sanitizeProcessText(value: string): string {
  return value.replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 500)
}

export async function downloadVideoAudio({
  ytdlpPath,
  url,
  cookiePath,
  outputTemplate,
  runProcess: run = runProcess
}: {
  ytdlpPath: string
  url: string
  cookiePath: string
  outputTemplate: string
  runProcess?: RunProcess
}): Promise<{ audioPath: string }> {
  const result = await run(ytdlpPath, buildYtdlpAudioArgs({ url, cookiePath, outputTemplate }))

  if (result.exitCode !== 0) {
    throw new Error(`Audio download failed: ${sanitizeProcessText(result.stderr || result.stdout)}`)
  }

  const audioPath = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)

  if (!audioPath) {
    throw new Error('Audio download failed: yt-dlp did not report an output file.')
  }

  return { audioPath }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/audioDownload.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/audioDownload.ts electron/main/audioDownload.test.ts
git commit -m "feat: wrap yt-dlp audio download"
```

---

### Task 5: ffmpeg Audio Segmentation

**Files:**
- Create: `electron/main/audioSegmenter.ts`
- Create: `electron/main/audioSegmenter.test.ts`

- [ ] **Step 1: Write failing tests for ffmpeg segmenting**

Create `electron/main/audioSegmenter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildFfmpegSegmentArgs, createSegmentOffsets, segmentAudioForTranscription } from './audioSegmenter'

describe('audio segmenter', () => {
  it('creates segment offsets by fixed duration', () => {
    expect(createSegmentOffsets({ durationSeconds: 125, segmentSeconds: 60 })).toEqual([0, 60, 120])
  })

  it('builds ffmpeg args for normalized audio segments', () => {
    expect(
      buildFfmpegSegmentArgs({
        inputPath: 'C:/tmp/input.m4a',
        segmentSeconds: 600,
        outputPattern: 'C:/tmp/segment-%03d.mp3'
      })
    ).toEqual([
      '-y',
      '-i',
      'C:/tmp/input.m4a',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'segment',
      '-segment_time',
      '600',
      '-reset_timestamps',
      '1',
      'C:/tmp/segment-%03d.mp3'
    ])
  })

  it('returns ordered segment files with offsets', async () => {
    const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const listFiles = vi.fn().mockResolvedValue(['segment-001.mp3', 'segment-000.mp3'])

    await expect(
      segmentAudioForTranscription({
        ffmpegPath: 'C:/tools/ffmpeg.exe',
        inputPath: 'C:/tmp/input.m4a',
        outputDir: 'C:/tmp/segments',
        segmentSeconds: 600,
        durationSeconds: 900,
        runProcess,
        listFiles
      })
    ).resolves.toEqual([
      { path: 'C:/tmp/segments/segment-000.mp3', offsetSeconds: 0 },
      { path: 'C:/tmp/segments/segment-001.mp3', offsetSeconds: 600 }
    ])
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- electron/main/audioSegmenter.test.ts
```

Expected: fails because the segmenter module does not exist.

- [ ] **Step 3: Implement audio segmenting**

Create `electron/main/audioSegmenter.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess as defaultRunProcess } from './audioDownload'

type RunProcess = typeof defaultRunProcess

export type AudioSegment = {
  path: string
  offsetSeconds: number
}

export function createSegmentOffsets({
  durationSeconds,
  segmentSeconds
}: {
  durationSeconds: number
  segmentSeconds: number
}): number[] {
  const offsets: number[] = []

  for (let offset = 0; offset < durationSeconds; offset += segmentSeconds) {
    offsets.push(offset)
  }

  return offsets.length > 0 ? offsets : [0]
}

export function buildFfmpegSegmentArgs({
  inputPath,
  segmentSeconds,
  outputPattern
}: {
  inputPath: string
  segmentSeconds: number
  outputPattern: string
}): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'segment',
    '-segment_time',
    String(segmentSeconds),
    '-reset_timestamps',
    '1',
    outputPattern
  ]
}

export async function segmentAudioForTranscription({
  ffmpegPath,
  inputPath,
  outputDir,
  segmentSeconds = 600,
  durationSeconds,
  runProcess = defaultRunProcess,
  listFiles = readdir
}: {
  ffmpegPath: string
  inputPath: string
  outputDir: string
  segmentSeconds?: number
  durationSeconds: number
  runProcess?: RunProcess
  listFiles?: typeof readdir
}): Promise<AudioSegment[]> {
  const outputPattern = join(outputDir, 'segment-%03d.mp3').replace(/\\/g, '/')
  const result = await runProcess(
    ffmpegPath,
    buildFfmpegSegmentArgs({ inputPath, segmentSeconds, outputPattern })
  )

  if (result.exitCode !== 0) {
    throw new Error('Audio preparation failed. The downloaded media format may be unsupported.')
  }

  const files = (await listFiles(outputDir))
    .filter((file) => /^segment-\d+\.mp3$/.test(file))
    .sort()
  const offsets = createSegmentOffsets({ durationSeconds, segmentSeconds })

  return files.map((file, index) => ({
    path: join(outputDir, file).replace(/\\/g, '/'),
    offsetSeconds: offsets[index] ?? index * segmentSeconds
  }))
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/audioSegmenter.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/audioSegmenter.ts electron/main/audioSegmenter.test.ts
git commit -m "feat: segment audio for transcription"
```

---

### Task 6: OpenAI whisper-1 Transcription Client

**Files:**
- Create: `electron/main/openAiTranscription.ts`
- Create: `electron/main/openAiTranscription.test.ts`

- [ ] **Step 1: Write failing tests for transcription mapping**

Create `electron/main/openAiTranscription.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  buildOpenAiTranscriptionForm,
  mapVerboseTranscriptionToSegments,
  transcribeAudioSegment
} from './openAiTranscription'

describe('open ai transcription', () => {
  it('maps verbose transcription segments to transcript segments with offsets', () => {
    expect(
      mapVerboseTranscriptionToSegments(
        {
          segments: [
            { start: 0.5, end: 2.25, text: ' 开场 ' },
            { start: 3, end: 5, text: '' }
          ]
        },
        600
      )
    ).toEqual([{ start: 600.5, end: 602.25, text: '开场' }])
  })

  it('builds a whisper-1 transcription form', () => {
    const form = buildOpenAiTranscriptionForm({
      file: new Blob(['audio']),
      filename: 'segment-000.mp3'
    })

    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('throws an actionable authentication error for 401 responses', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key'
    })

    await expect(
      transcribeAudioSegment({
        apiKey: 'sk-test',
        path: 'C:/tmp/segment.mp3',
        offsetSeconds: 0,
        readFile: vi.fn().mockResolvedValue(Buffer.from('audio')),
        fetch
      })
    ).rejects.toThrow('OpenAI API key is invalid or missing')
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- electron/main/openAiTranscription.test.ts
```

Expected: fails because the transcription module does not exist.

- [ ] **Step 3: Implement OpenAI transcription client**

Create `electron/main/openAiTranscription.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TranscriptSegment } from '../../src/shared/types'

type VerboseTranscription = {
  segments?: Array<{
    start?: number
    end?: number
    text?: string
  }>
}

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function mapVerboseTranscriptionToSegments(
  payload: VerboseTranscription,
  offsetSeconds: number
): TranscriptSegment[] {
  return (payload.segments ?? [])
    .map((segment) => ({
      start: typeof segment.start === 'number' ? segment.start + offsetSeconds : null,
      end: typeof segment.end === 'number' ? segment.end + offsetSeconds : null,
      text: cleanText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function buildOpenAiTranscriptionForm({
  file,
  filename
}: {
  file: Blob
  filename: string
}): FormData {
  const form = new FormData()
  form.set('model', 'whisper-1')
  form.set('response_format', 'verbose_json')
  form.set('file', new File([file], filename, { type: 'audio/mpeg' }))
  return form
}

function openAiErrorMessage(status: number): string {
  if (status === 401) {
    return 'OpenAI API key is invalid or missing.'
  }

  if (status === 429) {
    return 'Transcription request failed. Check network, quota, or retry later.'
  }

  return 'Transcription request failed. Check network, quota, or retry later.'
}

export async function transcribeAudioSegment({
  apiKey,
  path,
  offsetSeconds,
  readFile: read = readFile,
  fetch: fetchImpl = fetch
}: {
  apiKey: string
  path: string
  offsetSeconds: number
  readFile?: typeof readFile
  fetch?: typeof fetch
}): Promise<TranscriptSegment[]> {
  const bytes = await read(path)
  const form = buildOpenAiTranscriptionForm({
    file: new Blob([bytes]),
    filename: basename(path)
  })
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  })

  if (!response.ok) {
    throw new Error(openAiErrorMessage(response.status))
  }

  return mapVerboseTranscriptionToSegments(await response.json(), offsetSeconds)
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/openAiTranscription.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/openAiTranscription.ts electron/main/openAiTranscription.test.ts
git commit -m "feat: transcribe audio with openai"
```

---

### Task 7: Main-Process Transcription Service

**Files:**
- Create: `electron/main/videoTranscriptionService.ts`
- Create: `electron/main/videoTranscriptionService.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Create `electron/main/videoTranscriptionService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'

describe('video transcription service', () => {
  it('downloads, segments, transcribes, merges, reports progress, and cleans up', async () => {
    const progress = vi.fn()
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        apiKey: 'sk-test',
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' }),
        exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
        downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
        segmentAudio: vi.fn().mockResolvedValue([
          { path: 'C:/tmp/segment-000.mp3', offsetSeconds: 0 },
          { path: 'C:/tmp/segment-001.mp3', offsetSeconds: 600 }
        ]),
        transcribeSegment: vi
          .fn()
          .mockResolvedValueOnce([{ start: 0, end: 2, text: '第一段' }])
          .mockResolvedValueOnce([{ start: 600, end: 602, text: '第二段' }]),
        getAudioDuration: vi.fn().mockResolvedValue(900),
        cleanup,
        progress
      })
    ).resolves.toEqual({
      transcriptSource: 'audio',
      transcript: [
        { start: 0, end: 2, text: '第一段' },
        { start: 600, end: 602, text: '第二段' }
      ]
    })

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'downloading-audio' })
    )
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'transcribing-segment', segmentIndex: 2, segmentCount: 2 })
    )
    expect(cleanup).toHaveBeenCalled()
  })

  it('cleans up when download fails', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        apiKey: 'sk-test',
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' }),
        exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
        downloadAudio: vi.fn().mockRejectedValue(new Error('Audio download failed.')),
        segmentAudio: vi.fn(),
        transcribeSegment: vi.fn(),
        getAudioDuration: vi.fn(),
        cleanup
      })
    ).rejects.toThrow('Audio download failed')

    expect(cleanup).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- electron/main/videoTranscriptionService.test.ts
```

Expected: fails because the service module does not exist.

- [ ] **Step 3: Implement the orchestration service**

Create `electron/main/videoTranscriptionService.ts`:

```ts
import type { Session } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult
} from '../../src/shared/types'
import { downloadVideoAudio } from './audioDownload'
import { segmentAudioForTranscription, type AudioSegment } from './audioSegmenter'
import { exportBilibiliCookiesToFile } from './bilibiliCookieExport'
import { transcribeAudioSegment } from './openAiTranscription'
import { resolveMediaToolPaths } from './mediaToolPaths'

type ServiceSessionLike = Pick<Session, 'cookies'>

type ServiceDeps = {
  request: VideoAudioTranscriptionRequest
  apiKey: string
  session: ServiceSessionLike
  tempDir: string
  progress?: (progress: VideoAudioTranscriptionProgress) => void
  resolveTools?: typeof resolveMediaToolPaths
  exportCookies?: typeof exportBilibiliCookiesToFile
  downloadAudio?: typeof downloadVideoAudio
  segmentAudio?: typeof segmentAudioForTranscription
  transcribeSegment?: typeof transcribeAudioSegment
  getAudioDuration?: (path: string) => Promise<number>
  cleanup?: (path: string) => Promise<void>
}

function emit(
  progress: ((progress: VideoAudioTranscriptionProgress) => void) | undefined,
  next: VideoAudioTranscriptionProgress
) {
  progress?.(next)
}

async function defaultGetAudioDuration(): Promise<number> {
  return 3600
}

async function defaultCleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export async function transcribeCurrentVideoAudio({
  request,
  apiKey,
  session,
  tempDir,
  progress,
  resolveTools = resolveMediaToolPaths,
  exportCookies = exportBilibiliCookiesToFile,
  downloadAudio = downloadVideoAudio,
  segmentAudio = segmentAudioForTranscription,
  transcribeSegment = transcribeAudioSegment,
  getAudioDuration = defaultGetAudioDuration,
  cleanup = defaultCleanup
}: ServiceDeps): Promise<VideoAudioTranscriptionResult> {
  try {
    emit(progress, { step: 'preparing-session', message: 'Preparing current login session.' })
    const tools = resolveTools()
    const cookieExport = await exportCookies({ session, tempDir })

    emit(progress, { step: 'downloading-audio', message: 'Downloading audio.' })
    const outputTemplate = join(tempDir, 'source.%(ext)s').replace(/\\/g, '/')
    const { audioPath } = await downloadAudio({
      ytdlpPath: tools.ytdlpPath,
      url: request.url,
      cookiePath: cookieExport.path,
      outputTemplate
    })

    emit(progress, { step: 'preparing-segments', message: 'Preparing audio segments.' })
    const durationSeconds = await getAudioDuration(audioPath)
    const segments = await segmentAudio({
      ffmpegPath: tools.ffmpegPath,
      inputPath: audioPath,
      outputDir: tempDir,
      durationSeconds
    })

    const transcript = []

    for (const [index, segment] of segments.entries()) {
      emit(progress, {
        step: 'transcribing-segment',
        message: `Transcribing segment ${index + 1}/${segments.length}.`,
        segmentIndex: index + 1,
        segmentCount: segments.length
      })
      transcript.push(
        ...(await transcribeSegment({
          apiKey,
          path: segment.path,
          offsetSeconds: segment.offsetSeconds
        }))
      )
    }

    emit(progress, { step: 'merging-transcript', message: 'Merging transcript.' })

    return {
      transcriptSource: 'audio',
      transcript
    }
  } finally {
    await cleanup(tempDir)
  }
}

export type { AudioSegment }
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- electron/main/videoTranscriptionService.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/main/videoTranscriptionService.ts electron/main/videoTranscriptionService.test.ts
git commit -m "feat: orchestrate video audio transcription"
```

---

### Task 8: IPC Bridge And App Integration

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing App bridge test**

Add this test to `src/renderer/src/App.test.tsx` near existing runtime bridge tests:

```ts
it('generates a video note from audio through the assistant runtime', async () => {
  const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  Object.assign(webview, {
    executeJavaScript: vi.fn().mockResolvedValue({
      source: {
        title: '很多人不懂我的艺术',
        bvid: 'BV1demo',
        url: 'https://www.bilibili.com/video/BV1demo',
        tags: []
      },
      transcript: [],
      transcriptSource: 'manual'
    })
  })
  desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({
    transcriptSource: 'audio',
    transcript: [{ start: 0, end: 2, text: '音频转写文稿' }]
  })

  const note = await requestRuntime({ id: 'audio-note-1', type: 'generate-video-note-from-audio' })

  expect(desktopApi.transcribeCurrentVideoAudio).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://www.bilibili.com/video/BV1demo',
      title: '很多人不懂我的艺术',
      bvid: 'BV1demo'
    })
  )
  expect(note).toEqual(
    expect.objectContaining({
      transcriptSource: 'audio',
      transcript: [{ start: 0, end: 2, text: '音频转写文稿' }]
    })
  )
})
```

- [ ] **Step 2: Run App test and verify it fails**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx
```

Expected: fails because the runtime request type and handler do not exist.

- [ ] **Step 3: Add desktop API types**

In `src/renderer/src/global.d.ts`, import these shared types:

```ts
import type {
  AssistantAction,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote
} from '../../src/shared/types'
```

Add methods to `BilimiDesktopApi`:

```ts
transcribeCurrentVideoAudio?: (
  request: VideoAudioTranscriptionRequest
) => Promise<VideoAudioTranscriptionResult>
generateVideoNoteFromAudio?: () => Promise<VideoNote | null>
onVideoAudioTranscriptionProgress?: (
  callback: (progress: VideoAudioTranscriptionProgress) => void
) => () => void
```

In `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`, add:

```ts
| { id: string; type: 'generate-video-note-from-audio' }
```

to `AssistantRuntimeRequest`. `AssistantRuntimeResponsePayload` already includes `VideoNote | null`.

- [ ] **Step 4: Expose preload APIs**

In `electron/preload/index.ts`, import the new shared types and expose:

```ts
transcribeCurrentVideoAudio: (request: VideoAudioTranscriptionRequest) =>
  ipcRenderer.invoke('video-audio:transcribe-current', request) as Promise<VideoAudioTranscriptionResult>,
generateVideoNoteFromAudio: () =>
  ipcRenderer.invoke('floating-assistant:generate-video-note-from-audio') as Promise<VideoNote | null>,
onVideoAudioTranscriptionProgress: (callback: (progress: VideoAudioTranscriptionProgress) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, progress: VideoAudioTranscriptionProgress) => callback(progress)

  ipcRenderer.on('video-audio:transcription-progress', listener)

  return () => {
    ipcRenderer.removeListener('video-audio:transcription-progress', listener)
  }
}
```

- [ ] **Step 5: Register main IPC handler**

In `electron/main/index.ts`, import:

```ts
import { session } from 'electron'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import type { VideoAudioTranscriptionRequest } from '../../src/shared/types'
```

Add helper:

```ts
function getOpenAiApiKey() {
  const value = process.env.OPENAI_API_KEY

  if (!value) {
    throw new Error('OpenAI API key is invalid or missing.')
  }

  return value
}
```

Inside `registerAssistantPreferenceHandlers`, add:

```ts
ipcMain.handle('video-audio:transcribe-current', async (event, request: VideoAudioTranscriptionRequest) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-transcribe-'))
  const sourceSession = session.fromPartition(BILIMI_SESSION_PARTITION)

  return transcribeCurrentVideoAudio({
    request,
    apiKey: getOpenAiApiKey(),
    session: sourceSession,
    tempDir,
    progress: (progress) => {
      event.sender.send('video-audio:transcription-progress', progress)
    }
  })
})
ipcMain.handle('floating-assistant:generate-video-note-from-audio', () =>
  requestMainAssistantRuntime<VideoNote | null>({
    type: 'generate-video-note-from-audio'
  })
)
```

This uses `OPENAI_API_KEY` temporarily until the in-app protected API key setting is implemented in a later task.

- [ ] **Step 6: Add renderer audio note generation function**

In `src/renderer/src/App.tsx`, add a function next to `generateRuntimeVideoNote`:

```ts
async function generateRuntimeVideoNoteFromAudio(): Promise<VideoNote | null> {
  const extraction = await readVideoNoteSource()

  if (!extraction?.source.url || !window.bilimiDesktop?.transcribeCurrentVideoAudio) {
    return null
  }

  const result = await window.bilimiDesktop.transcribeCurrentVideoAudio({
    url: extraction.source.url,
    title: extraction.source.title,
    bvid: extraction.source.bvid
  })

  return createLocalVideoNoteDraft({
    now: new Date().toISOString(),
    source: extraction.source,
    transcript: result.transcript,
    transcriptSource: 'audio'
  })
}
```

Handle a new assistant runtime request type `generate-video-note-from-audio` by calling this function and returning the generated note.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx electron/main/videoTranscriptionService.test.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```bash
git add electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/features/assistant/assistantRuntimeTypes.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "feat: bridge audio transcription to renderer"
```

---

### Task 9: Video Notes Panel UI

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: Write failing panel UI tests**

Add tests to `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`:

```ts
it('shows audio transcription fallback when no note is present', () => {
  render(
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={vi.fn()}
    />
  )

  expect(screen.getByRole('button', { name: '转写音频' })).toBeInTheDocument()
})

it('runs audio transcription and reports progress', async () => {
  const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)

  render(
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={onTranscribeAudio}
      transcriptionProgress={{
        step: 'transcribing-segment',
        message: 'Transcribing segment 1/2.',
        segmentIndex: 1,
        segmentCount: 2
      }}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

  await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
  expect(screen.getByRole('status')).toHaveTextContent('音频转写已完成')
  expect(screen.getByText('Transcribing segment 1/2.')).toBeInTheDocument()
})

it('keeps manual paste available when audio transcription fails', async () => {
  const onTranscribeAudio = vi.fn().mockRejectedValue(new Error('Audio download failed.'))

  render(
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={onTranscribeAudio}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Audio download failed.'))
  expect(screen.getByLabelText('粘贴文稿')).toBeEnabled()
})
```

- [ ] **Step 2: Run panel tests and verify they fail**

Run:

```bash
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: fails because the props and button do not exist.

- [ ] **Step 3: Add panel props and UI**

In `VideoNotesPanel.tsx`, import:

```ts
import type { VideoAudioTranscriptionProgress, VideoNote, VideoNoteAnnotation } from '@shared/types'
```

Extend props:

```ts
onTranscribeAudio?: () => Promise<VideoNote | null>
transcriptionProgress?: VideoAudioTranscriptionProgress | null
```

Add state:

```ts
const [transcribingAudio, setTranscribingAudio] = useState(false)
```

Add handler:

```ts
async function handleTranscribeAudio(): Promise<void> {
  if (!onTranscribeAudio || generationBusy || transcribingAudio) {
    return
  }

  setTranscribingAudio(true)
  setStatusMessage('')
  setErrorMessage('')

  try {
    const generatedNote = await onTranscribeAudio()

    if (generatedNote) {
      setStatusMessage('音频转写已完成')
    }
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : '音频转写失败。')
  } finally {
    setTranscribingAudio(false)
  }
}
```

In the `!note` render branch, add:

```tsx
<button
  type="button"
  disabled={!onTranscribeAudio || generationBusy || transcribingAudio}
  onClick={() => void handleTranscribeAudio()}
>
  {transcribingAudio ? '转写中...' : '转写音频'}
</button>
{transcriptionProgress ? <p role="status">{transcriptionProgress.message}</p> : null}
```

- [ ] **Step 4: Thread props through assistant panels**

In `MemorialPanel.tsx`, add props:

```ts
onTranscribeVideoAudio?: () => Promise<VideoNote | null>
transcriptionProgress?: VideoAudioTranscriptionProgress | null
```

Pass them to `VideoNotesPanel` as `onTranscribeAudio` and `transcriptionProgress`.

In `FloatingAssistantApp.tsx`, keep state:

```ts
const [transcriptionProgress, setTranscriptionProgress] = useState<VideoAudioTranscriptionProgress | null>(null)
```

Register the progress listener in an effect:

```ts
useEffect(() => {
  return window.bilimiDesktop?.onVideoAudioTranscriptionProgress?.((progress) => {
    setTranscriptionProgress(progress)
  })
}, [])
```

Add `generateVideoNoteFromAudio` wrapper that calls `window.bilimiDesktop.generateVideoNoteFromAudio?.()`, sets `videoNote`, and returns it.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx
git commit -m "feat: add audio transcription fallback UI"
```

---

### Task 10: Protected API Key Setting

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [ ] **Step 1: Write failing store tests for OpenAI key protection**

Add to `electron/main/store.test.ts`:

```ts
it('saves and reports OpenAI key presence without exposing the key', () => {
  const store = createFakeStore()

  saveOpenAiApiKey(store, 'sk-test-secret')

  expect(loadOpenAiApiKeyStatus(store)).toEqual({ configured: true })
  expect(loadOpenAiApiKey(store)).toBe('sk-test-secret')
})

it('clears the OpenAI API key', () => {
  const store = createFakeStore({ openAiApiKey: 'sk-test-secret' } as Partial<DesktopStoreState>)

  clearOpenAiApiKey(store)

  expect(loadOpenAiApiKeyStatus(store)).toEqual({ configured: false })
})
```

Update imports in the test for `saveOpenAiApiKey`, `loadOpenAiApiKey`, `loadOpenAiApiKeyStatus`, and `clearOpenAiApiKey`.

- [ ] **Step 2: Run store tests and verify they fail**

Run:

```bash
npm test -- electron/main/store.test.ts
```

Expected: fails because API key helpers do not exist.

- [ ] **Step 3: Implement store helpers**

In `electron/main/store.ts`, extend `DesktopStoreState`:

```ts
openAiApiKey: string
```

Add default:

```ts
openAiApiKey: ''
```

Add helpers:

```ts
export function loadOpenAiApiKey(store: AssistantStoreLike = getDesktopStore()): string {
  return store.get('openAiApiKey') ?? ''
}

export function loadOpenAiApiKeyStatus(store: AssistantStoreLike = getDesktopStore()): { configured: boolean } {
  return { configured: Boolean(loadOpenAiApiKey(store)) }
}

export function saveOpenAiApiKey(
  store: AssistantStoreLike = getDesktopStore(),
  apiKey: string
): { configured: boolean } {
  store.set('openAiApiKey', apiKey.trim())
  return loadOpenAiApiKeyStatus(store)
}

export function clearOpenAiApiKey(store: AssistantStoreLike = getDesktopStore()): { configured: boolean } {
  store.set('openAiApiKey', '')
  return loadOpenAiApiKeyStatus(store)
}
```

Update `createFakeStore` in tests with `openAiApiKey`.

- [ ] **Step 4: Register key IPC**

In `electron/main/index.ts`, import the helpers and register:

```ts
ipcMain.handle('openai:key-status', () => loadOpenAiApiKeyStatus(getDesktopStore()))
ipcMain.handle('openai:save-key', (_event, apiKey: string) =>
  saveOpenAiApiKey(getDesktopStore(), apiKey)
)
ipcMain.handle('openai:clear-key', () => clearOpenAiApiKey(getDesktopStore()))
```

Change `getOpenAiApiKey()` to read `loadOpenAiApiKey(getDesktopStore())` instead of `process.env.OPENAI_API_KEY`.

- [ ] **Step 5: Expose key APIs in preload and global types**

Add:

```ts
loadOpenAiApiKeyStatus?: () => Promise<{ configured: boolean }>
saveOpenAiApiKey?: (apiKey: string) => Promise<{ configured: boolean }>
clearOpenAiApiKey?: () => Promise<{ configured: boolean }>
```

Expose corresponding `ipcRenderer.invoke` calls in `electron/preload/index.ts`.

- [ ] **Step 6: Add minimal settings UI in the note panel**

In `VideoNotesPanel.tsx`, add optional props:

```ts
openAiApiKeyConfigured?: boolean
onSaveOpenAiApiKey?: (apiKey: string) => Promise<void>
onClearOpenAiApiKey?: () => Promise<void>
```

When `!openAiApiKeyConfigured`, show a password input labeled `OpenAI API Key` and a button `保存 Key`. Do not render the existing key value.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- electron/main/store.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts electron/main/store.ts electron/main/store.test.ts electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx
git commit -m "feat: store protected openai transcription key"
```

---

### Task 11: Final Verification And Manual Checklist

**Files:**
- Create: `tools/README.md`

- [ ] **Step 1: Document bundled media tool locations**

Create `tools/README.md`:

```md
# Bundled Media Tools

Bilimi expects media tools to be present under a platform-specific directory:

- Windows: `tools/win32/yt-dlp.exe` and `tools/win32/ffmpeg.exe`
- macOS: `tools/darwin/yt-dlp` and `tools/darwin/ffmpeg`
- Linux: `tools/linux/yt-dlp` and `tools/linux/ffmpeg`

The app does not download these tools at runtime. Development and packaged builds must provide them before audio transcription can run.
```

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: all test files pass.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: Electron main, preload, and renderer builds succeed.

- [ ] **Step 4: Manual verification in development**

Run:

```bash
npm run dev
```

Manual checks:

1. Open a Bilibili video that has no subtitle list.
2. Confirm the note panel still offers manual paste.
3. Save an OpenAI API key through the app setting.
4. Click "转写音频".
5. Confirm progress moves through preparing session, downloading, preparing segments, transcribing, and merging.
6. Confirm the transcript tab shows timestamped transcript text.
7. Save the note and confirm it remains in local video notes.
8. Confirm temporary job files are removed from the temp directory after completion.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified. `AGENTS.md` may remain untracked and should not be staged unless the user explicitly asks.

- [ ] **Step 6: Commit final documentation or verification polish**

When `tools/README.md` or final polish files are modified, commit them:

```bash
git add tools/README.md
git commit -m "fix: polish audio transcription fallback"
```

If `git status --short` shows no intentional tracked or untracked files except the user's existing `AGENTS.md`, do not create an empty commit.
