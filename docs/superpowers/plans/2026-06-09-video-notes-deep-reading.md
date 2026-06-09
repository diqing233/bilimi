# Video Notes Deep Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add current-video deep reading to Bilimi video notes: timestamp annotations, seek-back controls, memo persistence, and Markdown export.

**Architecture:** Keep pure data and formatting logic in small testable modules, then wire it into the existing assistant runtime and `VideoNotesPanel`. The active webview remains the only place that reads or changes Bilibili playback time; the floating assistant reaches it through the existing main-window runtime bridge.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, Testing Library, existing Electron webview runtime bridge.

---

## File Structure

- Modify `src/shared/types.ts`: add `VideoNoteAnnotation` and `VideoNote.annotations`.
- Modify `src/shared/videoNotes.ts`: normalize legacy notes and preserve annotations in upserts.
- Modify `src/shared/videoNotes.test.ts`: cover annotation compatibility.
- Modify `src/renderer/src/features/notes/videoNoteSummarizer.ts`: create new notes with `annotations: []`.
- Modify `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`: assert new notes include empty annotations.
- Create `src/renderer/src/features/notes/videoNoteMarkdown.ts`: pure Markdown formatter.
- Create `src/renderer/src/features/notes/videoNoteMarkdown.test.ts`: formatter tests.
- Create `src/renderer/src/features/notes/videoNoteAnnotations.ts`: pure annotation helpers.
- Create `src/renderer/src/features/notes/videoNoteAnnotations.test.ts`: add/edit/delete/sort tests.
- Create `src/renderer/src/features/notes/videoNoteTimeAutomation.ts`: webview scripts for read/seek current video time.
- Create `src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts`: script tests in jsdom.
- Modify `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`: add time read/seek requests.
- Modify `src/renderer/src/App.tsx`: handle time read/seek runtime requests against active webview.
- Modify `src/renderer/src/App.test.tsx`: verify runtime time read/seek behavior.
- Modify `electron/main/index.ts`: expose floating assistant IPC handlers for time read/seek.
- Modify `electron/preload/index.ts`: expose `getCurrentVideoTime` and `seekVideoTime`.
- Modify `src/renderer/src/global.d.ts`: type the new desktop bridge methods.
- Modify `src/renderer/src/features/assistant/MemorialPanel.tsx`: pass note update/time callbacks into `VideoNotesPanel`.
- Modify `src/renderer/src/features/assistant/AssistantOverlay.tsx`: keep updated notes in local state and provide main-window time callbacks.
- Modify `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: provide floating time callbacks through desktop APIs.
- Modify `src/renderer/src/features/notes/VideoNotesPanel.tsx`: add `批注` and `导出` tabs, local editing controls, memo editing, Markdown copy.
- Modify `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`: cover UI behavior.
- Modify `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`: cover floating bridge integration.
- Modify `src/renderer/src/styles.css`: compact styles for annotation forms and Markdown preview.

---

### Task 1: Shared Annotation Model And Legacy Compatibility

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/videoNotes.ts`
- Modify: `src/shared/videoNotes.test.ts`
- Modify: `src/renderer/src/features/notes/videoNoteSummarizer.ts`
- Modify: `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`

- [ ] **Step 1: Write failing shared-model tests**

Add to `src/shared/videoNotes.test.ts`:

```ts
import { createVideoNoteId, normalizeVideoNote, upsertVideoNote } from './videoNotes'
import type { VideoNote, VideoNoteAnnotation } from './types'

const sampleAnnotation: VideoNoteAnnotation = {
  id: 'annotation-1',
  start: 75,
  title: '数据质量',
  body: '这一段解释了训练数据为什么重要。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

it('normalizes legacy notes with an empty annotations list', () => {
  const legacyNote = createNote()
  delete (legacyNote as Partial<VideoNote>).annotations

  expect(normalizeVideoNote(legacyNote as VideoNote).annotations).toEqual([])
})

it('keeps annotations when updating an existing note', () => {
  const existing = createNote({ annotations: [sampleAnnotation] })
  const updated = createNote({
    id: existing.id,
    annotations: [
      {
        ...sampleAnnotation,
        id: 'annotation-2',
        title: '模型上限'
      }
    ],
    updatedAt: '2026-06-09T01:00:00.000Z'
  })

  expect(upsertVideoNote([existing], updated)).toEqual([
    {
      ...updated,
      createdAt: existing.createdAt
    }
  ])
})
```

Update the existing `createNote()` helper in that test file so returned notes include:

```ts
annotations: [],
```

Add to `src/renderer/src/features/notes/videoNoteSummarizer.test.ts`:

```ts
expect(note.annotations).toEqual([])
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts
```

Expected: FAIL because `VideoNoteAnnotation`, `VideoNote.annotations`, or `normalizeVideoNote` does not exist yet.

- [ ] **Step 3: Implement model and compatibility**

In `src/shared/types.ts`, add:

```ts
export type VideoNoteAnnotation = {
  id: string
  start: number | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
}
```

Add this field to `VideoNote`:

```ts
annotations: VideoNoteAnnotation[]
```

In `src/shared/videoNotes.ts`, update imports and add normalization:

```ts
import type { VideoNote, VideoNoteSourceMetadata } from './types'

export function normalizeVideoNote(note: VideoNote): VideoNote {
  return {
    ...note,
    annotations: Array.isArray(note.annotations) ? note.annotations : []
  }
}

export function normalizeVideoNotes(notes: VideoNote[]): VideoNote[] {
  return notes.map(normalizeVideoNote)
}
```

Update `upsertVideoNote`:

```ts
export function upsertVideoNote(notes: VideoNote[], nextNote: VideoNote): VideoNote[] {
  const normalizedNextNote = normalizeVideoNote(nextNote)
  const existingNote = notes.find((note) => note.id === normalizedNextNote.id)

  if (!existingNote) {
    return [...normalizeVideoNotes(notes), normalizedNextNote]
  }

  return normalizeVideoNotes(notes).map((note) =>
    note.id === normalizedNextNote.id
      ? {
          ...normalizedNextNote,
          createdAt: note.createdAt
        }
      : note
  )
}
```

In `src/renderer/src/features/notes/videoNoteSummarizer.ts`, add to the returned `VideoNote`:

```ts
annotations: [],
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm test -- src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/videoNotes.ts src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts
git commit -m "feat: add video note annotations model"
```

---

### Task 2: Markdown Export Formatter

**Files:**
- Create: `src/renderer/src/features/notes/videoNoteMarkdown.ts`
- Create: `src/renderer/src/features/notes/videoNoteMarkdown.test.ts`

- [ ] **Step 1: Write failing Markdown tests**

Create `src/renderer/src/features/notes/videoNoteMarkdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { VideoNote } from '@shared/types'
import { createVideoNoteMarkdown } from './videoNoteMarkdown'

const note: VideoNote = {
  id: 'bvid:BV1note',
  source: {
    title: '机器学习入门',
    author: '李老师',
    tags: ['AI', '模型'],
    bvid: 'BV1note',
    url: 'https://www.bilibili.com/video/BV1note'
  },
  transcriptSource: 'auto',
  transcript: [
    { start: 0, end: 12, text: '先介绍机器学习的基本概念。' },
    { start: 75, end: 120, text: '再说明训练数据如何影响模型。' }
  ],
  chapters: [],
  overview: {
    shortSummary: ['三分钟讲清机器学习的基本思路。'],
    keywords: ['机器学习', '训练数据'],
    timeline: [{ start: 75, title: '数据', detail: '说明数据质量的重要性。' }],
    highlights: [{ start: 75, title: '核心提示', detail: '训练数据决定模型上限。' }]
  },
  annotations: [
    {
      id: 'annotation-1',
      start: 75,
      title: '这里要复看',
      body: '数据质量这一点可以写进报告。',
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z'
    }
  ],
  userMemo: '这条适合周会分享。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T01:00:00.000Z'
}

describe('createVideoNoteMarkdown', () => {
  it('exports source, overview, annotations, transcript, and memo', () => {
    const markdown = createVideoNoteMarkdown(note)

    expect(markdown).toContain('# 机器学习入门')
    expect(markdown).toContain('- UP：李老师')
    expect(markdown).toContain('- BV：BV1note')
    expect(markdown).toContain('## 速览')
    expect(markdown).toContain('- 三分钟讲清机器学习的基本思路。')
    expect(markdown).toContain('## 时间线')
    expect(markdown).toContain('- [01:15] 数据：说明数据质量的重要性。')
    expect(markdown).toContain('## 批注')
    expect(markdown).toContain('- [01:15] **这里要复看**：数据质量这一点可以写进报告。')
    expect(markdown).toContain('## 文稿')
    expect(markdown).toContain('- [00:00] 先介绍机器学习的基本概念。')
    expect(markdown).toContain('## 备注')
    expect(markdown).toContain('这条适合周会分享。')
  })

  it('keeps export readable when optional fields are missing', () => {
    const markdown = createVideoNoteMarkdown({
      ...note,
      source: { title: '无 BV 视频', tags: [], url: 'https://example.test/video' },
      annotations: [],
      userMemo: ''
    })

    expect(markdown).toContain('- UP：未署名')
    expect(markdown).toContain('- BV：未识别')
    expect(markdown).toContain('暂无批注。')
    expect(markdown).toContain('暂无备注。')
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteMarkdown.test.ts
```

Expected: FAIL because `videoNoteMarkdown.ts` does not exist.

- [ ] **Step 3: Implement formatter**

Create `src/renderer/src/features/notes/videoNoteMarkdown.ts`:

```ts
import type { VideoNote, VideoNoteTimelineItem, TranscriptSegment } from '@shared/types'

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) {
    return '--:--'
  }

  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

function listOrEmpty(items: string[], emptyText: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : emptyText
}

function timelineItems(items: VideoNoteTimelineItem[], emptyText: string): string {
  if (items.length === 0) {
    return emptyText
  }

  return items
    .map((item) => `- [${formatTimestamp(item.start)}] ${item.title}：${item.detail}`)
    .join('\n')
}

function transcriptItems(items: TranscriptSegment[]): string {
  if (items.length === 0) {
    return '暂无文稿。'
  }

  return items
    .map((segment) => `- [${formatTimestamp(segment.start)}] ${segment.text}`)
    .join('\n')
}

export function createVideoNoteMarkdown(note: VideoNote): string {
  const annotations = note.annotations ?? []
  const annotationText =
    annotations.length > 0
      ? annotations
          .map((annotation) => {
            const title = annotation.title.trim() || '未命名批注'
            const body = annotation.body.trim()
            return `- [${formatTimestamp(annotation.start)}] **${title}**${body ? `：${body}` : ''}`
          })
          .join('\n')
      : '暂无批注。'

  return [
    `# ${note.source.title}`,
    '',
    `- UP：${note.source.author ?? '未署名'}`,
    `- BV：${note.source.bvid ?? '未识别'}`,
    `- 链接：${note.source.url}`,
    `- 整理时间：${note.updatedAt}`,
    '',
    '## 速览',
    '',
    listOrEmpty(note.overview.shortSummary, '暂无速览。'),
    '',
    note.overview.keywords.length > 0 ? `关键词：${note.overview.keywords.join('、')}` : '关键词：暂无',
    '',
    '## 时间线',
    '',
    timelineItems(note.overview.timeline, '暂无时间线。'),
    '',
    '## 高光',
    '',
    timelineItems(note.overview.highlights, '暂无高光片段。'),
    '',
    '## 批注',
    '',
    annotationText,
    '',
    '## 文稿',
    '',
    transcriptItems(note.transcript),
    '',
    '## 备注',
    '',
    note.userMemo.trim() || '暂无备注。'
  ].join('\n')
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/src/features/notes/videoNoteMarkdown.ts src/renderer/src/features/notes/videoNoteMarkdown.test.ts
git commit -m "feat: export video notes as markdown"
```

---

### Task 3: Annotation Helper Functions

**Files:**
- Create: `src/renderer/src/features/notes/videoNoteAnnotations.ts`
- Create: `src/renderer/src/features/notes/videoNoteAnnotations.test.ts`

- [ ] **Step 1: Write failing annotation helper tests**

Create `src/renderer/src/features/notes/videoNoteAnnotations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { VideoNote, VideoNoteAnnotation } from '@shared/types'
import {
  removeVideoNoteAnnotation,
  saveVideoNoteAnnotation,
  sortVideoNoteAnnotations
} from './videoNoteAnnotations'

const baseNote: VideoNote = {
  id: 'bvid:BV1note',
  source: { title: '札记视频', tags: [], bvid: 'BV1note', url: 'https://example.test' },
  transcriptSource: 'auto',
  transcript: [],
  chapters: [],
  overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
  annotations: [],
  userMemo: '',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

const annotation: VideoNoteAnnotation = {
  id: 'annotation-1',
  start: 90,
  title: '重点',
  body: '这段要复看。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

describe('video note annotations', () => {
  it('adds annotations and sorts timed notes before untimed notes', () => {
    const note = saveVideoNoteAnnotation(
      { ...baseNote, annotations: [{ ...annotation, id: 'annotation-2', start: null }] },
      annotation,
      '2026-06-09T01:00:00.000Z'
    )

    expect(note.annotations.map((item) => item.id)).toEqual(['annotation-1', 'annotation-2'])
    expect(note.updatedAt).toBe('2026-06-09T01:00:00.000Z')
  })

  it('updates an existing annotation and preserves createdAt', () => {
    const note = saveVideoNoteAnnotation(
      { ...baseNote, annotations: [annotation] },
      { ...annotation, title: '更新后的重点', body: '新的正文' },
      '2026-06-09T02:00:00.000Z'
    )

    expect(note.annotations[0]).toEqual({
      ...annotation,
      title: '更新后的重点',
      body: '新的正文',
      updatedAt: '2026-06-09T02:00:00.000Z'
    })
    expect(note.annotations[0].createdAt).toBe(annotation.createdAt)
  })

  it('removes an annotation by id', () => {
    const note = removeVideoNoteAnnotation(
      { ...baseNote, annotations: [annotation] },
      'annotation-1',
      '2026-06-09T03:00:00.000Z'
    )

    expect(note.annotations).toEqual([])
    expect(note.updatedAt).toBe('2026-06-09T03:00:00.000Z')
  })

  it('sorts annotations by time and keeps untimed annotations last', () => {
    expect(
      sortVideoNoteAnnotations([
        { ...annotation, id: 'untimed', start: null },
        { ...annotation, id: 'late', start: 120 },
        { ...annotation, id: 'early', start: 5 }
      ]).map((item) => item.id)
    ).toEqual(['early', 'late', 'untimed'])
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteAnnotations.test.ts
```

Expected: FAIL because `videoNoteAnnotations.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `src/renderer/src/features/notes/videoNoteAnnotations.ts`:

```ts
import type { VideoNote, VideoNoteAnnotation } from '@shared/types'

export function sortVideoNoteAnnotations(
  annotations: VideoNoteAnnotation[]
): VideoNoteAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.start === null && right.start === null) {
      return left.createdAt.localeCompare(right.createdAt)
    }

    if (left.start === null) {
      return 1
    }

    if (right.start === null) {
      return -1
    }

    return left.start - right.start || left.createdAt.localeCompare(right.createdAt)
  })
}

export function saveVideoNoteAnnotation(
  note: VideoNote,
  annotation: VideoNoteAnnotation,
  now = new Date().toISOString()
): VideoNote {
  const annotations = note.annotations ?? []
  const existing = annotations.find((item) => item.id === annotation.id)
  const nextAnnotation: VideoNoteAnnotation = {
    ...annotation,
    title: annotation.title.trim() || '未命名批注',
    body: annotation.body.trim(),
    createdAt: existing?.createdAt ?? annotation.createdAt,
    updatedAt: now
  }
  const nextAnnotations = existing
    ? annotations.map((item) => (item.id === annotation.id ? nextAnnotation : item))
    : [...annotations, nextAnnotation]

  return {
    ...note,
    annotations: sortVideoNoteAnnotations(nextAnnotations),
    updatedAt: now
  }
}

export function removeVideoNoteAnnotation(
  note: VideoNote,
  annotationId: string,
  now = new Date().toISOString()
): VideoNote {
  return {
    ...note,
    annotations: (note.annotations ?? []).filter((annotation) => annotation.id !== annotationId),
    updatedAt: now
  }
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteAnnotations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/src/features/notes/videoNoteAnnotations.ts src/renderer/src/features/notes/videoNoteAnnotations.test.ts
git commit -m "feat: manage video note annotations"
```

---

### Task 4: Webview Time Read And Seek Runtime

**Files:**
- Create: `src/renderer/src/features/notes/videoNoteTimeAutomation.ts`
- Create: `src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts`
- Modify: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Write failing time automation tests**

Create `src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  buildReadCurrentVideoTimeScript,
  buildSeekVideoTimeScript
} from './videoNoteTimeAutomation'

describe('video note time automation', () => {
  it('reads current video time from the active page video element', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'currentTime', { value: 83.4, configurable: true })

    await expect(window.eval(buildReadCurrentVideoTimeScript())).resolves.toBe(83.4)
  })

  it('throws a clear error when no video element exists', async () => {
    document.body.innerHTML = '<main></main>'

    await expect(window.eval(buildReadCurrentVideoTimeScript())).rejects.toThrow(
      '未找到当前视频播放器，无法读取时间点。'
    )
  })

  it('seeks the active page video element and tries to play', async () => {
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    const play = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(video, 'play', { value: play, configurable: true })

    await expect(window.eval(buildSeekVideoTimeScript(95))).resolves.toBe(true)
    expect(video.currentTime).toBe(95)
    expect(play).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts
```

Expected: FAIL because `videoNoteTimeAutomation.ts` does not exist.

- [ ] **Step 3: Implement time scripts**

Create `src/renderer/src/features/notes/videoNoteTimeAutomation.ts`:

```ts
export function buildReadCurrentVideoTimeScript(): string {
  return `
    (async () => {
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('未找到当前视频播放器，无法读取时间点。');
      }

      return Number(video.currentTime || 0);
    })()
  `
}

export function buildSeekVideoTimeScript(seconds: number): string {
  return `
    (async () => {
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('未找到当前视频播放器，无法跳转时间点。');
      }

      video.currentTime = ${JSON.stringify(Math.max(0, seconds))};
      try {
        await video.play?.();
      } catch {}
      return true;
    })()
  `
}
```

- [ ] **Step 4: Run time script tests and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing runtime bridge tests**

In `src/renderer/src/App.test.tsx`, add tests beside existing runtime request tests:

```ts
it('reads the current video time through the assistant runtime', async () => {
  const { requestRuntime, executeJavaScript } = renderAppWithRuntimeBridge()
  executeJavaScript.mockResolvedValueOnce(42.5)

  await expect(requestRuntime({ id: 'time-1', type: 'get-current-video-time' })).resolves.toBe(42.5)
  expect(executeJavaScript.mock.calls[0][0]).toContain('currentTime')
})

it('seeks the current video through the assistant runtime', async () => {
  const { requestRuntime, executeJavaScript } = renderAppWithRuntimeBridge()
  executeJavaScript.mockResolvedValueOnce(true)

  await expect(requestRuntime({ id: 'seek-1', type: 'seek-video-time', seconds: 88 })).resolves.toBe(true)
  expect(executeJavaScript.mock.calls[0][0]).toContain('currentTime = 88')
})
```

In `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`, tests will force these union members:

```ts
| { id: string; type: 'get-current-video-time' }
| { id: string; type: 'seek-video-time'; seconds: number }
```

- [ ] **Step 6: Run App tests and verify RED**

Run:

```powershell
npm test -- src/renderer/src/App.test.tsx
```

Expected: FAIL because the runtime request types and handlers do not exist.

- [ ] **Step 7: Implement runtime bridge**

In `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`, add request variants:

```ts
| { id: string; type: 'get-current-video-time' }
| { id: string; type: 'seek-video-time'; seconds: number }
```

Add `number` and `boolean` to `AssistantRuntimeResponsePayload`.

In `src/renderer/src/App.tsx`, import:

```ts
import {
  buildReadCurrentVideoTimeScript,
  buildSeekVideoTimeScript
} from './features/notes/videoNoteTimeAutomation'
```

Add helpers:

```ts
async function readCurrentVideoTime(): Promise<number> {
  const currentActiveWebview = getCurrentActiveWebview()

  if (!currentActiveWebview?.executeJavaScript) {
    throw new Error('浏览框尚未备妥，无法读取时间点。')
  }

  return currentActiveWebview.executeJavaScript(buildReadCurrentVideoTimeScript(), true) as Promise<number>
}

async function seekVideoTime(seconds: number): Promise<boolean> {
  const currentActiveWebview = getCurrentActiveWebview()

  if (!currentActiveWebview?.executeJavaScript) {
    throw new Error('浏览框尚未备妥，无法跳转时间点。')
  }

  return currentActiveWebview.executeJavaScript(buildSeekVideoTimeScript(seconds), true) as Promise<boolean>
}
```

Handle runtime requests:

```ts
case 'get-current-video-time':
  return readCurrentVideoTime()
case 'seek-video-time':
  return seekVideoTime(request.seconds)
```

Add both helpers to the effect dependency list.

In `electron/main/index.ts`, add IPC handlers:

```ts
ipcMain.handle('floating-assistant:get-current-video-time', () =>
  requestMainAssistantRuntime<number>({ type: 'get-current-video-time' })
)
ipcMain.handle('floating-assistant:seek-video-time', (_event, seconds: number) =>
  requestMainAssistantRuntime<boolean>({ type: 'seek-video-time', seconds })
)
```

In `electron/preload/index.ts`, expose:

```ts
getCurrentVideoTime: () =>
  ipcRenderer.invoke('floating-assistant:get-current-video-time') as Promise<number>,
seekVideoTime: (seconds: number) =>
  ipcRenderer.invoke('floating-assistant:seek-video-time', seconds) as Promise<boolean>,
```

In `src/renderer/src/global.d.ts`, add:

```ts
getCurrentVideoTime?: () => Promise<number>
seekVideoTime?: (seconds: number) => Promise<boolean>
```

- [ ] **Step 8: Run bridge tests and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts src/renderer/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/renderer/src/features/notes/videoNoteTimeAutomation.ts src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts src/renderer/src/features/assistant/assistantRuntimeTypes.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat: bridge video note time controls"
```

---

### Task 5: Deep Reading UI In VideoNotesPanel

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Write failing `VideoNotesPanel` UI tests**

In `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`, update `sampleNote` with:

```ts
annotations: [],
```

Add tests:

```ts
it('adds a timestamp annotation from the current video time', async () => {
  const onChange = vi.fn()
  const onGetCurrentTime = vi.fn().mockResolvedValue(75)

  render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onChange={onChange}
      onGetCurrentTime={onGetCurrentTime}
      onSeekToTime={vi.fn()}
    />
  )

  fireEvent.click(screen.getByRole('tab', { name: '批注' }))
  fireEvent.click(screen.getByRole('button', { name: '取当前时间' }))
  fireEvent.change(await screen.findByLabelText('批注标题'), { target: { value: '复看这里' } })
  fireEvent.change(screen.getByLabelText('批注正文'), { target: { value: '这里解释了数据质量。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存批注' }))

  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        annotations: [
          expect.objectContaining({
            start: 75,
            title: '复看这里',
            body: '这里解释了数据质量。'
          })
        ]
      })
    )
  )
})

it('seeks to an annotation timestamp', async () => {
  const onSeekToTime = vi.fn().mockResolvedValue(true)

  render(
    <VideoNotesPanel
      note={{
        ...sampleNote,
        annotations: [
          {
            id: 'annotation-1',
            start: 75,
            title: '复看这里',
            body: '这里解释了数据质量。',
            createdAt: '2026-06-09T00:00:00.000Z',
            updatedAt: '2026-06-09T00:00:00.000Z'
          }
        ]
      }}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onChange={vi.fn()}
      onGetCurrentTime={vi.fn()}
      onSeekToTime={onSeekToTime}
    />
  )

  fireEvent.click(screen.getByRole('tab', { name: '批注' }))
  fireEvent.click(screen.getByRole('button', { name: '01:15' }))

  await waitFor(() => expect(onSeekToTime).toHaveBeenCalledWith(75))
})

it('copies markdown export', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })

  render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onChange={vi.fn()}
      onGetCurrentTime={vi.fn()}
      onSeekToTime={vi.fn()}
    />
  )

  fireEvent.click(screen.getByRole('tab', { name: '导出' }))
  fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }))

  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#')))
  expect(screen.getByRole('status')).toHaveTextContent('Markdown 已复制')
})

it('saves the latest user memo with the note', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)

  render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={onSave}
      onChange={vi.fn()}
      onGetCurrentTime={vi.fn()}
      onSeekToTime={vi.fn()}
    />
  )

  fireEvent.click(screen.getByRole('tab', { name: '归档' }))
  fireEvent.change(screen.getByLabelText('本地备注'), { target: { value: '周会可用。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ userMemo: '周会可用。' }))
  )
})
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: FAIL because new props, tabs, controls, and Markdown copy do not exist.

- [ ] **Step 3: Implement panel props and local note editing**

Update `VideoNotesPanelProps`:

```ts
type VideoNotesPanelProps = {
  note: VideoNote | null
  isLoading: boolean
  onGenerate: (manualTranscript?: string) => Promise<VideoNote | null>
  onSave: (note: VideoNote) => Promise<void>
  onChange?: (note: VideoNote) => void
  onGetCurrentTime?: () => Promise<number>
  onSeekToTime?: (seconds: number) => Promise<boolean>
}
```

Update tab type and labels:

```ts
type VideoNotesTab = 'overview' | 'transcript' | 'annotations' | 'export' | 'archive'

const tabs: Array<{ id: VideoNotesTab; label: string }> = [
  { id: 'overview', label: '速览' },
  { id: 'transcript', label: '文稿' },
  { id: 'annotations', label: '批注' },
  { id: 'export', label: '导出' },
  { id: 'archive', label: '归档' }
]
```

Import helpers:

```ts
import { createVideoNoteMarkdown } from './videoNoteMarkdown'
import { removeVideoNoteAnnotation, saveVideoNoteAnnotation } from './videoNoteAnnotations'
import type { VideoNote, VideoNoteAnnotation } from '@shared/types'
```

Add local editing state:

```ts
const [draftTime, setDraftTime] = useState<number | null>(null)
const [draftTitle, setDraftTitle] = useState('')
const [draftBody, setDraftBody] = useState('')
const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
const [memoDraft, setMemoDraft] = useState(note?.userMemo ?? '')
```

Add helper functions:

```ts
function emitNoteChange(nextNote: VideoNote) {
  onChange?.(nextNote)
}

async function handleReadCurrentTime() {
  if (!onGetCurrentTime) {
    setErrorMessage('当前窗口无法读取视频时间点。')
    return
  }

  try {
    setDraftTime(await onGetCurrentTime())
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : '读取时间点时遇到未知差错。')
  }
}

function handleSaveAnnotation() {
  if (!note) {
    return
  }

  if (!draftTitle.trim() && !draftBody.trim()) {
    setErrorMessage('批注标题和正文不能同时为空。')
    return
  }

  const now = new Date().toISOString()
  const annotation: VideoNoteAnnotation = {
    id: editingAnnotationId ?? `annotation:${now}`,
    start: draftTime,
    title: draftTitle,
    body: draftBody,
    createdAt: now,
    updatedAt: now
  }
  const nextNote = saveVideoNoteAnnotation(note, annotation, now)
  emitNoteChange(nextNote)
  setEditingAnnotationId(null)
  setDraftTitle('')
  setDraftBody('')
  setStatusMessage('批注已保存')
}

function handleDeleteAnnotation(annotationId: string) {
  if (!note) {
    return
  }

  emitNoteChange(removeVideoNoteAnnotation(note, annotationId))
}

async function handleSeek(seconds: number | null) {
  if (seconds === null) {
    return
  }

  try {
    await onSeekToTime?.(seconds)
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : '跳转时间点时遇到未知差错。')
  }
}

async function handleCopyMarkdown() {
  if (!note) {
    return
  }

  const markdown = createVideoNoteMarkdown(note)
  await navigator.clipboard.writeText(markdown)
  setStatusMessage('Markdown 已复制')
}
```

Render an `annotations` tab with form and list. Render an `export` tab with a readonly `<textarea>` or `<pre>` containing `createVideoNoteMarkdown(note)` and a `复制 Markdown` button. In the archive tab, add a labeled `textarea` for `本地备注`; `handleSave` must save `{ ...note, userMemo: memoDraft }`.

- [ ] **Step 4: Wire parent components**

In `MemorialPanelProps`, add:

```ts
onChangeVideoNote?: (note: VideoNote) => void
onGetCurrentVideoTime?: () => Promise<number>
onSeekVideoTime?: (seconds: number) => Promise<boolean>
```

Pass to `VideoNotesPanel`:

```tsx
onChange={onChangeVideoNote}
onGetCurrentTime={onGetCurrentVideoTime}
onSeekToTime={onSeekVideoTime}
```

In `AssistantOverlay`, add optional props:

```ts
readCurrentVideoTime?: () => Promise<number>
seekVideoTime?: (seconds: number) => Promise<boolean>
```

Pass `onChangeVideoNote={setVideoNote}` to `MemorialPanel`. Pass time props from overlay props.

In `FloatingAssistantApp`, add:

```ts
async function getCurrentVideoTime() {
  return window.bilimiDesktop?.getCurrentVideoTime?.() ?? Promise.reject(new Error('当前窗口无法读取视频时间点。'))
}

async function seekVideoTime(seconds: number) {
  return window.bilimiDesktop?.seekVideoTime?.(seconds) ?? Promise.reject(new Error('当前窗口无法跳转时间点。'))
}
```

Pass `onChangeVideoNote={setVideoNote}`, `onGetCurrentVideoTime={getCurrentVideoTime}`, and `onSeekVideoTime={seekVideoTime}` to `MemorialPanel`.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Write and run floating bridge integration test**

In `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`, add:

```ts
it('passes video time controls into the notes panel', async () => {
  const note: VideoNote = {
    id: 'bvid:BV1note',
    source: {
      title: '机器学习入门',
      author: '李老师',
      tags: ['AI'],
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note'
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 8, text: '机器学习需要数据和模型。' }],
    chapters: [],
    overview: {
      shortSummary: ['机器学习需要数据和模型。'],
      keywords: ['机器学习'],
      timeline: [{ start: 0, title: '开场', detail: '说明机器学习的基本材料。' }],
      highlights: []
    },
    annotations: [],
    userMemo: '',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z'
  }
  const getCurrentVideoTime = vi.fn().mockResolvedValue(75)
  const seekVideoTime = vi.fn().mockResolvedValue(true)
  installDesktopApi({
    generateVideoNote: vi.fn().mockResolvedValue(note),
    getCurrentVideoTime,
    seekVideoTime
  })

  render(<FloatingAssistantApp />)
  fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
  fireEvent.click(screen.getByRole('button', { name: '整理札记' }))
  fireEvent.click(await screen.findByRole('tab', { name: '批注' }))
  fireEvent.click(screen.getByRole('button', { name: '取当前时间' }))

  await waitFor(() => expect(getCurrentVideoTime).toHaveBeenCalled())
})
```

Run:

```powershell
npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: PASS after wiring.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
git commit -m "feat: add deep reading notes UI"
```

---

### Task 6: Store Compatibility And Styles

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing store compatibility test**

In `electron/main/store.test.ts`, add:

```ts
it('loads legacy video notes with empty annotations', () => {
  const store = createMemoryStore({
    videoNotes: [
      {
        ...createStoreNote('bvid:legacy'),
        annotations: undefined
      }
    ]
  })

  expect(loadVideoNotes(store)[0].annotations).toEqual([])
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- electron/main/store.test.ts
```

Expected: FAIL until `loadVideoNotes` normalizes notes.

- [ ] **Step 3: Normalize loaded notes and add styles**

In `electron/main/store.ts`, import `normalizeVideoNotes`:

```ts
import { normalizeVideoNotes, upsertVideoNote } from '../../src/shared/videoNotes'
```

Update `loadVideoNotes`:

```ts
export function loadVideoNotes(store: AssistantStoreLike = getDesktopStore()): VideoNote[] {
  return normalizeVideoNotes(store.get('videoNotes') ?? [])
}
```

Add compact styles to `src/renderer/src/styles.css`:

```css
.video-notes__annotation-form {
  display: grid;
  gap: 8px;
}

.video-notes__annotation-actions,
.video-notes__export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.video-notes__annotations {
  display: grid;
  gap: 8px;
  list-style: none;
  padding: 0;
}

.video-notes__annotation {
  border: 1px solid rgba(35, 35, 35, 0.14);
  border-radius: 8px;
  padding: 8px;
}

.video-notes__markdown-preview {
  min-height: 180px;
  white-space: pre-wrap;
}
```

- [ ] **Step 4: Run store test and verify GREEN**

Run:

```powershell
npm test -- electron/main/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add electron/main/store.ts electron/main/store.test.ts src/renderer/src/styles.css
git commit -m "feat: persist deep reading video notes"
```

---

### Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- src/shared/videoNotes.test.ts src/renderer/src/features/notes/videoNoteSummarizer.test.ts src/renderer/src/features/notes/videoNoteMarkdown.test.ts src/renderer/src/features/notes/videoNoteAnnotations.test.ts src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx electron/main/store.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run full tests**

Run:

```powershell
npm test
```

Expected: all test files pass.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: build exits 0.

- [ ] **Step 4: Restart the project**

Stop processes whose command line contains:

```text
C:\Users\diqing\bilimi\.worktrees\bilimi-mvp
```

Start:

```powershell
npm run dev
```

Write logs to:

```text
.codex-temp/restart-current.out.log
.codex-temp/restart-current.err.log
```

Confirm `http://localhost:5173/` returns HTTP 200.

- [ ] **Step 5: Manual smoke check**

In the app:

1. Open a Bilibili video.
2. Open the floating assistant.
3. Go to `札记`.
4. Click `整理札记`.
5. Open `批注`.
6. Click `取当前时间`, enter title/body, save the annotation.
7. Click the annotation timestamp and confirm the video seeks.
8. Open `导出`, click `复制 Markdown`, paste into a scratch field and confirm it contains the annotation.
9. Open `归档`, edit `本地备注`, save the note.

Expected: all steps work without console errors or UI overlap.
