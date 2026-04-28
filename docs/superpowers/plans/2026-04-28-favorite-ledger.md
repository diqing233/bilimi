# Favorite Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 掌库 flow so first-time users can create Bilimi favorite ledgers, customize categories, and safely append old favorites into Bilimi-managed folders.

**Architecture:** Introduce a shared favorite-ledger model that replaces hard-coded four-folder maps. Renderer code classifies videos against user-enabled ledgers, App executes Bilibili API scripts through the active webview, and the assistant UI opens a 掌库 panel for setup, custom ledgers, scan preview, and confirmed execution. Old favorites are read from user folders but only appended to Bilimi ledgers.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8, Vitest, Testing Library, Bilibili webview `executeJavaScript`.

---

## File Structure

- Create `src/shared/favoriteLedgers.ts`: default ledger definitions, normalization helpers, Bilimi-managed name checks, and recommended name generation.
- Modify `src/shared/types.ts`: add `FavoriteLedger`, `FavoriteLedgerPreferences`, `FavoriteLedgerClassification`, `FavoriteLedgerStatus`, and broaden preference counts to ledger IDs.
- Modify `src/shared/constants.ts`: keep `BILIMI_FAVORITES_NAME` as a legacy fallback and export `BILIMI_LEDGER_PREFIX`.
- Modify `electron/main/store.ts` and `electron/main/store.test.ts`: persist favorite ledgers and prompt state alongside existing assistant preferences.
- Modify `electron/preload/index.ts` and `src/renderer/src/global.d.ts`: expose the expanded preference shape.
- Modify `src/renderer/src/features/state/assistantState.ts` and test: hydrate ledgers, counts, and first-open prompt state.
- Modify `src/renderer/src/features/recommendation/videoClassifier.ts` and test: classify against enabled ledgers, with custom ledgers first and `inbox` fallback.
- Modify `src/renderer/src/features/recommendation/recommendationRules.ts` and test: provide labels for the eight default ledgers and a generic custom-ledger label.
- Create `src/renderer/src/features/favorites/favoriteLedgerPreview.ts` and test: pure scan-preview rules for excluding Bilimi folders, matching ledgers, and skipping already archived videos.
- Create `src/renderer/src/features/favorites/favoriteLedgerApi.ts` and test: Bilibili API script builders for status, ensure, scan, and append execution.
- Modify `src/renderer/src/features/actions/favoriteApiAutomation.ts`, `pageAutomation.ts`, `visualFavoriteFallback.ts`, `actionExecutor.ts`, and their tests: pass ledger IDs and ledgers instead of the old four-folder map.
- Create `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx` and test: 掌库 panel UI.
- Modify `src/renderer/src/features/assistant/MemorialPanel.tsx`, `AssistantOverlay.tsx`, and tests: add 掌库 button, first-open prompt, and panel callbacks.
- Modify `src/renderer/src/App.tsx` and `App.test.tsx`: wire active-webview script runners for ledger status, ensure, scan, and execution.
- Modify `src/renderer/src/styles.css`: style the 掌库 prompt and panel with existing compact parchment styling.

---

### Task 1: Shared Ledger Model

**Files:**
- Create: `src/shared/favoriteLedgers.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/constants.ts`
- Test: `src/shared/favoriteLedgers.test.ts`
- Test: `src/shared/constants.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/favoriteLedgers.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  isBilimiManagedLedgerName,
  normalizeFavoriteLedgers,
  suggestFavoriteLedgerNames
} from './favoriteLedgers'

describe('favorite ledger model', () => {
  it('defines eight enabled Bilimi default ledgers with stable ids', () => {
    expect(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName])).toEqual([
      ['knowledge', 'Bilimi·见闻增广'],
      ['humor', 'Bilimi·茶余解颐'],
      ['story', 'Bilimi·影剧情长'],
      ['play', 'Bilimi·游艺演武'],
      ['life', 'Bilimi·市井烟火'],
      ['craft', 'Bilimi·工巧器用'],
      ['music', 'Bilimi·歌舞清音'],
      ['inbox', 'Bilimi·暂存待阅']
    ])
    expect(createDefaultFavoriteLedgers().every((ledger) => ledger.enabled)).toBe(true)
  })

  it('preserves custom ledgers and fills missing default ledgers', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'knowledge',
        displayName: 'Bilimi·开卷有益',
        keywords: ['开卷'],
        enabled: false,
        priority: 21,
        isDefault: true
      },
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: 5,
        isDefault: false
      }
    ])

    expect(ledgers).toHaveLength(9)
    expect(ledgers.find((ledger) => ledger.id === 'knowledge')).toEqual({
      id: 'knowledge',
      displayName: 'Bilimi·开卷有益',
      keywords: ['开卷'],
      enabled: false,
      priority: 21,
      isDefault: true
    })
    expect(ledgers.find((ledger) => ledger.id === 'custom-photo')?.displayName).toBe('Bilimi·光影留真')
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('Bilimi·暂存待阅')
  })

  it('recognizes only Bilimi-prefixed ledger names as managed', () => {
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
    expect(isBilimiManagedLedgerName('Bilimi·见闻增广')).toBe(true)
    expect(isBilimiManagedLedgerName('默认收藏夹')).toBe(false)
    expect(isBilimiManagedLedgerName('我的 Bilimi 灵感')).toBe(false)
  })

  it('recommends three court-style names from a topic', () => {
    expect(suggestFavoriteLedgerNames('摄影')).toEqual([
      'Bilimi·光影留真',
      'Bilimi·镜里春秋',
      'Bilimi·取景小札'
    ])
    expect(suggestFavoriteLedgerNames('编程')).toEqual([
      'Bilimi·码艺札记',
      'Bilimi·机杼成文',
      'Bilimi·格物编修'
    ])
  })
})
```

Update `src/shared/constants.test.ts` to expect:

```ts
import { describe, expect, it } from 'vitest'
import {
  APP_TITLE,
  BILIBILI_HOME_URL,
  BILIMI_FAVORITES_NAME,
  BILIMI_LEDGER_PREFIX,
  BILIMI_SESSION_PARTITION
} from './constants'

describe('shared constants', () => {
  it('keeps the core app constants stable', () => {
    expect(APP_TITLE).toBe('Bilimi')
    expect(BILIBILI_HOME_URL).toBe('https://www.bilibili.com')
    expect(BILIMI_SESSION_PARTITION).toBe('persist:bilimi')
    expect(BILIMI_FAVORITES_NAME).toBe('Bilimi 内库')
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/shared/favoriteLedgers.test.ts src/shared/constants.test.ts`

Expected: FAIL with an import error for `./favoriteLedgers` or missing `BILIMI_LEDGER_PREFIX`.

- [ ] **Step 3: Add shared types and ledger helpers**

Modify `src/shared/types.ts` so the exported shared types include:

```ts
export type AssistantAction = '赏' | '藏' | '赐' | '表' | '阅'

export type BrowserSurfaceModel = {
  src: string
  partition: string
  allowpopups: 'true'
}

export type BrowserTabModel = {
  id: string
  title: string
  url: string
}

export type DefaultFavoriteLedgerId =
  | 'knowledge'
  | 'humor'
  | 'story'
  | 'play'
  | 'life'
  | 'craft'
  | 'music'
  | 'inbox'

export type FavoriteLedgerId = string
export type RecommendationKind = FavoriteLedgerId

export type FavoriteLedger = {
  id: FavoriteLedgerId
  displayName: string
  keywords: string[]
  enabled: boolean
  priority: number
  bilibiliFolderId?: string
  isDefault: boolean
}

export type FavoriteLedgerClassification = {
  ledgerId: FavoriteLedgerId
  displayName: string
  matchedKeywords: string[]
  reviewRequired: boolean
}

export type FavoriteLedgerStatus = {
  ok: boolean
  ledgers: FavoriteLedger[]
  missingLedgerIds: FavoriteLedgerId[]
  message: string
}

export type RecommendationLabel = {
  badge: '可赏' | '可阅' | '请陛下过目' | '可藏' | '待分拣'
  summary: string
}

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  preferenceCounts: Record<string, number>
}

export type AssistantAutomationResult = {
  ok: boolean
  steps: string[]
  missingTargets: string[]
  message: string
}

export type VisualAutomationContext = {
  favoriteFolders: Record<string, string>
  favoritesFolderName: string
  targetLedgerId: FavoriteLedgerId
}

export type VisualAutomationFallback = (
  context: VisualAutomationContext
) => Promise<AssistantAutomationResult>
```

Modify `src/shared/constants.ts` to include:

```ts
export const APP_TITLE = 'Bilimi'
export const BILIBILI_HOME_URL = 'https://www.bilibili.com'
export const BILIMI_SESSION_PARTITION = 'persist:bilimi'
export const BILIMI_FAVORITES_NAME = 'Bilimi 内库'
export const BILIMI_LEDGER_PREFIX = 'Bilimi·'
```

Create `src/shared/favoriteLedgers.ts` with:

```ts
import { BILIMI_LEDGER_PREFIX } from './constants'
import type { DefaultFavoriteLedgerId, FavoriteLedger } from './types'

const DEFAULT_LEDGER_DATA: Array<{
  id: DefaultFavoriteLedgerId
  name: string
  keywords: string[]
}> = [
  {
    id: 'knowledge',
    name: '见闻增广',
    keywords: ['知识', '科普', '教程', '学习', '财经', '解释', '原理', '入门', '课程', '干货']
  },
  {
    id: 'humor',
    name: '茶余解颐',
    keywords: ['搞笑', '鬼畜', '综艺', '切片', '娱乐', '整活', '爆笑', '快乐', '吐槽']
  },
  {
    id: 'story',
    name: '影剧情长',
    keywords: ['影视', '番剧', '剧情', '解说', '混剪', '角色', '电影', '伏笔', '结局']
  },
  {
    id: 'play',
    name: '游艺演武',
    keywords: ['游戏', '电竞', '运动', '健身', '技巧', '操作', '通关', '赛事']
  },
  {
    id: 'life',
    name: '市井烟火',
    keywords: ['生活', 'vlog', '美食', '探店', '旅行', '家居', '做饭', '日常']
  },
  {
    id: 'craft',
    name: '工巧器用',
    keywords: ['科技', '数码', '软件', '工具', '手作', '效率', '编程', '相机', '电脑']
  },
  {
    id: 'music',
    name: '歌舞清音',
    keywords: ['音乐', '舞蹈', '演奏', '翻唱', '舞台', '歌曲', '乐队', '现场']
  },
  {
    id: 'inbox',
    name: '暂存待阅',
    keywords: ['稍后再看', '待阅', '暂存'],
  }
]

const TOPIC_NAME_SUGGESTIONS: Record<string, string[]> = {
  摄影: ['光影留真', '镜里春秋', '取景小札'],
  编程: ['码艺札记', '机杼成文', '格物编修'],
  历史: ['古今钩沉', '旧事新编', '史海拾遗'],
  猫片: ['狸奴小记', '软爪闲章', '喵影留册']
}

export { BILIMI_LEDGER_PREFIX }

export function createDefaultFavoriteLedgers(): FavoriteLedger[] {
  return DEFAULT_LEDGER_DATA.map((entry, index) => ({
    id: entry.id,
    displayName: `${BILIMI_LEDGER_PREFIX}${entry.name}`,
    keywords: [...entry.keywords],
    enabled: true,
    priority: index,
    isDefault: true
  }))
}

function cloneLedger(ledger: FavoriteLedger): FavoriteLedger {
  return {
    ...ledger,
    keywords: [...ledger.keywords]
  }
}

export function normalizeFavoriteLedgers(persisted: FavoriteLedger[] = []): FavoriteLedger[] {
  const defaultLedgers = createDefaultFavoriteLedgers()
  const persistedById = new Map(persisted.map((ledger) => [ledger.id, cloneLedger(ledger)]))
  const normalizedDefaults = defaultLedgers.map((ledger) => persistedById.get(ledger.id) ?? ledger)
  const customLedgers = persisted
    .filter((ledger) => !defaultLedgers.some((defaultLedger) => defaultLedger.id === ledger.id))
    .map(cloneLedger)

  return [...normalizedDefaults, ...customLedgers].sort((left, right) => left.priority - right.priority)
}

export function isBilimiManagedLedgerName(name: string): boolean {
  return name.trim().startsWith(BILIMI_LEDGER_PREFIX)
}

export function favoriteLedgersById(ledgers: FavoriteLedger[]): Record<string, FavoriteLedger> {
  return Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledger]))
}

export function favoriteLedgerNamesById(ledgers: FavoriteLedger[]): Record<string, string> {
  return Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledger.displayName]))
}

export function suggestFavoriteLedgerNames(topic: string): string[] {
  const trimmedTopic = topic.trim()
  const names = TOPIC_NAME_SUGGESTIONS[trimmedTopic] ?? [
    `${trimmedTopic}小札`,
    `${trimmedTopic}留册`,
    `${trimmedTopic}拾遗`
  ]

  return names.map((name) => `${BILIMI_LEDGER_PREFIX}${name}`)
}
```

Remove the trailing comma after the `inbox` `keywords` property if the local formatter flags it; the object value remains `['稍后再看', '待阅', '暂存']`.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/shared/favoriteLedgers.test.ts src/shared/constants.test.ts`

Expected: PASS for both test files.

- [ ] **Step 5: Commit**

```bash
git add src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts src/shared/types.ts src/shared/constants.ts src/shared/constants.test.ts
git commit -m "feat: add Bilimi favorite ledger model"
```

---

### Task 2: Persist Ledger Preferences

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Modify: `src/renderer/src/features/state/assistantState.test.ts`

- [ ] **Step 1: Write failing store and state tests**

In `electron/main/store.test.ts`, update `createFakeStore` so `snapshot` includes `favoriteLedgers` and `ledgerPromptDismissed`, then add:

```ts
it('loads favorite ledgers and first-open prompt state with preferences', () => {
  const store = createFakeStore({
    favoriteLedgers: [
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影'],
        enabled: true,
        priority: 50,
        isDefault: false
      }
    ],
    ledgerPromptDismissed: true
  })

  expect(loadAssistantPreferences(store)).toMatchObject({
    ledgerPromptDismissed: true,
    favoriteLedgers: [
      expect.objectContaining({
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真'
      })
    ]
  })
})
```

In `src/renderer/src/features/state/assistantState.test.ts`, replace the hydration test expected shape with:

```ts
expect(
  createInitialAssistantPreferences({
    favoritesFolderName: 'Bilimi 私库',
    favoriteLedgers: [
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影'],
        enabled: true,
        priority: 50,
        isDefault: false
      }
    ],
    preferenceCounts: {
      humor: 3
    },
    ledgerPromptDismissed: true
  })
).toMatchObject({
  favoritesFolderName: 'Bilimi 私库',
  ledgerPromptDismissed: true,
  preferenceCounts: {
    humor: 3
  }
})
```

Add this assertion after the `toMatchObject` call:

```ts
expect(
  createInitialAssistantPreferences({
    favoriteLedgers: [],
    preferenceCounts: {}
  }).favoriteLedgers.map((ledger) => ledger.id)
).toEqual(['knowledge', 'humor', 'story', 'play', 'life', 'craft', 'music', 'inbox'])
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- electron/main/store.test.ts src/renderer/src/features/state/assistantState.test.ts`

Expected: FAIL because `favoriteLedgers` and `ledgerPromptDismissed` are not in `AssistantPreferences`.

- [ ] **Step 3: Persist the expanded preference shape**

Modify `electron/main/store.ts` so it imports and uses the shared ledger helpers:

```ts
import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  preferenceCounts: Record<string, number>
}

export type AssistantStoreLike = {
  get<Key extends keyof AssistantPreferences>(key: Key): AssistantPreferences[Key]
  set<Key extends keyof AssistantPreferences>(key: Key, value: AssistantPreferences[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 内库',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
  preferenceCounts: {}
}
```

Update `loadAssistantPreferences` to return normalized ledgers and boolean prompt state:

```ts
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
```

Update `saveAssistantPreferences`:

```ts
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
```

Modify `electron/preload/index.ts` only if the local imported `AssistantPreferences` type no longer compiles; keep the API names `loadPreferences` and `savePreferences`.

Modify `src/renderer/src/global.d.ts`:

```ts
import type { AssistantPreferences } from '@shared/types'

type BilimiDesktopApi = {
  version: string
  loadPreferences: () => Promise<AssistantPreferences>
  onOpenInTab?: (callback: (url: string) => void) => () => void
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
```

Modify `src/renderer/src/features/state/assistantState.ts`:

```ts
import type { AssistantAction, AssistantPreferences, FavoriteLedgerId } from '@shared/types'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '@shared/favoriteLedgers'

export type AssistantState = {
  lastAction: AssistantAction | null
  preferenceCounts: Record<string, number>
}

export type AssistantStateEvent = {
  type: 'record-feedback'
  kind: FavoriteLedgerId
  action: AssistantAction
}

export function createInitialAssistantState(): AssistantState {
  return {
    lastAction: null,
    preferenceCounts: {}
  }
}

export function createInitialAssistantPreferences(
  persisted?: Partial<AssistantPreferences>
): AssistantPreferences {
  return {
    favoritesFolderName: persisted?.favoritesFolderName ?? 'Bilimi 内库',
    favoriteLedgers: normalizeFavoriteLedgers(persisted?.favoriteLedgers ?? createDefaultFavoriteLedgers()),
    ledgerPromptDismissed: Boolean(persisted?.ledgerPromptDismissed),
    preferenceCounts: {
      ...(persisted?.preferenceCounts ?? {})
    }
  }
}

export function recordAssistantPreferenceFeedback(
  preferences: AssistantPreferences,
  kind: FavoriteLedgerId,
  _action: AssistantAction
): AssistantPreferences {
  return {
    ...preferences,
    preferenceCounts: {
      ...preferences.preferenceCounts,
      [kind]: (preferences.preferenceCounts[kind] ?? 0) + 1
    }
  }
}

export function reduceAssistantState(
  state: AssistantState,
  event: AssistantStateEvent
): AssistantState {
  if (event.type === 'record-feedback') {
    return {
      lastAction: event.action,
      preferenceCounts: {
        ...state.preferenceCounts,
        [event.kind]: (state.preferenceCounts[event.kind] ?? 0) + 1
      }
    }
  }

  return state
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- electron/main/store.test.ts src/renderer/src/features/state/assistantState.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/store.ts electron/main/store.test.ts electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/features/state/assistantState.ts src/renderer/src/features/state/assistantState.test.ts
git commit -m "feat: persist favorite ledger preferences"
```

---

### Task 3: Ledger Classification

**Files:**
- Modify: `src/renderer/src/features/recommendation/videoClassifier.ts`
- Modify: `src/renderer/src/features/recommendation/videoClassifier.test.ts`
- Modify: `src/renderer/src/features/recommendation/recommendationRules.ts`
- Modify: `src/renderer/src/features/recommendation/recommendationRules.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Replace classifier expectations in `videoClassifier.test.ts` with:

```ts
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { classifyVideoContent } from './videoClassifier'

describe('classifyVideoContent', () => {
  it('classifies common Bilibili topics into the default ledger ids', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '爆笑整活鬼畜合集' }, ledgers).ledgerId).toBe('humor')
    expect(classifyVideoContent({ title: '第十二集剧情反转名场面' }, ledgers).ledgerId).toBe('story')
    expect(classifyVideoContent({ title: '电竞赛事操作技巧复盘' }, ledgers).ledgerId).toBe('play')
    expect(classifyVideoContent({ title: '周末探店美食 Vlog' }, ledgers).ledgerId).toBe('life')
    expect(classifyVideoContent({ title: '效率软件与数码工具测评' }, ledgers).ledgerId).toBe('craft')
    expect(classifyVideoContent({ title: '现场翻唱舞台演奏' }, ledgers).ledgerId).toBe('music')
  })

  it('prioritizes enabled custom ledgers over default ledgers', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: -10,
        isDefault: false
      }
    ]

    expect(classifyVideoContent({ title: '摄影镜头构图教程' }, ledgers)).toMatchObject({
      ledgerId: 'custom-photo',
      displayName: 'Bilimi·光影留真',
      matchedKeywords: ['摄影', '镜头'],
      reviewRequired: false
    })
  })

  it('skips disabled ledgers and falls back to inbox when no category is clear', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'craft' ? { ...ledger, enabled: false } : ledger
    )

    expect(classifyVideoContent({ title: '效率软件工具' }, ledgers).ledgerId).toBe('inbox')
    expect(classifyVideoContent({ title: '今天随便看看' }, ledgers).ledgerId).toBe('inbox')
  })

  it('marks risk signals for review while using inbox as the destination', () => {
    const result = classifyVideoContent(
      { title: '带货软广避雷测评', pageText: '标题党和夸大宣传较多' },
      createDefaultFavoriteLedgers()
    )

    expect(result).toMatchObject({
      ledgerId: 'inbox',
      displayName: 'Bilimi·暂存待阅',
      reviewRequired: true
    })
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['带货', '软广', '避雷']))
  })
})
```

Add this test to `recommendationRules.test.ts`:

```ts
it('describes default and custom favorite ledgers', () => {
  expect(describeRecommendation('knowledge')).toEqual({
    badge: '可阅',
    summary: '此条可增广见闻，宜列案头。'
  })
  expect(describeRecommendation('inbox')).toEqual({
    badge: '待分拣',
    summary: '此条暂存待阅，容后再归册。'
  })
  expect(describeRecommendation('custom-photo')).toEqual({
    badge: '可藏',
    summary: '此条合入自定册目，可请掌库留档。'
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/recommendation/recommendationRules.test.ts`

Expected: FAIL because `classifyVideoContent` returns a string and recommendation labels do not include the eight ledgers.

- [ ] **Step 3: Implement ledger classification**

Modify `videoClassifier.ts` so its public API is:

```ts
import type { FavoriteLedger, FavoriteLedgerClassification } from '@shared/types'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'

export type VideoContentContext = {
  title?: string
  description?: string
  pageText?: string
  tags?: string[]
}

const RISK_KEYWORDS = ['带货', '广告', '软广', '恰饭', '推广', '避雷', '割韭菜', '骗局', '夸大', '引流', '标题党']

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function buildSearchText(context: VideoContentContext) {
  return normalize(
    [context.title, context.description, context.pageText, ...(context.tags ?? [])]
      .filter(Boolean)
      .join(' ')
  )
}

function matchedKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(normalize(keyword)))
}

function inboxLedger(ledgers: FavoriteLedger[]) {
  return (
    ledgers.find((ledger) => ledger.id === 'inbox') ??
    createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!
  )
}

export function classifyVideoContent(
  context: VideoContentContext,
  ledgers: FavoriteLedger[] = createDefaultFavoriteLedgers()
): FavoriteLedgerClassification {
  const text = buildSearchText(context)
  const enabledLedgers = ledgers
    .filter((ledger) => ledger.enabled)
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? 1 : -1
      }

      return left.priority - right.priority
    })
  const inbox = inboxLedger(ledgers)
  const riskMatches = matchedKeywords(text, RISK_KEYWORDS)

  if (!text) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false
    }
  }

  if (riskMatches.length > 0) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: riskMatches,
      reviewRequired: true
    }
  }

  const scored = enabledLedgers
    .filter((ledger) => ledger.id !== 'inbox')
    .map((ledger) => ({
      ledger,
      matches: matchedKeywords(text, ledger.keywords)
    }))
    .filter((entry) => entry.matches.length > 0)
    .sort((left, right) => {
      if (right.matches.length !== left.matches.length) {
        return right.matches.length - left.matches.length
      }

      return left.ledger.priority - right.ledger.priority
    })

  const best = scored[0]

  if (!best) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false
    }
  }

  return {
    ledgerId: best.ledger.id,
    displayName: best.ledger.displayName,
    matchedKeywords: best.matches,
    reviewRequired: false
  }
}
```

Keep the existing `buildVideoContentContextScript()` function in the same file.

Modify `recommendationRules.ts`:

```ts
import type { FavoriteLedgerId, RecommendationLabel } from '@shared/types'

const MAP: Record<string, RecommendationLabel> = {
  humor: {
    badge: '可赏',
    summary: '此物颇能解闷，失仪而不鄙。'
  },
  knowledge: {
    badge: '可阅',
    summary: '此条可增广见闻，宜列案头。'
  },
  story: {
    badge: '请陛下过目',
    summary: '此段剧情渐起，不敢先泄其机。'
  },
  play: {
    badge: '可藏',
    summary: '此条技艺可观，宜入演武之册。'
  },
  life: {
    badge: '可藏',
    summary: '此条烟火可亲，可留作闲时翻阅。'
  },
  craft: {
    badge: '可藏',
    summary: '此条器用有法，可收作案头备查。'
  },
  music: {
    badge: '可赏',
    summary: '此声清亮可听，宜入清音册。'
  },
  inbox: {
    badge: '待分拣',
    summary: '此条暂存待阅，容后再归册。'
  }
}

const CUSTOM_LABEL: RecommendationLabel = {
  badge: '可藏',
  summary: '此条合入自定册目，可请掌库留档。'
}

export function describeRecommendation(kind: FavoriteLedgerId): RecommendationLabel {
  return MAP[kind] ?? CUSTOM_LABEL
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/recommendation/recommendationRules.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/recommendation/videoClassifier.ts src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/recommendation/recommendationRules.ts src/renderer/src/features/recommendation/recommendationRules.test.ts
git commit -m "feat: classify videos into favorite ledgers"
```

---

### Task 4: Favorite Ledger API Scripts

**Files:**
- Create: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] **Step 1: Write failing API script tests**

Create `favoriteLedgerApi.test.ts` with:

```ts
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it, vi } from 'vitest'
import {
  buildEnsureFavoriteLedgersScript,
  buildFavoriteLedgerStatusScript,
  buildExecuteFavoriteLedgerPlanScript
} from './favoriteLedgerApi'

function installCookies() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=32922854'
  })
}

describe('favorite ledger API scripts', () => {
  it('reports missing enabled Bilimi ledgers without creating them', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 1, title: 'Bilimi·见闻增广' }]
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildFavoriteLedgerStatusScript(createDefaultFavoriteLedgers()))

    expect(result.ok).toBe(true)
    expect(result.missingLedgerIds).toEqual(['humor', 'story', 'play', 'life', 'craft', 'music', 'inbox'])
    expect(result.ledgers.find((ledger) => ledger.id === 'knowledge')?.bilibiliFolderId).toBe('1')
  })

  it('creates only missing enabled ledgers', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [{ id: 1, title: 'Bilimi·见闻增广' }] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 2, title: 'created' } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript(createDefaultFavoriteLedgers().slice(0, 2)))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:humor'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    expect(requests[1].body).toContain('title=Bilimi%C2%B7%E8%8C%B6%E4%BD%99%E8%A7%A3%E9%A2%90')
  })

  it('appends old favorites without passing delete media ids', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·见闻增广',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:append:123'])
    expect(requests[0].body).toContain('add_media_ids=9001')
    expect(requests[0].body).toContain('del_media_ids=')
    expect(requests[0].body).not.toContain('del_media_ids=9001')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: FAIL because `favoriteLedgerApi.ts` does not exist.

- [ ] **Step 3: Implement status, ensure, and execute script builders**

Create `favoriteLedgerApi.ts` with these exports and payload shapes:

```ts
import type { FavoriteLedger } from '@shared/types'

export type FavoriteLedgerPreviewItem = {
  aid: number
  title: string
  sourceFolderTitle: string
  targetLedgerId: string
  targetFolderId: string
  targetDisplayName: string
  reviewRequired: boolean
  alreadyInTarget: boolean
  selected: boolean
}

function scriptPayload(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function buildFavoriteLedgerStatusScript(ledgers: FavoriteLedger[]): string {
  const payload = scriptPayload({ ledgers })

  return `
    (async () => {
      const payload = ${payload};
      const readCookie = (name) =>
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(name + '='))
          ?.slice(name.length + 1) || '';
      const csrf = readCookie('bili_jct');
      const mid = readCookie('DedeUserID');
      if (!csrf || !mid) {
        return { ok: false, ledgers: payload.ledgers, missingLedgerIds: [], message: '未能读取登录凭据，无法查验册目。' };
      }
      const listUrl = new URL('https://api.bilibili.com/x/v3/fav/folder/created/list-all');
      listUrl.searchParams.set('up_mid', String(mid));
      listUrl.searchParams.set('type', '2');
      const response = await fetch(listUrl.toString(), { credentials: 'include' });
      const json = await response.json();
      if (!response.ok || !json || json.code !== 0) {
        throw new Error(json?.message || response.statusText || 'Bilibili API request failed');
      }
      const folders = Array.isArray(json.data?.list) ? json.data.list : [];
      const nextLedgers = payload.ledgers.map((ledger) => {
        const folder = folders.find((candidate) => candidate?.title === ledger.displayName);
        return folder ? { ...ledger, bilibiliFolderId: String(folder.id || folder.fid) } : ledger;
      });
      return {
        ok: true,
        ledgers: nextLedgers,
        missingLedgerIds: nextLedgers.filter((ledger) => ledger.enabled && !ledger.bilibiliFolderId).map((ledger) => ledger.id),
        message: '册目查验已毕。'
      };
    })();
  `
}
```

Add `buildEnsureFavoriteLedgersScript` and `buildExecuteFavoriteLedgerPlanScript` in the same file. `buildEnsureFavoriteLedgersScript` must:

1. Read cookies `bili_jct` and `DedeUserID`.
2. Request `/x/v3/fav/folder/created/list-all`.
3. For each enabled ledger missing by exact `displayName`, POST `/x/v3/fav/folder/add` with `csrf`, `privacy=0`, and `title`.
4. Return `{ ok, ledgers, steps, missingTargets, message }`.
5. Use step names `api:ledger:list` and `api:ledger:create:<ledger.id>`.

`buildExecuteFavoriteLedgerPlanScript` must:

1. Accept selected preview items.
2. Skip `selected === false`, `alreadyInTarget === true`, and missing `targetFolderId`.
3. POST `/x/v3/fav/resource/deal` with `add_media_ids`, `csrf`, `del_media_ids: ''`, `rid`, `type: '2'`, `platform: 'web'`, `from_spmid: ''`, `spmid: '333.788.0.0'`, and `statistics`.
4. Return `{ ok, steps, missingTargets, message }`.
5. Use step names `api:ledger:append:<aid>`.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts
git commit -m "feat: add favorite ledger API scripts"
```

---

### Task 5: Old Favorites Preview Rules

**Files:**
- Create: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

- [ ] **Step 1: Write failing preview tests**

Create `favoriteLedgerPreview.test.ts`:

```ts
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { createFavoriteLedgerPreview } from './favoriteLedgerPreview'

describe('createFavoriteLedgerPreview', () => {
  it('excludes Bilimi-managed source folders and suggests append-only targets', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 101, title: '机器学习科普教程', description: '原理入门', tags: ['学习'] }]
        },
        {
          id: '2',
          title: 'Bilimi·见闻增广',
          videos: [{ aid: 102, title: '已归档知识', description: '', tags: [] }]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items).toEqual([
      expect.objectContaining({
        aid: 101,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'knowledge',
        targetFolderId: '9001',
        alreadyInTarget: false,
        selected: true
      })
    ])
  })

  it('marks items already in the target ledger as skipped', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'humor' ? { ...ledger, bilibiliFolderId: '9002' } : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 201, title: '爆笑整活合集', description: '', tags: ['搞笑'] }]
        }
      ],
      targetMembership: {
        '9002': [201]
      }
    })

    expect(preview.items[0]).toMatchObject({
      alreadyInTarget: true,
      selected: false
    })
  })

  it('uses inbox and requires review for risk signals', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: '9008' } : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 301, title: '带货软广避雷', description: '标题党', tags: [] }]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'inbox',
      reviewRequired: true,
      selected: false
    })
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

Expected: FAIL because `favoriteLedgerPreview.ts` does not exist.

- [ ] **Step 3: Implement pure preview rules**

Create `favoriteLedgerPreview.ts` with:

```ts
import { isBilimiManagedLedgerName } from '@shared/favoriteLedgers'
import type { FavoriteLedger } from '@shared/types'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'

export type FavoriteSourceVideo = VideoContentContext & {
  aid: number
  title: string
}

export type FavoriteSourceFolder = {
  id: string
  title: string
  videos: FavoriteSourceVideo[]
}

export type FavoriteLedgerPreviewItem = {
  aid: number
  title: string
  sourceFolderTitle: string
  targetLedgerId: string
  targetFolderId: string
  targetDisplayName: string
  reviewRequired: boolean
  alreadyInTarget: boolean
  selected: boolean
}

export type FavoriteLedgerPreview = {
  items: FavoriteLedgerPreviewItem[]
  skippedSourceFolderTitles: string[]
}

export function createFavoriteLedgerPreview(args: {
  ledgers: FavoriteLedger[]
  sourceFolders: FavoriteSourceFolder[]
  targetMembership: Record<string, number[]>
}): FavoriteLedgerPreview {
  const skippedSourceFolderTitles: string[] = []
  const items: FavoriteLedgerPreviewItem[] = []

  for (const folder of args.sourceFolders) {
    if (isBilimiManagedLedgerName(folder.title)) {
      skippedSourceFolderTitles.push(folder.title)
      continue
    }

    for (const video of folder.videos) {
      const classification = classifyVideoContent(video, args.ledgers)
      const targetLedger = args.ledgers.find((ledger) => ledger.id === classification.ledgerId)
      const targetFolderId = targetLedger?.bilibiliFolderId ?? ''
      const alreadyInTarget = targetFolderId
        ? (args.targetMembership[targetFolderId] ?? []).includes(video.aid)
        : false
      const selected = Boolean(targetFolderId) && !alreadyInTarget && !classification.reviewRequired

      items.push({
        aid: video.aid,
        title: video.title,
        sourceFolderTitle: folder.title,
        targetLedgerId: classification.ledgerId,
        targetFolderId,
        targetDisplayName: targetLedger?.displayName ?? classification.displayName,
        reviewRequired: classification.reviewRequired,
        alreadyInTarget,
        selected
      })
    }
  }

  return {
    items,
    skippedSourceFolderTitles
  }
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/favorites/favoriteLedgerPreview.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
git commit -m "feat: preview old favorite ledger organization"
```

---

### Task 6: Update Favorite Action Automation

**Files:**
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.ts`
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.test.ts`
- Modify: `src/renderer/src/features/actions/pageAutomation.ts`
- Modify: `src/renderer/src/features/actions/pageAutomation.test.ts`
- Modify: `src/renderer/src/features/actions/actionExecutor.ts`
- Modify: `src/renderer/src/features/actions/actionExecutor.test.ts`
- Modify: `src/renderer/src/features/actions/visualFavoriteFallback.ts`
- Modify: `src/renderer/src/features/actions/visualFavoriteFallback.test.ts`

- [ ] **Step 1: Write failing action tests**

In `favoriteApiAutomation.test.ts`, update the first test to call:

```ts
const ledgers = createDefaultFavoriteLedgers()
const result = await window.eval(buildFavoriteApiFallbackScript(ledgers, 'knowledge'))
```

Update the create-folder expectation to:

```ts
expect(requests[1].body).toContain('title=Bilimi%C2%B7%E8%A7%81%E9%97%BB%E5%A2%9E%E5%B9%BF')
```

Update the reuse test to use `Bilimi·茶余解颐` and target `humor`:

```ts
const result = await window.eval(buildFavoriteApiFallbackScript(createDefaultFavoriteLedgers(), 'humor'))
expect(requests[1].body).toContain('add_media_ids=91000001')
```

In `actionExecutor.test.ts`, update assertions that inspect visual fallback context:

```ts
expect(runVisualFallback).toHaveBeenCalledWith(
  expect.objectContaining({
    targetLedgerId: 'humor',
    favoriteFolders: expect.objectContaining({
      humor: 'Bilimi·茶余解颐'
    })
  })
)
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/actions/favoriteApiAutomation.test.ts src/renderer/src/features/actions/actionExecutor.test.ts`

Expected: FAIL because the action layer still accepts `recommendationKind` and the old four-folder map.

- [ ] **Step 3: Pass ledgers and target ledger IDs through automation**

Modify `favoriteApiAutomation.ts` signature:

```ts
import type { FavoriteLedger } from '@shared/types'

export function buildFavoriteApiFallbackScript(
  favoriteLedgers: FavoriteLedger[],
  targetLedgerId: string
): string {
  const payload = JSON.stringify({
    favoriteLedgers,
    targetLedgerId
  })
```

Inside the generated script, replace `targetFolderName` with:

```js
const targetLedger = payload.favoriteLedgers.find((ledger) => ledger.id === payload.targetLedgerId);
const targetFolderName = targetLedger?.displayName;
if (!targetFolderName) {
  return fail('favorite-api-target-ledger', '未能找到目标 Bilimi 册目。');
}
```

Keep `del_media_ids: ''` in the resource deal body.

Modify `pageAutomation.ts`:

1. Remove `BILIMI_FAVORITE_FOLDERS`.
2. Accept `favoriteLedgers: FavoriteLedger[]` and `targetLedgerId: string`.
3. Put both in the payload.
4. Resolve target folder by `payload.favoriteLedgers.find((ledger) => ledger.id === payload.targetLedgerId)?.displayName`.
5. When no Bilimi folder exists, create all enabled ledgers in `payload.favoriteLedgers`.

Modify `actionExecutor.ts`:

```ts
import { favoriteLedgerNamesById } from '@shared/favoriteLedgers'
import type { FavoriteLedger } from '@shared/types'

type ExecuteAssistantActionArgs = {
  action: AssistantAction
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  targetLedgerId: string
  runScript: (script: string) => Promise<AssistantAutomationResult>
  runVisualFallback?: VisualAutomationFallback
  coinCount?: 1 | 2
  commentDraft?: string
}
```

Pass `favoriteLedgers` and `targetLedgerId` to `buildAutomationScript` and `buildFavoriteApiFallbackScript`. Pass this visual context:

```ts
const visualResult = await args.runVisualFallback({
  favoriteFolders: favoriteLedgerNamesById(args.favoriteLedgers),
  favoritesFolderName: args.favoritesFolderName,
  targetLedgerId: args.targetLedgerId
})
```

Modify `visualFavoriteFallback.ts` so it reads `context.targetLedgerId` instead of `context.recommendationKind`.

- [ ] **Step 4: Run focused action tests**

Run: `npm test -- src/renderer/src/features/actions/favoriteApiAutomation.test.ts src/renderer/src/features/actions/actionExecutor.test.ts src/renderer/src/features/actions/pageAutomation.test.ts src/renderer/src/features/actions/visualFavoriteFallback.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/actions/favoriteApiAutomation.ts src/renderer/src/features/actions/favoriteApiAutomation.test.ts src/renderer/src/features/actions/pageAutomation.ts src/renderer/src/features/actions/pageAutomation.test.ts src/renderer/src/features/actions/actionExecutor.ts src/renderer/src/features/actions/actionExecutor.test.ts src/renderer/src/features/actions/visualFavoriteFallback.ts src/renderer/src/features/actions/visualFavoriteFallback.test.ts
git commit -m "feat: route favorite actions through ledgers"
```

---

### Task 7: 掌库 Panel UI

**Files:**
- Create: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing panel tests**

Create `FavoriteLedgerPanel.test.tsx`:

```tsx
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'

describe('FavoriteLedgerPanel', () => {
  it('shows missing ledgers and creates them through 备册', async () => {
    const onEnsureLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list', 'api:ledger:create:humor'],
      missingTargets: [],
      message: '册目已备齐。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers().slice(0, 2)}
        missingLedgerIds={['humor']}
        onClose={vi.fn()}
        onEnsureLedgers={onEnsureLedgers}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.getByText('掌库')).toBeInTheDocument()
    expect(screen.getByText('Bilimi·茶余解颐')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(onEnsureLedgers).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('册目已备齐。')
  })

  it('adds a custom ledger from a recommended name and saves keywords', () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onClose={vi.fn()}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('新增主题'), { target: { value: '摄影' } })
    fireEvent.click(screen.getByRole('button', { name: '荐名' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bilimi·光影留真' }))
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '摄影,镜头,构图' } })
    fireEvent.click(screen.getByRole('button', { name: '新增册目' }))

    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Bilimi·光影留真',
          keywords: ['摄影', '镜头', '构图'],
          enabled: true,
          isDefault: false
        })
      ])
    )
  })

  it('scans old favorites before executing append operations', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·见闻增广',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '整理旧藏已毕。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onClose={vi.fn()}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByText('机器学习科普教程')
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认归册' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith(preview.items))
  })
})
```

In `assistantOverlay.test.tsx`, add:

```tsx
it('opens 掌库 from the memorial panel', () => {
  render(<AssistantOverlay />)

  fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
  fireEvent.click(screen.getByRole('button', { name: '掌库' }))

  expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx`

Expected: FAIL because `FavoriteLedgerPanel` and the `掌库` button do not exist.

- [ ] **Step 3: Implement panel and overlay wiring**

Create `FavoriteLedgerPanel.tsx` with props:

```ts
import type { AssistantAutomationResult, FavoriteLedger } from '@shared/types'
import { suggestFavoriteLedgerNames } from '@shared/favoriteLedgers'
import { useMemo, useState } from 'react'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

type FavoriteLedgerPanelProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onClose: () => void
  onEnsureLedgers: () => Promise<AssistantAutomationResult>
  onSaveLedgers: (ledgers: FavoriteLedger[]) => void
  onScanOldFavorites: () => Promise<FavoriteLedgerPreview>
  onExecuteOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
}
```

The component must render:

1. `<section role="dialog" aria-label="掌库" className="favorite-ledger-panel">`.
2. A list of ledgers with display name, enabled state, and keywords.
3. A `备册` button that calls `onEnsureLedgers`.
4. Inputs with labels `新增主题` and `关键词`.
5. A `荐名` button that calls `suggestFavoriteLedgerNames(topic)`.
6. Buttons for each recommended name.
7. An `新增册目` button that appends a custom ledger with `id: custom-${Date.now()}`, `isDefault: false`, `enabled: true`, `priority: ledgers.length + 100`, and comma-split keywords.
8. A `整理旧藏` button that calls `onScanOldFavorites` and renders preview rows.
9. A `确认归册` button that calls `onExecuteOldFavoritePlan(preview.items)`.

Modify `MemorialPanel.tsx` props:

```ts
onOpenLedgerPanel?: () => void
```

Add a sixth action-area button outside the assistant action map:

```tsx
<button type="button" onClick={onOpenLedgerPanel}>
  掌库
</button>
```

Modify `AssistantOverlay.tsx`:

1. Track `ledgerPanelOpen`.
2. Pass `preferences.favoriteLedgers` to classification.
3. Use `currentClassification.ledgerId` and `currentClassification.displayName`.
4. Pass `favoriteLedgers` and `targetLedgerId` to `executeAssistantAction`.
5. Persist changed ledgers through `savePreferences`.
6. Open `FavoriteLedgerPanel` when the panel button is clicked.

Add CSS classes:

```css
.favorite-ledger-panel {
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 80px);
  overflow: auto;
  border: 1px solid rgba(113, 81, 48, 0.3);
  background: linear-gradient(180deg, #f4ead4 0%, #ece0c7 100%);
  color: #4b3321;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.34);
  padding: 14px;
}

.favorite-ledger-panel button,
.favorite-ledger-panel input {
  border: 1px solid rgba(113, 81, 48, 0.32);
  background: #fbf4e8;
  color: #6d4c2d;
  font: 13px "Noto Serif SC", "Songti SC", "SimSun", serif;
  padding: 6px 8px;
}
```

- [ ] **Step 4: Run UI tests and verify pass**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx src/renderer/src/styles.css
git commit -m "feat: add favorite ledger panel"
```

---

### Task 8: First-Open Prompt and App Integration

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Add this test to `assistantOverlay.test.tsx`:

```tsx
it('prompts first-time users to ask 掌库 when enabled ledgers are missing', async () => {
  render(
    <AssistantOverlay
      favoriteLedgerStatus={{
        ok: true,
        ledgers: [],
        missingLedgerIds: ['knowledge'],
        message: '册目缺失。'
      }}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

  expect(screen.getByText('Bilimi 专用册目尚未备齐，可请掌库先行备册。')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '请掌库' }))

  expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
})
```

Add this test to `App.test.tsx`:

```tsx
it('checks ledger status through the active webview and opens 掌库 setup', async () => {
  render(<App />)

  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  const executeJavaScript = vi.fn().mockResolvedValueOnce({
    ok: true,
    ledgers: [],
    missingLedgerIds: ['knowledge'],
    message: '册目缺失。'
  })

  Object.assign(webview, { executeJavaScript })

  fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

  await screen.findByText('Bilimi 专用册目尚未备齐，可请掌库先行备册。')

  fireEvent.click(screen.getByRole('button', { name: '请掌库' }))

  expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
  expect(executeJavaScript.mock.calls[0][0]).toContain('/x/v3/fav/folder/created/list-all')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx`

Expected: FAIL because ledger status is not read and the first-open prompt is not rendered.

- [ ] **Step 3: Wire active-webview ledger runners**

Modify `App.tsx` imports:

```ts
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript
} from './features/favorites/favoriteLedgerApi'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from './features/favorites/favoriteLedgerPreview'
```

Add functions near `runScript`:

```ts
async function readFavoriteLedgerStatus() {
  const status = await runScript(buildFavoriteLedgerStatusScript(preferences.favoriteLedgers))

  if ('ledgers' in status && 'missingLedgerIds' in status) {
    return status as unknown as FavoriteLedgerStatus
  }

  return {
    ok: false,
    ledgers: preferences.favoriteLedgers,
    missingLedgerIds: [],
    message: status.message
  }
}

async function ensureFavoriteLedgers() {
  return runScript(buildEnsureFavoriteLedgersScript(preferences.favoriteLedgers))
}

async function executeOldFavoritePlan(items: FavoriteLedgerPreviewItem[]) {
  return runScript(buildExecuteFavoriteLedgerPlanScript(items))
}
```

For `scanOldFavorites`, use a minimal first implementation that returns an empty preview until Task 9 adds full scan script execution:

```ts
async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
  return {
    items: [],
    skippedSourceFolderTitles: []
  }
}
```

Pass the callbacks to `AssistantOverlay`.

Modify `AssistantOverlay.tsx` to:

1. Accept `readFavoriteLedgerStatus`, `ensureFavoriteLedgers`, `scanOldFavorites`, and `executeOldFavoritePlan` props.
2. When opened, call `readFavoriteLedgerStatus` once if available.
3. Render the first-open prompt when `missingLedgerIds.length > 0` and `preferences.ledgerPromptDismissed === false`.
4. Persist `ledgerPromptDismissed: true` when the user closes or acts on the prompt.

- [ ] **Step 4: Run integration tests and verify pass**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx
git commit -m "feat: wire first-open ledger setup"
```

---

### Task 9: Old Favorites Scan Script

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing scan script test**

Add to `favoriteLedgerApi.test.ts`:

```ts
it('scans user folders while excluding Bilimi ledgers', async () => {
  installCookies()
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)

      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: {
            list: [
              { id: 1, title: '默认收藏夹', media_count: 1 },
              { id: 9001, title: 'Bilimi·见闻增广', media_count: 1 }
            ]
          }
        })
      }

      if (url.includes('/x/v3/fav/resource/list') && url.includes('media_id=1')) {
        return Response.json({
          code: 0,
          data: {
            medias: [
              {
                id: 101,
                title: '机器学习科普教程',
                intro: '原理入门',
                upper: { name: 'up' },
                bvid: 'BV101'
              }
            ],
            has_more: false
          }
        })
      }

      if (url.includes('/x/v3/fav/resource/list') && url.includes('media_id=9001')) {
        return Response.json({
          code: 0,
          data: {
            medias: [{ id: 101, title: '机器学习科普教程' }],
            has_more: false
          }
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })
  )

  const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers()))

  expect(result.ok).toBe(true)
  expect(result.sourceFolders).toEqual([
    expect.objectContaining({
      title: '默认收藏夹',
      videos: [expect.objectContaining({ aid: 101, title: '机器学习科普教程' })]
    })
  ])
  expect(result.targetMembership).toEqual({ '9001': [101] })
  expect(requests.some((url) => url.includes('media_id=1'))).toBe(true)
  expect(requests.some((url) => url.includes('media_id=9001'))).toBe(true)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: FAIL because `buildScanOldFavoritesScript` is not exported.

- [ ] **Step 3: Implement scan script and App preview creation**

Add `buildScanOldFavoritesScript(ledgers: FavoriteLedger[])` to `favoriteLedgerApi.ts`. The generated script must:

1. Read `DedeUserID`; fail with `favorite-api-user` when missing.
2. Fetch `/x/v3/fav/folder/created/list-all`.
3. Read all folders from `data.list`.
4. Fetch resource pages through `/x/v3/fav/resource/list?media_id=<folder id>&pn=<page>&ps=20&type=0&order=mtime&platform=web`.
5. For non-Bilimi folders, return `sourceFolders`.
6. For Bilimi folders, return `targetMembership` keyed by folder id.
7. Include source videos as `{ aid, title, description, pageText, tags }`, using `media.id` as `aid`, `media.title` as `title`, and `media.intro` as `description`.

Modify `App.tsx` `scanOldFavorites`:

```ts
async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
  const scanResult = await runScript(buildScanOldFavoritesScript(preferences.favoriteLedgers)) as unknown as {
    ok: boolean
    sourceFolders: FavoriteSourceFolder[]
    targetMembership: Record<string, number[]>
    message: string
  }

  if (!scanResult.ok) {
    return {
      items: [],
      skippedSourceFolderTitles: []
    }
  }

  return createFavoriteLedgerPreview({
    ledgers: preferences.favoriteLedgers,
    sourceFolders: scanResult.sourceFolders,
    targetMembership: scanResult.targetMembership
  })
}
```

- [ ] **Step 4: Run scan tests and App tests**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "feat: scan old favorites for ledger preview"
```

---

### Task 10: Full Verification

**Files:**
- Existing test files across `electron`, `src/shared`, and `src/renderer/src`

- [ ] **Step 1: Run focused suites**

Run:

```bash
npm test -- src/shared/favoriteLedgers.test.ts electron/main/store.test.ts src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx src/renderer/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS with Electron Vite build output for main, preload, and renderer.

- [ ] **Step 4: Manual browser check**

Run:

```bash
npm run dev
```

Expected: Electron opens Bilimi. Open the assistant panel, click `掌库`, verify the panel is visible, verify `备册` can be clicked without UI overlap, and verify the old favorite preview appears before `确认归册`.

- [ ] **Step 5: Commit final fixes if verification required changes**

```bash
git add src electron
git commit -m "fix: polish favorite ledger verification issues"
```

Only run this commit command if Step 1, Step 2, Step 3, or Step 4 required source changes.

---

## Self-Review

- Spec coverage: The plan covers first-open prompt, 掌库 button, default ledgers, custom ledgers with recommended names, old-favorite preview before execution, append-only execution, persistence, shared config, and tests.
- Type consistency: The plan consistently uses `FavoriteLedger`, `FavoriteLedgerId`, `FavoriteLedgerClassification`, `targetLedgerId`, and `favoriteLedgers`.
- Safety coverage: Tasks 4, 5, 6, and 9 preserve the hard rule that old favorites are appended into Bilimi folders and never removed from user source folders.
