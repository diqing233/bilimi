# Video Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Bilimi's first local video notes feature: extract current-video metadata and available transcript, generate a local overview, show it in the memorial panel, and save notes locally.

**Architecture:** Add pure shared models first, then renderer-only extraction and local summarization modules, then Electron store IPC, then React UI integration inside the existing assistant overlay. `App` owns the active `webview` bridge; `AssistantOverlay` coordinates UI state; `VideoNotesPanel` renders the notes workflow; pure modules stay testable without Electron.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, electron-store, `webview.executeJavaScript()`

---

## File Structure

### Shared model

- Modify: `src/shared/types.ts`
  - Add `VideoNoteSourceMetadata`, `TranscriptSegment`, `TranscriptChapter`, `VideoNoteTimelineItem`, `VideoNoteOverview`, `VideoNote`, `VideoNoteExtractionResult`.
- Create: `src/shared/videoNotes.ts`
  - Stable note ID helpers and timestamp-free note merge helpers.
- Test: `src/shared/videoNotes.test.ts`
  - Verifies stable IDs and same-video note updates.

### Renderer notes logic

- Create: `src/renderer/src/features/notes/videoNoteExtractor.ts`
  - Builds current-page extraction script and normalizes raw subtitle payloads.
- Test: `src/renderer/src/features/notes/videoNoteExtractor.test.ts`
  - Verifies extraction script content and Bilibili-style subtitle JSON normalization.
- Create: `src/renderer/src/features/notes/transcriptNormalizer.ts`
  - Cleans automatic transcript and parses manual paste input.
- Test: `src/renderer/src/features/notes/transcriptNormalizer.test.ts`
  - Verifies whitespace removal, duplicate removal, and manual transcript parsing.
- Create: `src/renderer/src/features/notes/videoNoteSummarizer.ts`
  - Builds chapters, keywords, overview, and highlight candidates using local rules.
- Test: `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`
  - Verifies overview, timeline, keywords, and empty transcript handling.

### Electron persistence

- Modify: `electron/main/store.ts`
  - Extend store state with local video notes and add `loadVideoNotes()` / `saveVideoNote()`.
- Modify: `electron/main/store.test.ts`
  - Add store tests for loading, saving, and updating by stable ID.
- Modify: `electron/main/index.ts`
  - Register `video-notes:load` and `video-notes:save` IPC handlers.
- Modify: `electron/preload/index.ts`
  - Expose `loadVideoNotes()` and `saveVideoNote()`.
- Modify: `src/renderer/src/global.d.ts`
  - Add desktop API types.

### Renderer UI integration

- Create: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
  - Notes tab UI with `速览 / 文稿 / 归档`, manual paste fallback, save action.
- Test: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
  - Component behavior tests.
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
  - Add first-level `批阅 / 札记` tabs and render `VideoNotesPanel`.
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
  - Own note workflow state and connect panel callbacks.
- Modify: `src/renderer/src/App.tsx`
  - Add active-webview note extraction callback and desktop save/load callback.
- Modify: `src/renderer/src/App.test.tsx`
  - Add integration tests for extraction script execution and save IPC.
- Modify: `src/renderer/src/styles.css`
  - Add compact styles for note tabs, transcript list, manual paste, and archive state.

---

### Task 1: Shared Video Note Model

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/videoNotes.ts`
- Test: `src/shared/videoNotes.test.ts`

- [ ] **Step 1: Write the failing shared model test**

Create `src/shared/videoNotes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createVideoNoteId, upsertVideoNote } from './videoNotes'
import type { VideoNote } from './types'

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: createVideoNoteId({ bvid: 'BV1note', url: 'https://www.bilibili.com/video/BV1note', title: '本地札记' }),
    source: {
      title: '本地札记',
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      tags: []
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 3, text: '第一段文稿' }],
    chapters: [],
    overview: {
      shortSummary: ['第一段文稿'],
      keywords: ['文稿'],
      timeline: [],
      highlights: []
    },
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    ...overrides
  }
}

describe('video note helpers', () => {
  it('creates a stable id from bvid before falling back to url', () => {
    expect(createVideoNoteId({ bvid: 'BV1abc', url: 'https://example.test/a', title: 'A' })).toBe('bvid:BV1abc')
    expect(createVideoNoteId({ url: 'https://www.bilibili.com/video/BV1url?p=2', title: 'A', tags: [] })).toBe(
      'url:https://www.bilibili.com/video/BV1url?p=2'
    )
  })

  it('updates an existing note with the same id and keeps the original createdAt', () => {
    const existing = createNote()
    const updated = createNote({
      transcript: [{ start: 10, end: 14, text: '更新后的文稿' }],
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z'
    })

    expect(upsertVideoNote([existing], updated)).toEqual([
      {
        ...updated,
        createdAt: existing.createdAt
      }
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test -- src/shared/videoNotes.test.ts
```

Expected: FAIL with an import error for `./videoNotes` or missing `VideoNote` types.

- [ ] **Step 3: Add shared types**

Append these types to `src/shared/types.ts`:

```ts
export type VideoNoteSourceMetadata = {
  title: string
  author?: string
  description?: string
  tags: string[]
  bvid?: string
  url: string
}

export type TranscriptSegment = {
  start: number | null
  end: number | null
  text: string
}

export type TranscriptChapter = {
  start: number | null
  title: string
  summary: string
  segmentIndexes: number[]
}

export type VideoNoteTimelineItem = {
  start: number | null
  title: string
  detail: string
}

export type VideoNoteOverview = {
  shortSummary: string[]
  keywords: string[]
  timeline: VideoNoteTimelineItem[]
  highlights: VideoNoteTimelineItem[]
}

export type VideoNote = {
  id: string
  source: VideoNoteSourceMetadata
  transcriptSource: 'auto' | 'manual'
  transcript: TranscriptSegment[]
  chapters: TranscriptChapter[]
  overview: VideoNoteOverview
  userMemo: string
  createdAt: string
  updatedAt: string
}

export type VideoNoteExtractionResult = {
  source: VideoNoteSourceMetadata
  transcript: TranscriptSegment[]
  transcriptSource: 'auto' | 'manual'
  error?: string
}
```

Create `src/shared/videoNotes.ts`:

```ts
import type { VideoNote, VideoNoteSourceMetadata } from './types'

export function createVideoNoteId(source: Pick<VideoNoteSourceMetadata, 'bvid' | 'url'>): string {
  const bvid = source.bvid?.trim()

  if (bvid) {
    return `bvid:${bvid}`
  }

  return `url:${source.url.trim()}`
}

export function upsertVideoNote(notes: VideoNote[], nextNote: VideoNote): VideoNote[] {
  const existingNote = notes.find((note) => note.id === nextNote.id)

  if (!existingNote) {
    return [...notes, nextNote]
  }

  return notes.map((note) =>
    note.id === nextNote.id
      ? {
          ...nextNote,
          createdAt: note.createdAt
        }
      : note
  )
}
```

- [ ] **Step 4: Run the shared model test to verify it passes**

Run:

```bash
npm run test -- src/shared/videoNotes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/shared/types.ts src/shared/videoNotes.ts src/shared/videoNotes.test.ts
git commit -m "feat: add video note shared model"
```

---

### Task 2: Current Page Extraction and Subtitle Normalization

**Files:**
- Create: `src/renderer/src/features/notes/videoNoteExtractor.ts`
- Test: `src/renderer/src/features/notes/videoNoteExtractor.test.ts`

- [ ] **Step 1: Write the failing extractor tests**

Create `src/renderer/src/features/notes/videoNoteExtractor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult,
  normalizeSubtitleBody
} from './videoNoteExtractor'

describe('videoNoteExtractor', () => {
  it('builds a read-only script for current video metadata and subtitle discovery', () => {
    const script = buildVideoNoteExtractionScript()

    expect(script).toContain('document.querySelector')
    expect(script).toContain('window.__INITIAL_STATE__')
    expect(script).toContain('subtitle')
    expect(script).not.toContain('localStorage.setItem')
    expect(script).not.toContain('document.cookie')
  })

  it('normalizes bilibili subtitle body items into transcript segments', () => {
    expect(
      normalizeSubtitleBody({
        body: [
          { from: 0.5, to: 2.25, content: ' 开场白 ' },
          { from: 3, to: 4.5, content: '核心观点' },
          { from: 5, to: 7, content: '' }
        ]
      })
    ).toEqual([
      { start: 0.5, end: 2.25, text: '开场白' },
      { start: 3, end: 4.5, text: '核心观点' }
    ])
  })

  it('normalizes raw page extraction into a safe result shape', () => {
    expect(
      normalizeExtractedVideoNoteResult({
        title: '视频标题 - 哔哩哔哩',
        author: 'UP 主',
        description: '简介',
        tags: ['知识', '教程', '知识'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        transcript: [{ start: 1, end: 3, text: '字幕内容' }]
      })
    ).toEqual({
      source: {
        title: '视频标题',
        author: 'UP 主',
        description: '简介',
        tags: ['知识', '教程'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note'
      },
      transcript: [{ start: 1, end: 3, text: '字幕内容' }],
      transcriptSource: 'auto'
    })
  })
})
```

- [ ] **Step 2: Run the extractor tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoNoteExtractor.test.ts
```

Expected: FAIL with an import error for `./videoNoteExtractor`.

- [ ] **Step 3: Implement extractor helpers**

Create `src/renderer/src/features/notes/videoNoteExtractor.ts`:

```ts
import type { TranscriptSegment, VideoNoteExtractionResult } from '@shared/types'

type RawSubtitleItem = {
  from?: number
  to?: number
  content?: string
}

type RawSubtitlePayload = {
  body?: RawSubtitleItem[]
}

type RawVideoNoteExtraction = {
  title?: string
  author?: string
  description?: string
  tags?: string[]
  bvid?: string
  url?: string
  transcript?: TranscriptSegment[]
}

const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniqueTags(tags: string[] = []): string[] {
  return Array.from(new Set(tags.map(cleanText).filter(Boolean))).slice(0, 20)
}

export function normalizeSubtitleBody(payload: RawSubtitlePayload): TranscriptSegment[] {
  return (payload.body ?? [])
    .map((item) => ({
      start: typeof item.from === 'number' ? item.from : null,
      end: typeof item.to === 'number' ? item.to : null,
      text: cleanText(item.content)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function normalizeExtractedVideoNoteResult(raw: RawVideoNoteExtraction): VideoNoteExtractionResult {
  const url = cleanText(raw.url) || 'about:blank'
  const title = cleanText(raw.title).replace(BILIBILI_TITLE_SUFFIX, '') || url

  return {
    source: {
      title,
      author: cleanText(raw.author),
      description: cleanText(raw.description),
      tags: uniqueTags(raw.tags),
      bvid: cleanText(raw.bvid),
      url
    },
    transcript: (raw.transcript ?? []).filter((segment) => cleanText(segment.text).length > 0),
    transcriptSource: (raw.transcript ?? []).length > 0 ? 'auto' : 'manual'
  }
}

export function buildVideoNoteExtractionScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const readMeta = (name) =>
        document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.getAttribute('content') || '';
      const textFrom = (selectors) =>
        selectors.map((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join(' '))
          .filter(Boolean)
          .join(' ');
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};
      const tags = Array.from(document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span'))
        .map((node) => clean(node.textContent))
        .filter(Boolean)
        .slice(0, 20);
      const subtitleCandidates = [
        ...(videoData.subtitle?.list || []),
        ...(initialState.subtitle?.list || []),
        ...(window.__playinfo__?.subtitle?.subtitles || [])
      ];
      const transcript = Array.from(document.querySelectorAll('.bpx-player-subtitle-panel-text,.subtitle-item,[class*="subtitle"]'))
        .map((node, index) => ({ start: null, end: null, text: clean(node.textContent), index }))
        .filter((item) => item.text);

      return {
        title: clean(document.querySelector('h1')?.textContent || videoData.title || document.title),
        author: clean(document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || ''),
        description: clean(readMeta('description') || textFrom(['.desc-info-text', '.video-desc', '[class*="desc"]'])),
        tags,
        bvid: clean(videoData.bvid || location.pathname.match(/BV[0-9A-Za-z]+/)?.[0] || ''),
        url: location.href,
        subtitleCandidates,
        transcript
      };
    })();
  `
}
```

- [ ] **Step 4: Run extractor tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoNoteExtractor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/renderer/src/features/notes/videoNoteExtractor.ts src/renderer/src/features/notes/videoNoteExtractor.test.ts
git commit -m "feat: add video note extraction helpers"
```

---

### Task 3: Transcript Cleaning and Manual Paste Parsing

**Files:**
- Create: `src/renderer/src/features/notes/transcriptNormalizer.ts`
- Test: `src/renderer/src/features/notes/transcriptNormalizer.test.ts`

- [ ] **Step 1: Write the failing transcript tests**

Create `src/renderer/src/features/notes/transcriptNormalizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeTranscriptSegments, parseManualTranscript } from './transcriptNormalizer'

describe('transcriptNormalizer', () => {
  it('removes blank and duplicate adjacent transcript segments', () => {
    expect(
      normalizeTranscriptSegments([
        { start: 0, end: 1, text: '  开始  ' },
        { start: 1, end: 2, text: '开始' },
        { start: 2, end: 3, text: '' },
        { start: 3, end: 4, text: '进入重点' }
      ])
    ).toEqual([
      { start: 0, end: 1, text: '开始' },
      { start: 3, end: 4, text: '进入重点' }
    ])
  })

  it('parses manual transcript paragraphs without timestamps', () => {
    expect(parseManualTranscript('第一段内容\\n\\n第二段内容')).toEqual([
      { start: null, end: null, text: '第一段内容' },
      { start: null, end: null, text: '第二段内容' }
    ])
  })

  it('parses manual timestamp lines when users paste subtitle-like text', () => {
    expect(parseManualTranscript('[00:12] 关键观点\\n01:05 第二个重点')).toEqual([
      { start: 12, end: null, text: '关键观点' },
      { start: 65, end: null, text: '第二个重点' }
    ])
  })
})
```

- [ ] **Step 2: Run transcript tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/transcriptNormalizer.test.ts
```

Expected: FAIL with an import error for `./transcriptNormalizer`.

- [ ] **Step 3: Implement transcript normalizer**

Create `src/renderer/src/features/notes/transcriptNormalizer.ts`:

```ts
import type { TranscriptSegment } from '@shared/types'

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseTimestamp(value: string): number | null {
  const match = value.match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(.*)$/)

  if (!match) {
    return null
  }

  const first = Number(match[1])
  const second = Number(match[2])
  const third = match[3] ? Number(match[3]) : null

  return third === null ? first * 60 + second : first * 3600 + second * 60 + third
}

function removeTimestamp(value: string): string {
  return value.replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/, '').trim()
}

export function normalizeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized: TranscriptSegment[] = []

  for (const segment of segments) {
    const text = cleanText(segment.text)

    if (!text || normalized.at(-1)?.text === text) {
      continue
    }

    normalized.push({
      start: segment.start,
      end: segment.end,
      text
    })
  }

  return normalized
}

export function parseManualTranscript(value: string): TranscriptSegment[] {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  return normalizeTranscriptSegments(
    lines.map((line) => ({
      start: parseTimestamp(line),
      end: null,
      text: cleanText(removeTimestamp(line))
    }))
  )
}
```

- [ ] **Step 4: Run transcript tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/notes/transcriptNormalizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/renderer/src/features/notes/transcriptNormalizer.ts src/renderer/src/features/notes/transcriptNormalizer.test.ts
git commit -m "feat: normalize video note transcripts"
```

---

### Task 4: Local Overview, Timeline, and Keywords

**Files:**
- Create: `src/renderer/src/features/notes/videoNoteSummarizer.ts`
- Test: `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`

- [ ] **Step 1: Write the failing summarizer tests**

Create `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createLocalVideoNoteDraft } from './videoNoteSummarizer'

describe('videoNoteSummarizer', () => {
  it('creates local overview, timeline, and keywords from transcript text', () => {
    const note = createLocalVideoNoteDraft({
      now: '2026-04-28T10:00:00.000Z',
      source: {
        title: '机器学习入门教程',
        author: 'UP 主',
        description: '从模型、训练、数据讲清楚机器学习',
        tags: ['教程', '机器学习'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note'
      },
      transcriptSource: 'auto',
      transcript: [
        { start: 0, end: 8, text: '机器学习需要数据和模型。' },
        { start: 10, end: 18, text: '训练过程会不断调整参数。' },
        { start: 85, end: 96, text: '最后用测试数据验证效果。' }
      ]
    })

    expect(note.id).toBe('bvid:BV1note')
    expect(note.overview.shortSummary.length).toBeGreaterThan(0)
    expect(note.overview.keywords).toContain('机器学习')
    expect(note.overview.timeline).toEqual([
      expect.objectContaining({ start: 0 }),
      expect.objectContaining({ start: 85 })
    ])
    expect(note.transcript).toHaveLength(3)
  })

  it('creates an empty-note explanation when no transcript exists', () => {
    const note = createLocalVideoNoteDraft({
      now: '2026-04-28T10:00:00.000Z',
      source: {
        title: '无字幕视频',
        tags: [],
        url: 'https://www.bilibili.com/video/BVempty'
      },
      transcriptSource: 'manual',
      transcript: []
    })

    expect(note.overview.shortSummary).toEqual(['尚未取得文稿，可粘贴文稿后再整理。'])
    expect(note.chapters).toEqual([])
  })
})
```

- [ ] **Step 2: Run summarizer tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoNoteSummarizer.test.ts
```

Expected: FAIL with an import error for `./videoNoteSummarizer`.

- [ ] **Step 3: Implement local summarizer**

Create `src/renderer/src/features/notes/videoNoteSummarizer.ts`:

```ts
import { createVideoNoteId } from '@shared/videoNotes'
import type {
  TranscriptChapter,
  TranscriptSegment,
  VideoNote,
  VideoNoteOverview,
  VideoNoteSourceMetadata,
  VideoNoteTimelineItem
} from '@shared/types'
import { normalizeTranscriptSegments } from './transcriptNormalizer'

type CreateLocalVideoNoteDraftInput = {
  now: string
  source: VideoNoteSourceMetadata
  transcriptSource: 'auto' | 'manual'
  transcript: TranscriptSegment[]
  userMemo?: string
}

const STOP_WORDS = new Set(['这个', '然后', '就是', '我们', '你们', '他们', '一个', '一些', '以及', '因为', '所以'])

function splitTextWords(value: string): string[] {
  return Array.from(value.matchAll(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,6}/g)).map((match) => match[0])
}

function extractKeywords(source: VideoNoteSourceMetadata, transcript: TranscriptSegment[]): string[] {
  const scores = new Map<string, number>()
  const weightedText = [source.title, source.description, ...(source.tags ?? []), ...transcript.map((segment) => segment.text)].join(' ')

  for (const word of splitTextWords(weightedText)) {
    if (STOP_WORDS.has(word)) {
      continue
    }

    scores.set(word, (scores.get(word) ?? 0) + (source.title.includes(word) || source.tags.includes(word) ? 3 : 1))
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([word]) => word)
}

function createChapters(transcript: TranscriptSegment[]): TranscriptChapter[] {
  if (transcript.length === 0) {
    return []
  }

  const chapters: TranscriptChapter[] = []
  let currentIndexes: number[] = []
  let currentStart = transcript[0].start

  transcript.forEach((segment, index) => {
    const previous = transcript[index - 1]
    const gap = previous?.end !== null && segment.start !== null && previous?.end !== undefined ? segment.start - previous.end : 0

    if (currentIndexes.length > 0 && (gap > 45 || currentIndexes.length >= 6)) {
      const firstIndex = currentIndexes[0]
      const firstSegment = transcript[firstIndex]
      chapters.push({
        start: currentStart,
        title: firstSegment.text.slice(0, 18),
        summary: transcript[currentIndexes[0]].text,
        segmentIndexes: currentIndexes
      })
      currentIndexes = []
      currentStart = segment.start
    }

    currentIndexes.push(index)
  })

  if (currentIndexes.length > 0) {
    const firstSegment = transcript[currentIndexes[0]]
    chapters.push({
      start: currentStart,
      title: firstSegment.text.slice(0, 18),
      summary: firstSegment.text,
      segmentIndexes: currentIndexes
    })
  }

  return chapters
}

function createOverview(chapters: TranscriptChapter[], keywords: string[]): VideoNoteOverview {
  if (chapters.length === 0) {
    return {
      shortSummary: ['尚未取得文稿，可粘贴文稿后再整理。'],
      keywords,
      timeline: [],
      highlights: []
    }
  }

  const timeline: VideoNoteTimelineItem[] = chapters.map((chapter) => ({
    start: chapter.start,
    title: chapter.title,
    detail: chapter.summary
  }))

  return {
    shortSummary: chapters.slice(0, 5).map((chapter) => chapter.summary),
    keywords,
    timeline,
    highlights: timeline.slice(0, 3)
  }
}

export function createLocalVideoNoteDraft(input: CreateLocalVideoNoteDraftInput): VideoNote {
  const transcript = normalizeTranscriptSegments(input.transcript)
  const chapters = createChapters(transcript)
  const keywords = extractKeywords(input.source, transcript)
  const overview = createOverview(chapters, keywords)

  return {
    id: createVideoNoteId(input.source),
    source: input.source,
    transcriptSource: input.transcriptSource,
    transcript,
    chapters,
    overview,
    userMemo: input.userMemo ?? '',
    createdAt: input.now,
    updatedAt: input.now
  }
}
```

- [ ] **Step 4: Run summarizer tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoNoteSummarizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/renderer/src/features/notes/videoNoteSummarizer.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts
git commit -m "feat: summarize video notes locally"
```

---

### Task 5: Local Video Note Store and Desktop IPC

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Write failing store tests**

Append to `electron/main/store.test.ts`:

```ts
import { loadVideoNotes, saveVideoNote } from './store'
import type { VideoNote } from '../../src/shared/types'

function createStoreNote(id = 'bvid:BV1store'): VideoNote {
  return {
    id,
    source: {
      title: '札记',
      bvid: id.replace('bvid:', ''),
      url: 'https://www.bilibili.com/video/BV1store',
      tags: []
    },
    transcriptSource: 'auto',
    transcript: [],
    chapters: [],
    overview: {
      shortSummary: ['摘要'],
      keywords: [],
      timeline: [],
      highlights: []
    },
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z'
  }
}

describe('video note store helpers', () => {
  it('loads an empty video note list by default', () => {
    const store = createFakeStore()

    expect(loadVideoNotes(store)).toEqual([])
  })

  it('saves and updates video notes by stable id', () => {
    const store = createFakeStore()
    const first = createStoreNote()
    const second = {
      ...first,
      userMemo: '更新备注',
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z'
    }

    expect(saveVideoNote(store, first)).toEqual([first])
    expect(saveVideoNote(store, second)).toEqual([
      {
        ...second,
        createdAt: first.createdAt
      }
    ])
  })
})
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```bash
npm run test -- electron/main/store.test.ts
```

Expected: FAIL with missing `loadVideoNotes` and `saveVideoNote` exports.

- [ ] **Step 3: Extend store types and helpers**

Modify `electron/main/store.ts`:

```ts
import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import { upsertVideoNote } from '../../src/shared/videoNotes'
import type { FavoriteLedger, VideoNote } from '../../src/shared/types'

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  preferenceCounts: Record<string, number>
}

export type DesktopStoreState = AssistantPreferences & {
  videoNotes: VideoNote[]
}

export type AssistantStoreLike = {
  get<Key extends keyof DesktopStoreState>(key: Key): DesktopStoreState[Key]
  set<Key extends keyof DesktopStoreState>(key: Key, value: DesktopStoreState[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 内库',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
  preferenceCounts: {}
}

export const DEFAULT_DESKTOP_STORE_STATE: DesktopStoreState = {
  ...DEFAULT_ASSISTANT_PREFERENCES,
  videoNotes: []
}

let desktopStore: Store<DesktopStoreState> | undefined

export function getDesktopStore(): Store<DesktopStoreState> {
  if (!desktopStore) {
    desktopStore = new Store<DesktopStoreState>({
      defaults: DEFAULT_DESKTOP_STORE_STATE
    })
  }

  return desktopStore
}

export function loadAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore()
): AssistantPreferences {
  return {
    favoritesFolderName: store.get('favoritesFolderName'),
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    ledgerPromptDismissed: Boolean(store.get('ledgerPromptDismissed')),
    preferenceCounts: store.get('preferenceCounts') ?? {}
  }
}

export function saveAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  preferences: AssistantPreferences = DEFAULT_ASSISTANT_PREFERENCES
): AssistantPreferences {
  store.set('favoritesFolderName', preferences.favoritesFolderName)
  store.set('favoriteLedgers', normalizeFavoriteLedgers(preferences.favoriteLedgers))
  store.set('ledgerPromptDismissed', Boolean(preferences.ledgerPromptDismissed))
  store.set('preferenceCounts', preferences.preferenceCounts ?? {})

  return loadAssistantPreferences(store)
}

export function loadVideoNotes(store: AssistantStoreLike = getDesktopStore()): VideoNote[] {
  return store.get('videoNotes') ?? []
}

export function saveVideoNote(
  store: AssistantStoreLike = getDesktopStore(),
  note: VideoNote
): VideoNote[] {
  const notes = upsertVideoNote(loadVideoNotes(store), note)

  store.set('videoNotes', notes)

  return notes
}
```

Update `createFakeStore()` in `electron/main/store.test.ts` so its snapshot includes `videoNotes: initial.videoNotes ?? []`, and update its type import to use `DesktopStoreState`.

- [ ] **Step 4: Add IPC handlers and preload APIs**

Modify `electron/main/index.ts` imports:

```ts
import {
  getDesktopStore,
  loadAssistantPreferences,
  loadVideoNotes,
  saveAssistantPreferences,
  saveVideoNote,
  type AssistantPreferences
} from './store'
import type { VideoNote } from '../../src/shared/types'
```

Add handlers inside `registerAssistantPreferenceHandlers()`:

```ts
  ipcMain.handle('video-notes:load', () => loadVideoNotes(getDesktopStore()))
  ipcMain.handle('video-notes:save', (_event, note: VideoNote) =>
    saveVideoNote(getDesktopStore(), note)
  )
```

Modify `electron/preload/index.ts`:

```ts
import type { VideoNote } from '../../src/shared/types'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadVideoNotes: () => ipcRenderer.invoke('video-notes:load') as Promise<VideoNote[]>,
  onOpenInTab: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)

    ipcRenderer.on('browser:open-in-tab', listener)

    return () => {
      ipcRenderer.removeListener('browser:open-in-tab', listener)
    }
  },
  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>
})
```

Modify `src/renderer/src/global.d.ts`:

```ts
import type { AssistantPreferences, VideoNote } from '@shared/types'

type BilimiDesktopApi = {
  version: string
  loadPreferences: () => Promise<AssistantPreferences>
  loadVideoNotes?: () => Promise<VideoNote[]>
  onOpenInTab?: (callback: (url: string) => void) => () => void
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
}
```

- [ ] **Step 5: Run store tests to verify they pass**

Run:

```bash
npm run test -- electron/main/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add electron/main/store.ts electron/main/store.test.ts electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat: persist local video notes"
```

---

### Task 6: Video Notes Panel UI

**Files:**
- Create: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Test: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoNotesPanel } from './VideoNotesPanel'
import type { VideoNote } from '@shared/types'

function createRenderedNote(): VideoNote {
  return {
    id: 'bvid:BV1note',
    source: {
      title: '机器学习入门教程',
      author: 'UP 主',
      tags: ['教程'],
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note'
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 5, text: '机器学习需要数据和模型。' }],
    chapters: [{ start: 0, title: '机器学习需要数据', summary: '机器学习需要数据和模型。', segmentIndexes: [0] }],
    overview: {
      shortSummary: ['机器学习需要数据和模型。'],
      keywords: ['机器学习', '数据'],
      timeline: [{ start: 0, title: '机器学习需要数据', detail: '机器学习需要数据和模型。' }],
      highlights: [{ start: 0, title: '机器学习需要数据', detail: '机器学习需要数据和模型。' }]
    },
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z'
  }
}

describe('VideoNotesPanel', () => {
  it('starts note generation when the user asks to organize notes', async () => {
    const onGenerate = vi.fn().mockResolvedValue(createRenderedNote())

    render(<VideoNotesPanel note={null} isLoading={false} onGenerate={onGenerate} onSave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(undefined))
  })

  it('renders overview, transcript, and archive tabs for a generated note', () => {
    render(<VideoNotesPanel note={createRenderedNote()} isLoading={false} onGenerate={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByText('机器学习需要数据和模型。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '文稿' }))
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('机器学习需要数据和模型。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '归档' }))
    expect(screen.getByText('BV1note')).toBeInTheDocument()
    expect(screen.getByText('UP 主')).toBeInTheDocument()
  })

  it('passes pasted manual transcript to note generation', async () => {
    const onGenerate = vi.fn().mockResolvedValue(createRenderedNote())

    render(<VideoNotesPanel note={null} isLoading={false} onGenerate={onGenerate} onSave={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('粘贴文稿'), {
      target: { value: '第一段文稿' }
    })
    fireEvent.click(screen.getByRole('button', { name: '整理粘贴文稿' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('第一段文稿'))
  })
})
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: FAIL with an import error for `./VideoNotesPanel`.

- [ ] **Step 3: Implement `VideoNotesPanel`**

Create `src/renderer/src/features/notes/VideoNotesPanel.tsx`:

```tsx
import type { VideoNote } from '@shared/types'
import { useState } from 'react'

type VideoNotesPanelProps = {
  note: VideoNote | null
  isLoading: boolean
  onGenerate: (manualTranscript?: string) => Promise<VideoNote | null>
  onSave: (note: VideoNote) => Promise<void>
}

type NoteTab = 'overview' | 'transcript' | 'archive'

function formatTimestamp(value: number | null): string {
  if (value === null) {
    return '--:--'
  }

  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function VideoNotesPanel({ note, isLoading, onGenerate, onSave }: VideoNotesPanelProps) {
  const [activeTab, setActiveTab] = useState<NoteTab>('overview')
  const [manualTranscript, setManualTranscript] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  async function saveCurrentNote() {
    if (!note) {
      return
    }

    await onSave(note)
    setSaveMessage('札记已归档')
  }

  return (
    <section className="video-notes" aria-label="视频札记">
      <div className="video-notes__toolbar">
        <button type="button" onClick={() => void onGenerate(undefined)} disabled={isLoading}>
          {isLoading ? '整理中' : '整理札记'}
        </button>
        {note ? (
          <button type="button" onClick={() => void saveCurrentNote()}>
            保存札记
          </button>
        ) : null}
      </div>

      {!note ? (
        <div className="video-notes__manual">
          <label htmlFor="manual-transcript">粘贴文稿</label>
          <textarea
            id="manual-transcript"
            value={manualTranscript}
            onChange={(event) => setManualTranscript(event.target.value)}
          />
          <button type="button" onClick={() => void onGenerate(manualTranscript)} disabled={!manualTranscript.trim()}>
            整理粘贴文稿
          </button>
        </div>
      ) : (
        <>
          <div className="video-notes__tabs" role="tablist" aria-label="札记页签">
            {[
              ['overview', '速览'],
              ['transcript', '文稿'],
              ['archive', '归档']
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id as NoteTab)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' ? (
            <div className="video-notes__content">
              {note.overview.shortSummary.map((summary) => (
                <p key={summary}>{summary}</p>
              ))}
              <ul>
                {note.overview.timeline.map((item) => (
                  <li key={`${item.start}:${item.title}`}>
                    <strong>{formatTimestamp(item.start)}</strong> {item.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {activeTab === 'transcript' ? (
            <div className="video-notes__content">
              {note.transcript.map((segment, index) => (
                <p key={`${segment.start}:${index}`}>
                  <strong>{formatTimestamp(segment.start)}</strong> {segment.text}
                </p>
              ))}
            </div>
          ) : null}

          {activeTab === 'archive' ? (
            <div className="video-notes__content">
              <p>{note.source.title}</p>
              <p>{note.source.author}</p>
              <p>{note.source.bvid}</p>
              <p>{note.source.url}</p>
              {saveMessage ? <p role="status">{saveMessage}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx
git commit -m "feat: add video notes panel"
```

---

### Task 7: Assistant Overlay and Active Webview Integration

**Files:**
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing App integration tests**

Append to `src/renderer/src/App.test.tsx`:

```tsx
  it('extracts the active video page and renders local video notes', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValue({
      title: '机器学习入门教程 - 哔哩哔哩',
      author: 'UP 主',
      description: '从模型、训练、数据讲清楚机器学习',
      tags: ['教程', '机器学习'],
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      transcript: [
        { start: 0, end: 8, text: '机器学习需要数据和模型。' },
        { start: 10, end: 18, text: '训练过程会不断调整参数。' }
      ]
    })
    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '展开批阅' }))
    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('subtitle'), true))
    expect(await screen.findByText('机器学习需要数据和模型。')).toBeInTheDocument()
  })

  it('saves a generated video note through the desktop API', async () => {
    const saveVideoNote = vi.fn().mockResolvedValue([])

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences: vi.fn(),
        savePreferences: vi.fn(),
        saveVideoNote
      }
    })

    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: '机器学习入门教程',
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        tags: [],
        transcript: [{ start: 0, end: 8, text: '机器学习需要数据和模型。' }]
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '展开批阅' }))
    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存札记' }))

    await waitFor(() => expect(saveVideoNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'bvid:BV1note' })))
  })
```

- [ ] **Step 2: Run App tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/App.test.tsx
```

Expected: FAIL because the `札记` tab and note workflow are not wired.

- [ ] **Step 3: Add note props and tabs to `MemorialPanel`**

Modify `src/renderer/src/features/assistant/MemorialPanel.tsx`:

```tsx
import type { AssistantAction, RecommendationLabel, VideoNote } from '@shared/types'
import { useState } from 'react'
import { VideoNotesPanel } from '../notes/VideoNotesPanel'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  videoCategory?: string
  videoTitle: string
  onAction: (action: AssistantAction) => void
  onClose: () => void
  onGenerateVideoNote: (manualTranscript?: string) => Promise<VideoNote | null>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  videoNote: VideoNote | null
  videoNoteLoading: boolean
  runningAction?: AssistantAction | null
  feedback?: {
    tone: 'progress' | 'success' | 'error'
    message: string
    steps: string[]
    missingTargets: string[]
  } | null
}
```

Inside the component, add state and render tabs:

```tsx
  const [activePanelTab, setActivePanelTab] = useState<'review' | 'notes'>('review')
```

Place this before `memorial-panel__body`:

```tsx
        <div className="memorial-panel__tabs" role="tablist" aria-label="奏折页签">
          <button type="button" role="tab" aria-selected={activePanelTab === 'review'} onClick={() => setActivePanelTab('review')}>
            批阅
          </button>
          <button type="button" role="tab" aria-selected={activePanelTab === 'notes'} onClick={() => setActivePanelTab('notes')}>
            札记
          </button>
        </div>
```

Render the existing body only when `activePanelTab === 'review'`, and render this when `activePanelTab === 'notes'`:

```tsx
          <VideoNotesPanel
            note={videoNote}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onSave={onSaveVideoNote}
          />
```

- [ ] **Step 4: Wire note generation in `AssistantOverlay`**

Modify imports in `src/renderer/src/features/assistant/AssistantOverlay.tsx`:

```ts
import type {
  AssistantAction,
  AssistantPreferences,
  RecommendationKind,
  VideoNote,
  VideoNoteExtractionResult,
  VisualAutomationFallback
} from '@shared/types'
import { createLocalVideoNoteDraft } from '../notes/videoNoteSummarizer'
import { normalizeExtractedVideoNoteResult } from '../notes/videoNoteExtractor'
import { parseManualTranscript } from '../notes/transcriptNormalizer'
```

Add props:

```ts
  readVideoNoteSource?: () => Promise<VideoNoteExtractionResult | null>
  saveVideoNote?: (note: VideoNote) => Promise<void>
```

Add state:

```ts
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
```

Add handlers:

```ts
  async function generateVideoNote(manualTranscript?: string) {
    setVideoNoteLoading(true)

    try {
      const extraction = manualTranscript
        ? {
            source: {
              title: resolvedVideoTitle,
              tags: [],
              url: ''
            },
            transcript: parseManualTranscript(manualTranscript),
            transcriptSource: 'manual' as const
          }
        : await readVideoNoteSource?.()

      if (!extraction) {
        return null
      }

      const safeExtraction = normalizeExtractedVideoNoteResult({
        ...extraction.source,
        transcript: extraction.transcript
      })
      const note = createLocalVideoNoteDraft({
        now: new Date().toISOString(),
        source: safeExtraction.source,
        transcript: manualTranscript ? parseManualTranscript(manualTranscript) : safeExtraction.transcript,
        transcriptSource: manualTranscript ? 'manual' : safeExtraction.transcriptSource
      })

      setVideoNote(note)
      return note
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function persistVideoNote(note: VideoNote) {
    await saveVideoNote?.(note)
  }
```

Pass these props to `MemorialPanel`:

```tsx
              onGenerateVideoNote={generateVideoNote}
              onSaveVideoNote={persistVideoNote}
              videoNote={videoNote}
              videoNoteLoading={videoNoteLoading}
```

- [ ] **Step 5: Wire extraction and save callbacks in `App`**

Modify imports in `src/renderer/src/App.tsx`:

```ts
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult
} from './features/notes/videoNoteExtractor'
import type { VideoNote, VideoNoteExtractionResult } from '@shared/types'
```

Add:

```ts
  async function readVideoNoteSource(): Promise<VideoNoteExtractionResult | null> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return null
    }

    const raw = await currentActiveWebview.executeJavaScript(
      buildVideoNoteExtractionScript(),
      true
    )

    return normalizeExtractedVideoNoteResult(raw as Parameters<typeof normalizeExtractedVideoNoteResult>[0])
  }

  async function saveVideoNote(note: VideoNote) {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }
```

Pass to `AssistantOverlay`:

```tsx
        readVideoNoteSource={readVideoNoteSource}
        saveVideoNote={saveVideoNote}
```

- [ ] **Step 6: Add compact CSS**

Append to `src/renderer/src/styles.css`:

```css
.memorial-panel__tabs,
.video-notes__tabs,
.video-notes__toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.memorial-panel__tabs button,
.video-notes__tabs button,
.video-notes__toolbar button,
.video-notes__manual button {
  border: 1px solid rgba(113, 81, 48, 0.28);
  background: #fbf4e8;
  color: #5b3d25;
  font: 12px "Noto Serif SC", "Songti SC", "SimSun", serif;
  padding: 4px 7px;
  cursor: pointer;
}

.memorial-panel__tabs button[aria-selected="true"],
.video-notes__tabs button[aria-selected="true"] {
  background: #743720;
  color: #f7ead4;
}

.video-notes {
  color: #4b3321;
  font-size: 12px;
  line-height: 1.45;
}

.video-notes__manual {
  display: grid;
  gap: 6px;
}

.video-notes__manual textarea {
  min-height: 72px;
  resize: vertical;
  border: 1px solid rgba(113, 81, 48, 0.28);
  background: #fff9ed;
  color: #3d2819;
  font: 12px "Noto Serif SC", "Songti SC", "SimSun", serif;
}

.video-notes__content {
  display: grid;
  gap: 6px;
}

.video-notes__content p,
.video-notes__content ul {
  margin: 0;
}

.video-notes__content ul {
  padding-left: 18px;
}
```

- [ ] **Step 7: Run App tests to verify they pass**

Run:

```bash
npm run test -- src/renderer/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/styles.css
git commit -m "feat: wire video notes into assistant panel"
```

---

### Task 8: Final Verification

**Files:**
- No new files.
- Verify all files touched by Tasks 1 through 7.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run a production build**

Run:

```bash
npm run build
```

Expected: Electron Vite build completes without TypeScript errors.

- [ ] **Step 3: Manually smoke test the desktop app**

Run:

```bash
npm run dev
```

Expected:

1. App opens Bilibili home in the embedded browser.
2. The seal opens the memorial panel.
3. The panel has `批阅` and `札记` tabs.
4. `札记` can render the manual paste fallback.
5. On a video page with available transcript text in the DOM, `整理札记` shows overview and transcript.
6. `保存札记` calls the desktop save path without crashing.

- [ ] **Step 4: Commit any verification-only fixes**

If verification reveals small fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize video notes verification"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

1. Current video metadata extraction is covered in Task 2 and wired in Task 7.
2. Available transcript extraction and normalization are covered in Tasks 2 and 3.
3. Manual paste fallback is covered in Tasks 3, 6, and 7.
4. Local-only overview generation is covered in Task 4.
5. Local persistence is covered in Task 5.
6. Memorial-panel tab UI is covered in Tasks 6 and 7.
7. Full test and build verification is covered in Task 8.

Placeholder scan:

1. This plan contains no deferred implementation placeholders.
2. Each task includes exact files, tests, commands, expected failures, implementation snippets, and commits.

Type consistency:

1. `VideoNote`, `TranscriptSegment`, `VideoNoteOverview`, and `VideoNoteExtractionResult` are defined in Task 1 and reused consistently.
2. Store APIs use `VideoNote[]` and single-note `saveVideoNote(note)` throughout main, preload, and renderer.
3. Renderer generation consistently uses `VideoNoteExtractionResult` before creating a `VideoNote` draft.
