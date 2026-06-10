# Video Note Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable Bilimi notes fallback flow so failed video-document detection can still produce a note summary from automatic page materials or ask the user for manual supplement text.

**Architecture:** Start with a minimal TypeScript and Vitest workspace because the repository currently contains specs and plans but no runnable app code. Implement the notes fallback as focused pure TypeScript modules under `src/renderer/src/features/notes`, with a UI-facing flow result that a React/Electron layer can render in a separate integration slice. Keep DOM and Bilibili page automation out of this slice; the collector accepts already-extracted page context and produces source bundles for scoring and summarizing.

**Tech Stack:** TypeScript, Vitest, pure functional modules.

---

## File Structure

### Workspace

- `package.json`
  - Defines test scripts and dev dependencies.
- `tsconfig.json`
  - Strict TypeScript configuration and path aliases.
- `vitest.config.ts`
  - Vitest configuration.
- `src/test/setup.ts`
  - Shared test setup file.

### Notes Feature

- `src/renderer/src/features/notes/noteTypes.ts`
  - Shared types for detection, page context, source bundles, quality assessments, summaries, and fallback flow results.
- `src/renderer/src/features/notes/videoDocumentDetector.ts`
  - Classifies structured document detection as `found`, `low_confidence`, or `not_found`.
- `src/renderer/src/features/notes/noteSourceCollector.ts`
  - Converts page context and optional manual text into a source bundle with explicit source types.
- `src/renderer/src/features/notes/sourceQualityScorer.ts`
  - Scores source bundles as `sufficient`, `partial`, or `insufficient`.
- `src/renderer/src/features/notes/noteSummarizer.ts`
  - Generates deterministic note summaries from source bundles without inventing unsupported claims.
- `src/renderer/src/features/notes/noteFallbackFlow.ts`
  - Orchestrates detection, collection, scoring, manual-input prompts, and summaries.

### Tests

- `src/renderer/src/features/notes/videoDocumentDetector.test.ts`
- `src/renderer/src/features/notes/sourceQualityScorer.test.ts`
- `src/renderer/src/features/notes/noteSummarizer.test.ts`
- `src/renderer/src/features/notes/noteFallbackFlow.test.ts`

---

### Task 1: Bootstrap TypeScript and Vitest Workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/renderer/src/features/notes/workspaceSmoke.test.ts`

- [ ] **Step 1: Create the failing smoke test**

Create `src/renderer/src/features/notes/workspaceSmoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WORKSPACE_SMOKE_VALUE } from './workspaceSmoke'

describe('workspace smoke test', () => {
  it('runs TypeScript tests in the Bilimi notes workspace', () => {
    expect(WORKSPACE_SMOKE_VALUE).toBe('bilimi-notes-ready')
  })
})
```

- [ ] **Step 2: Add workspace configuration**

Create `package.json`:

```json
{
  "name": "bilimi",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@notes/*": ["src/renderer/src/features/notes/*"]
    }
  },
  "include": ["src", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts']
  }
})
```

Create `src/test/setup.ts`:

```ts
export {}
```

- [ ] **Step 3: Install dependencies and run the smoke test to verify it fails**

Run:

```bash
npm install
npm run test -- src/renderer/src/features/notes/workspaceSmoke.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/notes/workspaceSmoke.test.ts
Error: Failed to resolve import "./workspaceSmoke"
```

- [ ] **Step 4: Add the minimal smoke implementation**

Create `src/renderer/src/features/notes/workspaceSmoke.ts`:

```ts
export const WORKSPACE_SMOKE_VALUE = 'bilimi-notes-ready'
```

- [ ] **Step 5: Run the smoke test again**

Run:

```bash
npm run test -- src/renderer/src/features/notes/workspaceSmoke.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/notes/workspaceSmoke.test.ts
```

- [ ] **Step 6: Commit the workspace bootstrap**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/test/setup.ts src/renderer/src/features/notes/workspaceSmoke.ts src/renderer/src/features/notes/workspaceSmoke.test.ts
git commit -m "chore: bootstrap notes test workspace"
```

---

### Task 2: Add Detection and Source Types

**Files:**
- Create: `src/renderer/src/features/notes/noteTypes.ts`
- Create: `src/renderer/src/features/notes/videoDocumentDetector.ts`
- Create: `src/renderer/src/features/notes/videoDocumentDetector.test.ts`
- Delete: `src/renderer/src/features/notes/workspaceSmoke.ts`
- Delete: `src/renderer/src/features/notes/workspaceSmoke.test.ts`

- [ ] **Step 1: Write the failing detector tests**

Create `src/renderer/src/features/notes/videoDocumentDetector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectVideoDocument } from './videoDocumentDetector'

describe('detectVideoDocument', () => {
  it('returns found when structured document text exists', () => {
    const result = detectVideoDocument({
      title: '机器学习入门',
      structuredDocumentText: '这是完整的视频文档，包含课程目标、章节梳理和示例说明。'
    })

    expect(result).toEqual({
      status: 'found',
      confidence: 0.95,
      reason: 'structured_document_detected',
      documentText: '这是完整的视频文档，包含课程目标、章节梳理和示例说明。'
    })
  })

  it('returns low_confidence when transcript-like material exists without a structured document', () => {
    const result = detectVideoDocument({
      title: '读书方法分享',
      transcriptText: '第一部分先讲如何选书。第二部分讲如何做摘录。第三部分讲如何复盘。'
    })

    expect(result.status).toBe('low_confidence')
    expect(result.confidence).toBe(0.5)
    expect(result.reason).toBe('partial_material_detected')
  })

  it('returns not_found when only sparse metadata exists', () => {
    const result = detectVideoDocument({
      title: '今日随看',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD'
    })

    expect(result).toEqual({
      status: 'not_found',
      confidence: 0,
      reason: 'no_structured_video_document'
    })
  })
})
```

- [ ] **Step 2: Run the detector tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoDocumentDetector.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/notes/videoDocumentDetector.test.ts
Error: Failed to resolve import "./videoDocumentDetector"
```

- [ ] **Step 3: Add shared types**

Create `src/renderer/src/features/notes/noteTypes.ts`:

```ts
export type VideoDocumentDetectionStatus = 'found' | 'low_confidence' | 'not_found'

export type VideoDocumentProbe = {
  title?: string
  url?: string
  description?: string
  structuredDocumentText?: string
  transcriptText?: string
}

export type VideoDocumentDetectionResult =
  | {
      status: 'found'
      confidence: 0.95
      reason: 'structured_document_detected'
      documentText: string
    }
  | {
      status: 'low_confidence'
      confidence: 0.5
      reason: 'partial_material_detected'
    }
  | {
      status: 'not_found'
      confidence: 0
      reason: 'no_structured_video_document'
    }

export type NoteSourceType =
  | 'structuredDocument'
  | 'transcript'
  | 'description'
  | 'partTitle'
  | 'tag'
  | 'metadata'
  | 'url'
  | 'manualSupplement'

export type NoteSourceItem = {
  type: NoteSourceType
  label: string
  text: string
}

export type NotePageContext = {
  title?: string
  uploaderName?: string
  description?: string
  partTitles?: string[]
  tags?: string[]
  publishedAt?: string
  category?: string
  transcriptText?: string
  structuredDocumentText?: string
  url?: string
}

export type NoteSourceBundle = {
  items: NoteSourceItem[]
}

export type SourceQuality = 'sufficient' | 'partial' | 'insufficient'

export type SourceQualityAssessment = {
  quality: SourceQuality
  reason:
    | 'has_primary_text'
    | 'has_rich_description'
    | 'has_limited_description'
    | 'metadata_only'
    | 'empty_source'
}

export type NoteSummaryStatus = 'complete' | 'limited' | 'needs_supplement'

export type NoteSummary = {
  status: NoteSummaryStatus
  oneSentence: string
  keyPoints: string[]
  worthRevisiting: string[]
  openQuestions: string[]
  tags: string[]
  sourceNotice: '据视频文档拟札' | '据页面材料拟札' | '据补充材料拟札' | '材料有限，待补后再拟'
}
```

- [ ] **Step 4: Add the detector implementation**

Create `src/renderer/src/features/notes/videoDocumentDetector.ts`:

```ts
import type { VideoDocumentDetectionResult, VideoDocumentProbe } from './noteTypes'

const RICH_DESCRIPTION_MIN_LENGTH = 120

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

export function detectVideoDocument(probe: VideoDocumentProbe): VideoDocumentDetectionResult {
  const structuredDocumentText = normalizeText(probe.structuredDocumentText)

  if (structuredDocumentText.length > 0) {
    return {
      status: 'found',
      confidence: 0.95,
      reason: 'structured_document_detected',
      documentText: structuredDocumentText
    }
  }

  const transcriptText = normalizeText(probe.transcriptText)
  const description = normalizeText(probe.description)

  if (transcriptText.length > 0 || description.length >= RICH_DESCRIPTION_MIN_LENGTH) {
    return {
      status: 'low_confidence',
      confidence: 0.5,
      reason: 'partial_material_detected'
    }
  }

  return {
    status: 'not_found',
    confidence: 0,
    reason: 'no_structured_video_document'
  }
}
```

- [ ] **Step 5: Remove the smoke files**

Run:

```bash
git rm src/renderer/src/features/notes/workspaceSmoke.ts src/renderer/src/features/notes/workspaceSmoke.test.ts
```

Expected:

```text
rm 'src/renderer/src/features/notes/workspaceSmoke.ts'
rm 'src/renderer/src/features/notes/workspaceSmoke.test.ts'
```

- [ ] **Step 6: Run the detector tests**

Run:

```bash
npm run test -- src/renderer/src/features/notes/videoDocumentDetector.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/notes/videoDocumentDetector.test.ts
```

- [ ] **Step 7: Commit detection and types**

Run:

```bash
git add src/renderer/src/features/notes/noteTypes.ts src/renderer/src/features/notes/videoDocumentDetector.ts src/renderer/src/features/notes/videoDocumentDetector.test.ts
git commit -m "feat: add video document detection model"
```

---

### Task 3: Collect Sources and Score Source Quality

**Files:**
- Create: `src/renderer/src/features/notes/noteSourceCollector.ts`
- Create: `src/renderer/src/features/notes/sourceQualityScorer.ts`
- Create: `src/renderer/src/features/notes/sourceQualityScorer.test.ts`

- [ ] **Step 1: Write the failing collector and scorer tests**

Create `src/renderer/src/features/notes/sourceQualityScorer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectNoteSources } from './noteSourceCollector'
import { scoreNoteSourceBundle } from './sourceQualityScorer'

describe('collectNoteSources and scoreNoteSourceBundle', () => {
  it('scores transcript material as sufficient', () => {
    const bundle = collectNoteSources({
      title: '如何高效背单词',
      uploaderName: '学习区掌柜',
      transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法，最后用输出巩固记忆。',
      url: 'https://www.bilibili.com/video/BV1study'
    })

    expect(bundle.items.map((item) => item.type)).toContain('transcript')
    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'sufficient',
      reason: 'has_primary_text'
    })
  })

  it('scores title and url only as insufficient', () => {
    const bundle = collectNoteSources({
      title: '一个普通视频',
      url: 'https://www.bilibili.com/video/BV1sparse'
    })

    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'insufficient',
      reason: 'metadata_only'
    })
  })

  it('scores a short description as partial', () => {
    const bundle = collectNoteSources({
      title: '阅读习惯',
      description: '分享三个帮助保持阅读节奏的小方法。',
      tags: ['阅读', '习惯']
    })

    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'partial',
      reason: 'has_limited_description'
    })
  })

  it('keeps manual supplement separate from automatic material', () => {
    const bundle = collectNoteSources(
      {
        title: '数据库索引入门',
        url: 'https://www.bilibili.com/video/BV1db'
      },
      '补充材料：视频主要讲 B+ 树索引、联合索引和回表成本。'
    )

    expect(bundle.items).toEqual([
      { type: 'metadata', label: '标题', text: '数据库索引入门' },
      { type: 'url', label: '页面', text: 'https://www.bilibili.com/video/BV1db' },
      {
        type: 'manualSupplement',
        label: '补充材料',
        text: '补充材料：视频主要讲 B+ 树索引、联合索引和回表成本。'
      }
    ])
    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'sufficient',
      reason: 'has_primary_text'
    })
  })
})
```

- [ ] **Step 2: Run the scorer tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/sourceQualityScorer.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/notes/sourceQualityScorer.test.ts
Error: Failed to resolve import "./noteSourceCollector"
```

- [ ] **Step 3: Add the source collector**

Create `src/renderer/src/features/notes/noteSourceCollector.ts`:

```ts
import type { NotePageContext, NoteSourceBundle, NoteSourceItem } from './noteTypes'

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

function pushText(items: NoteSourceItem[], type: NoteSourceItem['type'], label: string, text: string | undefined) {
  const normalized = normalizeText(text)
  if (normalized.length > 0) {
    items.push({ type, label, text: normalized })
  }
}

export function collectNoteSources(context: NotePageContext, manualSupplement?: string): NoteSourceBundle {
  const items: NoteSourceItem[] = []

  pushText(items, 'structuredDocument', '视频文档', context.structuredDocumentText)
  pushText(items, 'transcript', '字幕', context.transcriptText)
  pushText(items, 'description', '简介', context.description)
  pushText(items, 'metadata', '标题', context.title)
  pushText(items, 'metadata', 'UP 主', context.uploaderName)
  pushText(items, 'metadata', '分区', context.category)
  pushText(items, 'metadata', '发布时间', context.publishedAt)

  for (const partTitle of context.partTitles ?? []) {
    pushText(items, 'partTitle', '分P', partTitle)
  }

  for (const tag of context.tags ?? []) {
    pushText(items, 'tag', '标签', tag)
  }

  pushText(items, 'url', '页面', context.url)
  pushText(items, 'manualSupplement', '补充材料', manualSupplement)

  return { items }
}
```

- [ ] **Step 4: Add the quality scorer**

Create `src/renderer/src/features/notes/sourceQualityScorer.ts`:

```ts
import type { NoteSourceBundle, SourceQualityAssessment } from './noteTypes'

const RICH_DESCRIPTION_MIN_LENGTH = 80

const PRIMARY_TEXT_TYPES = new Set(['structuredDocument', 'transcript', 'manualSupplement'])

export function scoreNoteSourceBundle(bundle: NoteSourceBundle): SourceQualityAssessment {
  if (bundle.items.length === 0) {
    return { quality: 'insufficient', reason: 'empty_source' }
  }

  const hasPrimaryText = bundle.items.some(
    (item) => PRIMARY_TEXT_TYPES.has(item.type) && item.text.trim().length > 0
  )

  if (hasPrimaryText) {
    return { quality: 'sufficient', reason: 'has_primary_text' }
  }

  const description = bundle.items.find((item) => item.type === 'description')

  if (description && description.text.length >= RICH_DESCRIPTION_MIN_LENGTH) {
    return { quality: 'sufficient', reason: 'has_rich_description' }
  }

  if (description && description.text.length > 0) {
    return { quality: 'partial', reason: 'has_limited_description' }
  }

  return { quality: 'insufficient', reason: 'metadata_only' }
}
```

- [ ] **Step 5: Run the scorer tests again**

Run:

```bash
npm run test -- src/renderer/src/features/notes/sourceQualityScorer.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/notes/sourceQualityScorer.test.ts
```

- [ ] **Step 6: Commit source collection and scoring**

Run:

```bash
git add src/renderer/src/features/notes/noteSourceCollector.ts src/renderer/src/features/notes/sourceQualityScorer.ts src/renderer/src/features/notes/sourceQualityScorer.test.ts
git commit -m "feat: add note source quality scoring"
```

---

### Task 4: Generate Safe Note Summaries

**Files:**
- Create: `src/renderer/src/features/notes/noteSummarizer.ts`
- Create: `src/renderer/src/features/notes/noteSummarizer.test.ts`

- [ ] **Step 1: Write the failing summarizer tests**

Create `src/renderer/src/features/notes/noteSummarizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectNoteSources } from './noteSourceCollector'
import { createNoteSummary } from './noteSummarizer'
import { scoreNoteSourceBundle } from './sourceQualityScorer'

describe('createNoteSummary', () => {
  it('creates a complete summary from transcript material', () => {
    const bundle = collectNoteSources({
      title: '如何高效背单词',
      tags: ['学习', '英语'],
      transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法。最后用输出巩固记忆。'
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('complete')
    expect(summary.sourceNotice).toBe('据页面材料拟札')
    expect(summary.oneSentence).toContain('先建立语境')
    expect(summary.keyPoints).toHaveLength(3)
    expect(summary.tags).toEqual(['学习', '英语'])
  })

  it('marks partial source summaries as limited', () => {
    const bundle = collectNoteSources({
      title: '阅读习惯',
      description: '分享三个帮助保持阅读节奏的小方法。',
      tags: ['阅读']
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('limited')
    expect(summary.sourceNotice).toBe('材料有限，待补后再拟')
    expect(summary.openQuestions).toContain('现有材料不足，需补充字幕、文稿或观后记录后再确认细节。')
  })

  it('does not create a full summary from metadata only', () => {
    const bundle = collectNoteSources({
      title: '今日随看',
      url: 'https://www.bilibili.com/video/BV1sparse'
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary).toEqual({
      status: 'needs_supplement',
      oneSentence: '材料不足，待补字幕、文稿或观后零札。',
      keyPoints: [],
      worthRevisiting: [],
      openQuestions: ['需要补充视频主体内容后才能生成可靠札记。'],
      tags: [],
      sourceNotice: '材料有限，待补后再拟'
    })
  })

  it('marks summaries from manual supplement text', () => {
    const bundle = collectNoteSources(
      { title: '数据库索引入门' },
      '视频主要讲 B+ 树索引、联合索引和回表成本。最后提醒不要滥建索引。'
    )

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('complete')
    expect(summary.sourceNotice).toBe('据补充材料拟札')
    expect(summary.keyPoints[0]).toContain('B+ 树索引')
  })
})
```

- [ ] **Step 2: Run the summarizer tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/noteSummarizer.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/notes/noteSummarizer.test.ts
Error: Failed to resolve import "./noteSummarizer"
```

- [ ] **Step 3: Add the summarizer implementation**

Create `src/renderer/src/features/notes/noteSummarizer.ts`:

```ts
import type { NoteSourceBundle, NoteSourceItem, NoteSummary, SourceQualityAssessment } from './noteTypes'

const PRIMARY_TYPES: NoteSourceItem['type'][] = ['structuredDocument', 'transcript', 'manualSupplement', 'description']

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function pickPrimaryText(bundle: NoteSourceBundle): NoteSourceItem | undefined {
  return PRIMARY_TYPES.map((type) => bundle.items.find((item) => item.type === type)).find(Boolean)
}

function collectTags(bundle: NoteSourceBundle): string[] {
  return bundle.items
    .filter((item) => item.type === 'tag')
    .map((item) => item.text)
    .slice(0, 6)
}

function sourceNoticeFor(primary: NoteSourceItem | undefined, quality: SourceQualityAssessment): NoteSummary['sourceNotice'] {
  if (quality.quality !== 'sufficient') {
    return '材料有限，待补后再拟'
  }

  if (primary?.type === 'structuredDocument') {
    return '据视频文档拟札'
  }

  if (primary?.type === 'manualSupplement') {
    return '据补充材料拟札'
  }

  return '据页面材料拟札'
}

export function createNoteSummary(bundle: NoteSourceBundle, assessment: SourceQualityAssessment): NoteSummary {
  if (assessment.quality === 'insufficient') {
    return {
      status: 'needs_supplement',
      oneSentence: '材料不足，待补字幕、文稿或观后零札。',
      keyPoints: [],
      worthRevisiting: [],
      openQuestions: ['需要补充视频主体内容后才能生成可靠札记。'],
      tags: [],
      sourceNotice: '材料有限，待补后再拟'
    }
  }

  const primary = pickPrimaryText(bundle)
  const sentences = splitSentences(primary?.text ?? '')
  const keyPoints = sentences.slice(0, 5)
  const tags = collectTags(bundle)

  if (assessment.quality === 'partial') {
    return {
      status: 'limited',
      oneSentence: keyPoints[0] ?? '现有材料只够形成轻量札记。',
      keyPoints: keyPoints.slice(0, 3),
      worthRevisiting: [],
      openQuestions: ['现有材料不足，需补充字幕、文稿或观后记录后再确认细节。'],
      tags,
      sourceNotice: '材料有限，待补后再拟'
    }
  }

  return {
    status: 'complete',
    oneSentence: keyPoints[0] ?? '已据现有材料拟成札记。',
    keyPoints,
    worthRevisiting: keyPoints.slice(0, 2),
    openQuestions: [],
    tags,
    sourceNotice: sourceNoticeFor(primary, assessment)
  }
}
```

- [ ] **Step 4: Run the summarizer tests again**

Run:

```bash
npm run test -- src/renderer/src/features/notes/noteSummarizer.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/notes/noteSummarizer.test.ts
```

- [ ] **Step 5: Commit the summarizer**

Run:

```bash
git add src/renderer/src/features/notes/noteSummarizer.ts src/renderer/src/features/notes/noteSummarizer.test.ts
git commit -m "feat: add safe note summary generation"
```

---

### Task 5: Orchestrate the Fallback Flow

**Files:**
- Modify: `src/renderer/src/features/notes/noteTypes.ts`
- Create: `src/renderer/src/features/notes/noteFallbackFlow.ts`
- Create: `src/renderer/src/features/notes/noteFallbackFlow.test.ts`

- [ ] **Step 1: Write the failing fallback-flow tests**

Create `src/renderer/src/features/notes/noteFallbackFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runNoteFallbackFlow } from './noteFallbackFlow'

describe('runNoteFallbackFlow', () => {
  it('asks for manual supplement when video document detection fails and page material is sparse', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })

    expect(result.mode).toBe('needs_manual_input')
    if (result.mode !== 'needs_manual_input') {
      throw new Error('Expected manual input prompt')
    }
    expect(result.prompt).toEqual({
      title: '未识得视频文档',
      message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。',
      acceptedMaterials: ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
    })
  })

  it('returns fresh manual prompt objects for repeated sparse-material calls', () => {
    const first = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })
    const second = runNoteFallbackFlow({
      pageContext: {
        title: '今日随看',
        url: 'https://www.bilibili.com/video/BV1sparse'
      }
    })

    expect(first.mode).toBe('needs_manual_input')
    expect(second.mode).toBe('needs_manual_input')
    if (first.mode !== 'needs_manual_input' || second.mode !== 'needs_manual_input') {
      throw new Error('Expected manual input prompts')
    }
    expect(first.prompt).not.toBe(second.prompt)
    expect(first.prompt.acceptedMaterials).not.toBe(second.prompt.acceptedMaterials)
  })

  it('summarizes directly when automatic page material is sufficient', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '如何高效背单词',
        transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法。最后用输出巩固记忆。',
        tags: ['学习', '英语']
      }
    })

    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据页面材料拟札')
    expect(result.summary.keyPoints).toHaveLength(3)
  })

  it('uses manual supplement after automatic material is insufficient', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '数据库索引入门',
        url: 'https://www.bilibili.com/video/BV1db'
      },
      manualSupplement: '视频主要讲 B+ 树索引、联合索引和回表成本。最后提醒不要滥建索引。'
    })

    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据补充材料拟札')
    expect(result.summary.oneSentence).toContain('B+ 树索引')
  })

  it('creates a limited summary from short descriptions without a structured document', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '阅读习惯',
        description: '分享三个帮助保持阅读节奏的小方法。'
      }
    })

    expect(result.detection.status).toBe('not_found')
    expect(result.assessment.quality).toBe('partial')
    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.status).toBe('limited')
  })

  it('keeps low-confidence detection in the fallback path', () => {
    const result = runNoteFallbackFlow({
      pageContext: {
        title: '课程复盘方法',
        description:
          '本期围绕课程复盘展开，先说明为什么看完课程后容易遗忘，再介绍如何用章节标题、问题清单和输出练习保留重点。中段示范把课程内容拆成概念、例子、行动三栏，并用隔日回看确认是否真正理解。结尾提醒复盘不是重看一遍，而是确认自己能否用自己的话讲清楚，并把下次实践写成可执行清单。'
      }
    })

    expect(result.detection.status).toBe('low_confidence')
    expect(result.assessment.quality).toBe('sufficient')
    expect(result.mode).toBe('summary_ready')
    if (result.mode !== 'summary_ready') {
      throw new Error('Expected summary result')
    }
    expect(result.summary.sourceNotice).toBe('据页面材料拟札')
  })
})
```

- [ ] **Step 2: Run the fallback-flow tests to verify they fail**

Run:

```bash
npm run test -- src/renderer/src/features/notes/noteFallbackFlow.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/notes/noteFallbackFlow.test.ts
Error: Failed to resolve import "./noteFallbackFlow"
```

- [ ] **Step 3: Extend shared types for flow results**

Append to `src/renderer/src/features/notes/noteTypes.ts`:

```ts
export type ManualSourcePromptModel = {
  readonly title: '未识得视频文档'
  readonly message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。'
  readonly acceptedMaterials: readonly ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
}

export type NoteFallbackFlowInput = {
  pageContext: NotePageContext
  manualSupplement?: string
}

export type NoteFallbackFlowResult =
  | {
      mode: 'summary_ready'
      detection: VideoDocumentDetectionResult
      sourceBundle: NoteSourceBundle
      assessment: SourceQualityAssessment
      summary: NoteSummary
    }
  | {
      mode: 'needs_manual_input'
      detection: VideoDocumentDetectionResult
      sourceBundle: NoteSourceBundle
      assessment: SourceQualityAssessment
      prompt: ManualSourcePromptModel
    }
```

- [ ] **Step 4: Add the fallback-flow implementation**

Create `src/renderer/src/features/notes/noteFallbackFlow.ts`:

```ts
import type {
  ManualSourcePromptModel,
  NoteFallbackFlowInput,
  NoteFallbackFlowResult
} from './noteTypes'
import { collectNoteSources } from './noteSourceCollector'
import { createNoteSummary } from './noteSummarizer'
import { scoreNoteSourceBundle } from './sourceQualityScorer'
import { detectVideoDocument } from './videoDocumentDetector'

function createManualSourcePrompt(): ManualSourcePromptModel {
  return {
    title: '未识得视频文档',
    message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。',
    acceptedMaterials: ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
  }
}

export function runNoteFallbackFlow(input: NoteFallbackFlowInput): NoteFallbackFlowResult {
  const detection = detectVideoDocument(input.pageContext)
  const sourceBundle = collectNoteSources(input.pageContext, input.manualSupplement)
  const assessment = scoreNoteSourceBundle(sourceBundle)

  if (assessment.quality === 'insufficient') {
    return {
      mode: 'needs_manual_input',
      detection,
      sourceBundle,
      assessment,
      prompt: createManualSourcePrompt()
    }
  }

  return {
    mode: 'summary_ready',
    detection,
    sourceBundle,
    assessment,
    summary: createNoteSummary(sourceBundle, assessment)
  }
}
```

- [ ] **Step 5: Run the fallback-flow tests again**

Run:

```bash
npm run test -- src/renderer/src/features/notes/noteFallbackFlow.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/notes/noteFallbackFlow.test.ts
```

- [ ] **Step 6: Run all notes tests**

Run:

```bash
npm run test -- src/renderer/src/features/notes
```

Expected:

```text
PASS  src/renderer/src/features/notes/videoDocumentDetector.test.ts
PASS  src/renderer/src/features/notes/sourceQualityScorer.test.ts
PASS  src/renderer/src/features/notes/noteSummarizer.test.ts
PASS  src/renderer/src/features/notes/noteFallbackFlow.test.ts
```

- [ ] **Step 7: Commit the fallback flow**

Run:

```bash
git add src/renderer/src/features/notes/noteTypes.ts src/renderer/src/features/notes/noteFallbackFlow.ts src/renderer/src/features/notes/noteFallbackFlow.test.ts
git commit -m "feat: add video note fallback flow"
```

---

### Task 6: Final Verification

**Files:**
- Verify all files touched by Tasks 1-5.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm run test
```

Expected:

```text
Test Files  4 passed
Tests       17 passed
```

- [ ] **Step 2: Run TypeScript type checking**

Run:

```bash
npx tsc --noEmit
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: Check git diff formatting**

Run:

```bash
git diff --check
```

Expected:

```text
exit code 0
```

- [ ] **Step 4: Inspect final status**

Run:

```bash
git status --short
```

Expected:

```text
empty output
```

---

## Self-Review Notes

### Spec Coverage

1. Detection failure enters fallback: Task 2 and Task 5.
2. Automatic collection of page materials: Task 3.
3. Quality scoring for sufficient, partial, and insufficient materials: Task 3.
4. Manual supplement path: Task 3 and Task 5.
5. Stable note summary structure: Task 4.
6. Source notices for page material, video document, supplement, and limited material: Task 4.
7. No unsupported full summary from sparse metadata: Task 4 and Task 5.
8. UI-facing prompt model for React/Electron rendering in a separate integration slice: Task 5.

### Placeholder Scan

The plan contains concrete file paths, commands, expected outcomes, and code for each implementation step. No incomplete markers are intentionally used.

### Type Consistency

All modules import from `noteTypes.ts`. `NoteFallbackFlowResult` uses the same `VideoDocumentDetectionResult`, `NoteSourceBundle`, `SourceQualityAssessment`, and `NoteSummary` types created earlier in the plan.
