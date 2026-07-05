# 分类准度与归档预览交互改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-05-classification-archive-preview-design.md` 实现更可靠的本地分类、可撤回的归档预览计划、DeepSeek 归档预览整理、DeepSeek 日常归类辅助判断，以及纠错学习和关键词建议管理。

**Architecture:** 先把分类结果和归档预览状态抽成可单测的纯逻辑模块，再让 `FavoriteLedgerPanel` 只负责渲染和调度。DeepSeek 继续复用现有主进程 `deepseek:generate` 通道，但新增专门请求类型、结构化校验和预览计划应用层，确保 AI 不直接移动 B 站收藏。纠错学习和关键词建议作为偏好持久化数据进入 `AssistantPreferences` 与 Electron store，分类器按开关读取已确认记录。

**Tech Stack:** Electron + React 19 + TypeScript + Vitest + Testing Library；现有 `electron-store` 持久化；现有 DeepSeek IPC 与 `generateDeepSeekResult` 服务；现有 `npm test`、`npm run build`、`npm run preview`、`npm run dist:win` 验收命令。

---

## 当前代码地图

- `src/shared/types.ts`：全局类型。需要新增整理策略、分类诊断、纠错学习、关键词建议、DeepSeek 归类设置和 DeepSeek 输出类型。
- `src/shared/favoriteLedgers.ts`：默认 bilimi 收藏夹与默认关键词。需要调整裸弱词展示、补充组合词和概念词。
- `src/renderer/src/features/recommendation/videoClassifier.ts`：当前本地分类器，主要是归一化后的关键词包含与字段权重。需要拆出归一化、词库、打分、诊断、纠错学习参与分类。
- `src/renderer/src/features/recommendation/archivePlanning.ts`：当前归档目标选择，有第二套打分。需要改为消费新版分类结果，按整理策略决定默认点亮。
- `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`：旧藏扫描后生成预览项。需要记录原始建议、当前计划、低置信诊断、来源线索、DeepSeek 标记和撤回快照。
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`：掌库 UI 和归档预览交互。需要把预览状态操作下沉到纯逻辑模块，UI 增加分组编辑、下拉、撤回、DeepSeek 整理按钮、红字位移提示、展开交互。
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`：设置页、偏好保存、日常赏/藏/赐入口调度。需要新增整理策略、纠错学习、关键词建议和 DeepSeek 日常辅助判断设置，并在日常收藏流程中应用 DeepSeek 二判。
- `src/renderer/src/features/state/assistantState.ts` 与 `electron/main/store.ts`：偏好归一化和持久化。需要保存新增设置、纠错记录和建议列表。
- `electron/main/deepseekService.ts`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`：DeepSeek 请求类型和桥接。需要增加 `favorite-archive-organize` 与 `favorite-daily-classify-review` 两类结构化请求。
- 现有测试入口：`videoClassifier.test.ts`、`archivePlanning.test.ts`、`favoriteLedgerPreview.test.ts`、`FavoriteLedgerPanel.test.tsx`、`FloatingAssistantApp.test.tsx`、`assistantState.test.ts`、`store.test.ts`、`deepseekService.test.ts`、`styles.test.ts`、`App.test.tsx`。

## 交付切分与提交规则

- 每个任务完成后运行任务内列出的测试；该任务所有测试通过后单独 `git commit`。
- 不把 Windows 打包验收混入普通开发任务。普通实现阶段跑单元测试、构建、dev 手动验收和 preview 手动验收；准备 Windows 安装包或发布时，再按 `docs/release-checklist.md` 完成 dev、preview、安装包三种形态关键路径验收。
- 先落纯逻辑和测试，再接 UI，再接 DeepSeek，再接持久化与端到端验收。

---

### Task 1: 新版分类类型、词库与默认关键词

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/favoriteLedgers.ts`
- Create: `src/renderer/src/features/recommendation/classificationLexicon.ts`
- Create: `src/renderer/src/features/recommendation/classificationText.ts`
- Test: `src/renderer/src/features/recommendation/classificationText.test.ts`
- Test: `src/shared/favoriteLedgers.test.ts`

- [ ] **Step 1: 写文本归一化失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeClassificationText, tokenizeClassificationText } from './classificationText'

describe('classificationText', () => {
  it('normalizes full-width punctuation, spaces, book marks, and case', () => {
    expect(normalizeClassificationText('《崩坏：星穹 铁道》 HSR')).toBe('崩坏星穹铁道hsr')
    expect(normalizeClassificationText('Genshin Impact')).toBe('genshinimpact')
  })

  it('keeps useful token order for phrase diagnostics', () => {
    expect(tokenizeClassificationText('科普小常识 / 冷知识')).toEqual(['科普', '小', '常识', '冷', '知识'])
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- src/renderer/src/features/recommendation/classificationText.test.ts`

Expected: FAIL，原因是 `classificationText.ts` 尚未创建。

- [ ] **Step 3: 实现归一化工具**

在 `classificationText.ts` 提供：

```ts
const SEPARATOR_PATTERN = /[\s《》<>【】\[\]（）()「」『』·,，、/\\|:：;；!！?？._-]+/g

export function normalizeClassificationText(value = ''): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(SEPARATOR_PATTERN, '')
}

export function tokenizeClassificationText(value = ''): string[] {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[《》<>【】\[\]（）()「」『』]/g, ' ')
    .split(/[\s,，、/\\|:：;；!！?？._-]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
}
```

- [ ] **Step 4: 新增分类词库常量**

在 `classificationLexicon.ts` 导出这些结构，命名必须稳定，后续任务直接引用：

```ts
export type ClassificationSignalStrength = 'strong' | 'weak'

export type ClassificationEntityAlias = {
  canonical: string
  aliases: string[]
  ledgerId: string
}

export type ClassificationConceptCluster = {
  id: string
  ledgerId: string
  phrases: string[]
}

export const GAME_ENTITY_ALIASES: ClassificationEntityAlias[] = [
  { canonical: '原神', ledgerId: 'game', aliases: ['原神', 'genshin'] },
  { canonical: '崩坏：星穹铁道', ledgerId: 'game', aliases: ['崩坏：星穹铁道', '崩坏星穹铁道', '星穹铁道', '星铁', '崩铁', 'hsr'] },
  { canonical: '崩坏3', ledgerId: 'game', aliases: ['崩坏3', '崩坏三', '崩三', '崩坏学园3'] },
  { canonical: '绝区零', ledgerId: 'game', aliases: ['绝区零', 'zzz'] },
  { canonical: '明日方舟', ledgerId: 'game', aliases: ['明日方舟', '方舟', '舟游'] },
  { canonical: '鸣潮', ledgerId: 'game', aliases: ['鸣潮'] },
  { canonical: '王者荣耀', ledgerId: 'game', aliases: ['王者荣耀', '王者'] },
  { canonical: '英雄联盟', ledgerId: 'game', aliases: ['英雄联盟', 'lol', '联盟'] },
  { canonical: '无畏契约', ledgerId: 'game', aliases: ['无畏契约', '瓦', '瓦罗兰特', 'valorant'] },
  { canonical: '我的世界', ledgerId: 'game', aliases: ['我的世界', 'minecraft', 'mc'] }
]

export const CONCEPT_CLUSTERS: ClassificationConceptCluster[] = [
  { id: 'knowledge', ledgerId: 'knowledge', phrases: ['科普', '常识', '冷知识', '小知识', '知识点', '原理', '讲解', '教程', '课程', '公开课', '学习'] },
  { id: 'life', ledgerId: 'life-interest', phrases: ['生活攻略', '旅行攻略', '出行路线', '装修避坑', '收纳技巧', '做饭教程', '健身计划', '护肤步骤', '家居改造'] },
  { id: 'movie-tv', ledgerId: 'movie-tv', phrases: ['影视剧情', '番剧剧情', '电影剧情', '剧情解析', '电影解说', '电视剧解说', '名场面', '角色分析', '演员访谈', '预告片'] },
  { id: 'game', ledgerId: 'game', phrases: ['游戏攻略', '游戏剧情', '配队', '抽卡', '深渊', '通关', 'boss', '主线', '支线', '实况', '赛事'] },
  { id: 'creative', ledgerId: 'creative-aesthetic', phrases: ['摄影教程', '调色', '构图', '绘画教程', '建模', '手作', '设计', '穿搭'] },
  { id: 'music', ledgerId: 'music', phrases: ['翻唱', '演奏', 'mv', '现场', '舞台', '编曲', '作曲'] },
  { id: 'entertainment', ledgerId: 'entertainment', phrases: ['整活', '吐槽', 'reaction', '综艺', '脱口秀', '搞笑', '鬼畜'] }
]

export const WEAK_CLASSIFICATION_TERMS = ['攻略', '剧情', '教程', '教学', '入门', '实战', '测评', '剪辑', '解说', '名场面']
```

- [ ] **Step 5: 调整默认关键词测试**

在 `favoriteLedgers.test.ts` 增加断言：

```ts
it('uses combination phrases for ambiguous default keywords', () => {
  const ledgers = createDefaultFavoriteLedgers()
  const game = ledgers.find((ledger) => ledger.id === 'game')
  const movie = ledgers.find((ledger) => ledger.id === 'movie-tv')
  const life = ledgers.find((ledger) => ledger.id === 'life-interest')
  const knowledge = ledgers.find((ledger) => ledger.id === 'knowledge')

  expect(game?.keywords).toEqual(expect.arrayContaining(['游戏攻略', '游戏剧情']))
  expect(movie?.keywords).toEqual(expect.arrayContaining(['影视剧情', '番剧剧情', '电影剧情']))
  expect(life?.keywords).toEqual(expect.arrayContaining(['生活攻略', '旅行攻略', '装修攻略', '收纳技巧']))
  expect(knowledge?.keywords).toEqual(expect.arrayContaining(['知识科普', '科普常识', '冷知识', '小知识', '原理讲解']))
})
```

- [ ] **Step 6: 修改默认关键词**

在 `favoriteLedgers.ts` 中：

- `game` 保留实体和明确游戏词，增加 `游戏攻略`、`游戏剧情`，移除裸 `攻略`、`剧情`。
- `movie-tv` 增加 `影视剧情`、`番剧剧情`、`电影剧情`，移除裸 `剧情`。
- `life-interest` 增加 `生活攻略`、`旅行攻略`、`装修攻略`、`收纳技巧`、`做饭教程`、`护肤教程`、`健身计划`。
- `knowledge` 增加 `知识科普`、`科普常识`、`冷知识`、`小知识`、`原理讲解`、`软件教程`、`编程教程`、`课程学习`，保留裸 `教程`、`教学`、`入门`、`实战`、`测评` 作为展示词，后续由分类器按弱词解释。

- [ ] **Step 7: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/recommendation/classificationText.test.ts src/shared/favoriteLedgers.test.ts`

Expected: PASS。

Commit:

```bash
git add src/shared/types.ts src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts src/renderer/src/features/recommendation/classificationLexicon.ts src/renderer/src/features/recommendation/classificationText.ts src/renderer/src/features/recommendation/classificationText.test.ts
git commit -m "feat: add classification lexicon and normalization"
```

---

### Task 2: 分类引擎打分、诊断、置信度和整理策略

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/recommendation/videoClassifier.ts`
- Modify: `src/renderer/src/features/recommendation/archivePlanning.ts`
- Test: `src/renderer/src/features/recommendation/videoClassifier.test.ts`
- Test: `src/renderer/src/features/recommendation/archivePlanning.test.ts`

- [ ] **Step 1: 扩展类型**

在 `src/shared/types.ts` 新增：

```ts
export type FavoriteArchiveStrategy = 'aggressive' | 'balanced' | 'conservative'
export type ClassificationConfidenceLevel = 'high' | 'medium' | 'low'

export type FavoriteLedgerClassificationDiagnostic = {
  score: number
  runnerUpLedgerId?: FavoriteLedgerId
  runnerUpScore?: number
  scoreGap: number
  confidence: ClassificationConfidenceLevel
  lowConfidence: boolean
  matchedKeywords: string[]
  strongSignals: string[]
  weakSignals: string[]
  entityAliases: string[]
  conceptClusters: string[]
  positiveRules: string[]
  negativeRules: string[]
}
```

扩展 `FavoriteLedgerClassification`：

```ts
diagnostic?: FavoriteLedgerClassificationDiagnostic
```

- [ ] **Step 2: 写分类测试**

在 `videoClassifier.test.ts` 新增覆盖 spec 的用例：

```ts
it('classifies concept variants without requiring exact keyword copies', () => {
  const ledgers = createDefaultFavoriteLedgers()

  expect(classifyVideoContent({ title: '科普小常识合集' }, ledgers).ledgerId).toBe('knowledge')
  expect(classifyVideoContent({ title: '科普常识' }, ledgers).ledgerId).toBe('knowledge')
  expect(classifyVideoContent({ title: '知识科普' }, ledgers).ledgerId).toBe('knowledge')
  expect(classifyVideoContent({ title: '冷知识十连发' }, ledgers).ledgerId).toBe('knowledge')
})

it('uses context to disambiguate攻略 and剧情', () => {
  const ledgers = createDefaultFavoriteLedgers()

  expect(classifyVideoContent({ title: '东京旅行攻略' }, ledgers).ledgerId).toBe('life-interest')
  expect(classifyVideoContent({ title: '装修避坑攻略' }, ledgers).ledgerId).toBe('life-interest')
  expect(classifyVideoContent({ title: '原神攻略' }, ledgers).ledgerId).toBe('game')
  expect(classifyVideoContent({ title: '星铁剧情解析' }, ledgers).ledgerId).toBe('game')
  expect(classifyVideoContent({ title: '第十二集剧情反转' }, ledgers).ledgerId).toBe('movie-tv')
  expect(classifyVideoContent({ title: '电影剧情解析' }, ledgers).ledgerId).toBe('movie-tv')
})

it('emits confidence diagnostics and low-confidence markers', () => {
  const result = classifyVideoContent({ title: '攻略教程入门' }, createDefaultFavoriteLedgers())

  expect(result.diagnostic).toMatchObject({
    confidence: 'low',
    lowConfidence: true,
    weakSignals: expect.arrayContaining(['攻略', '教程', '入门'])
  })
})

it('does not classify consumer contexts as knowledge only because of测评', () => {
  const ledgers = createDefaultFavoriteLedgers()

  expect(classifyVideoContent({ title: '护肤品测评避坑' }, ledgers).ledgerId).not.toBe('knowledge')
  expect(classifyVideoContent({ title: '新能源车测评试驾' }, ledgers).ledgerId).not.toBe('knowledge')
  expect(classifyVideoContent({ title: '效率软件与数码工具测评' }, ledgers).ledgerId).toBe('knowledge')
})
```

- [ ] **Step 3: 实现本地分类流程**

改造 `videoClassifier.ts`：

- 使用 `normalizeClassificationText` 代替本地 `normalize`。
- 先识别 `GAME_ENTITY_ALIASES` 和 `CONCEPT_CLUSTERS`。
- 将 ledger 打分结果统一成内部结构：

```ts
type LedgerScore = {
  ledger: FavoriteLedger
  score: number
  explicitScore: number
  matchedKeywords: string[]
  strongSignals: string[]
  weakSignals: string[]
  entityAliases: string[]
  conceptClusters: string[]
  positiveRules: string[]
  negativeRules: string[]
}
```

- 强信号分值建议：实体别名 +18，明确 tag +10，组合词 +8，概念簇 +6。
- 弱词分值建议：每个弱词 +1.5，弱词不能让 score 单独超过低置信阈值。
- 多义组合规则按 spec 建表，不写分散 `if`。每条规则包含 `ledgerId`、`contexts`、`ambiguousTerms`、`bonus`、`label`。
- 反向约束按 spec 建表。命中生活语境降低游戏裸攻略分，命中影视语境降低游戏裸剧情分，命中游戏实体降低影视裸剧情分，命中消费/护肤/汽车/美食语境降低知识裸测评分。
- 排序仍保留现有原则：自定义和 author/tag 规则可优先，但必须携带诊断。
- 低置信判定建议：`score < 7`、`scoreGap < 2.5`、只有弱词、或命中明显冲突反向约束。

- [ ] **Step 4: 写整理策略测试**

在 `archivePlanning.test.ts` 增加：

```ts
it('applies archive strategy to default selected state', () => {
  const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
    ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
  )

  const lowSignal = { title: '教程入门' }

  expect(
    planFavoriteArchiveTargets({
      context: lowSignal,
      ledgers,
      multiArchiveMode: 'off',
      archiveStrategy: 'aggressive'
    })[0]?.selectedByStrategy
  ).toBe(true)

  expect(
    planFavoriteArchiveTargets({
      context: lowSignal,
      ledgers,
      multiArchiveMode: 'off',
      archiveStrategy: 'conservative'
    })[0]?.selectedByStrategy
  ).toBe(false)
})
```

- [ ] **Step 5: 改归档计划消费新版分类**

在 `archivePlanning.ts`：

- 给 `planFavoriteArchiveTargets` 参数加 `archiveStrategy?: FavoriteArchiveStrategy`。
- 给 `FavoriteArchiveTarget` 加 `diagnostic?: FavoriteLedgerClassificationDiagnostic` 和 `selectedByStrategy: boolean`。
- 移除与 `videoClassifier.ts` 重复的默认分类打分路径，保留自定义多目标排序时需要的最小辅助函数。
- `aggressive`：非 inbox 且非 reviewRequired 默认选中，低置信仍选中但带诊断。
- `balanced`：强实体、明确 tag、组合词、分差足够时选中；只有弱词或低分差不选中。
- `conservative`：只在 `confidence === 'high' && !lowConfidence` 时选中。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/recommendation/archivePlanning.test.ts`

Expected: PASS。

Commit:

```bash
git add src/shared/types.ts src/renderer/src/features/recommendation/videoClassifier.ts src/renderer/src/features/recommendation/archivePlanning.ts src/renderer/src/features/recommendation/videoClassifier.test.ts src/renderer/src/features/recommendation/archivePlanning.test.ts
git commit -m "feat: improve favorite classification confidence"
```

---

### Task 3: 归档预览计划状态模型

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Create: `src/renderer/src/features/favorites/favoriteArchivePlanState.ts`
- Test: `src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

- [ ] **Step 1: 写纯状态测试**

```ts
import { describe, expect, it } from 'vitest'
import { applyArchivePlanSelection, createArchivePlanState, revertArchivePlanItem } from './favoriteArchivePlanState'

const item = {
  aid: 101,
  title: '东京旅行攻略',
  sourceFolderTitle: '默认收藏夹',
  originalSuggestedLedgerIds: ['life-interest'],
  currentTargetLedgerIds: ['life-interest'],
  selectedTargetLedgerIds: ['life-interest'],
  userModified: false
}

describe('favoriteArchivePlanState', () => {
  it('moves one item to another ledger and keeps original suggestion', () => {
    const state = createArchivePlanState([item])
    const next = applyArchivePlanSelection(state, 101, ['knowledge'], 'user')

    expect(next.items[0]).toMatchObject({
      originalSuggestedLedgerIds: ['life-interest'],
      currentTargetLedgerIds: ['knowledge'],
      selectedTargetLedgerIds: ['knowledge'],
      userModified: true,
      lastChangeSource: 'user'
    })
  })

  it('reverts one item to the original preview state', () => {
    const changed = applyArchivePlanSelection(createArchivePlanState([item]), 101, [], 'user')
    const reverted = revertArchivePlanItem(changed, 101)

    expect(reverted.items[0]).toMatchObject({
      currentTargetLedgerIds: ['life-interest'],
      selectedTargetLedgerIds: ['life-interest'],
      userModified: false
    })
  })
})
```

- [ ] **Step 2: 实现状态模型**

`favoriteArchivePlanState.ts` 导出：

```ts
export type FavoriteArchivePlanChangeSource = 'classifier' | 'user' | 'deepseek' | 'rejudge'

export type FavoriteArchivePlanItemState = {
  aid: number
  title: string
  sourceFolderTitle: string
  originalSuggestedLedgerIds: string[]
  currentTargetLedgerIds: string[]
  selectedTargetLedgerIds: string[]
  userModified: boolean
  lastChangeSource: FavoriteArchivePlanChangeSource
}

export type FavoriteArchivePlanState = {
  items: FavoriteArchivePlanItemState[]
  originalItemsByAid: Record<number, FavoriteArchivePlanItemState>
}
```

并提供：

- `createArchivePlanState(items)`：深拷贝生成原始快照。
- `applyArchivePlanSelection(state, aid, ledgerIds, source)`：改当前目标和已点亮目标。
- `moveArchivePlanItemToUnclassified(state, aid, source)`：清空真实目标，状态进入未匹配区域。
- `revertArchivePlanItem(state, aid)`：恢复单条。
- `revertArchivePlanArea(state, areaLedgerId | 'unclassified')`：恢复当前区域所有改动。
- `buildExecutableArchivePlan(state, ledgers)`：只返回蓝色点亮的真实 bilimi 收藏夹目标，不包含 `unclassified`。

- [ ] **Step 3: 扩展预览项字段**

在 `favoriteLedgerPreview.ts` 的 `FavoriteLedgerPreviewItem` 上增加：

- `originalSuggestedLedgerIds: string[]`
- `currentTargetLedgerIds: string[]`
- `selectedTargetLedgerIds: string[]`
- `classificationDiagnostic?: FavoriteLedgerClassificationDiagnostic`
- `lowConfidence: boolean`
- `originalSuggestionLabel?: string`

生成 preview 时：

- `originalSuggestedLedgerIds` 来自 `archiveTargets.map(target => target.ledgerId)`。
- `selectedTargetLedgerIds` 只包含 `selectedByStrategy` 且不是 inbox 的真实目标。
- 未匹配项默认空数组，不进入执行计划。

- [ ] **Step 4: 写预览生成测试**

在 `favoriteLedgerPreview.test.ts` 增加：

```ts
it('stores original suggestions, current targets, selected targets, and low-confidence diagnostics', () => {
  const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
    ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
  )
  const preview = createFavoriteLedgerPreview({
    ledgers,
    sourceFolders: [{ id: '1', title: '默认收藏夹', videos: [{ aid: 1, title: '教程入门' }] }],
    targetMembership: {},
    archiveStrategy: 'conservative'
  })

  expect(preview.items[0]).toMatchObject({
    originalSuggestedLedgerIds: expect.any(Array),
    currentTargetLedgerIds: expect.any(Array),
    selectedTargetLedgerIds: [],
    lowConfidence: true
  })
})
```

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

Expected: PASS。

Commit:

```bash
git add src/renderer/src/features/favorites/favoriteArchivePlanState.ts src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
git commit -m "feat: model editable favorite archive plans"
```

---

### Task 4: 归档预览交互重构

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写交互测试**

在 `FavoriteLedgerPanel.test.tsx` 增加这些场景：

```ts
it('keeps unclassified old favorites unselected until the user chooses a bilimi ledger', async () => {
  renderFavoriteLedgerPanelWithPreview({
    title: '难判断视频',
    currentTargetLedgerIds: [],
    selectedTargetLedgerIds: []
  })

  expect(screen.getByRole('group', { name: /未匹配到合适分类/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /视频来源/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /难判断视频/ })).toHaveAttribute('aria-pressed', 'false')
})

it('moves an item to the selected ledger group and can revert it', async () => {
  renderFavoriteLedgerPanelWithPreview({
    title: '东京旅行攻略',
    originalSuggestedLedgerIds: ['life-interest'],
    currentTargetLedgerIds: ['life-interest'],
    selectedTargetLedgerIds: ['life-interest']
  })

  fireEvent.change(screen.getByLabelText('选择目标收藏夹 东京旅行攻略'), {
    target: { value: 'knowledge' }
  })

  expect(screen.getByRole('group', { name: /bilimi·知识学习/ })).toHaveTextContent('东京旅行攻略')
  expect(screen.getByText(/原建议：bilimi·生活日常/)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /撤回 东京旅行攻略/ }))
  expect(screen.getByRole('group', { name: /bilimi·生活日常/ })).toHaveTextContent('东京旅行攻略')
})
```

- [ ] **Step 2: 接入 `FavoriteArchivePlanState`**

在 `FavoriteLedgerPanel.tsx`：

- 扫描成功后用 `createArchivePlanState` 初始化计划状态。
- 用状态模型替换 `selectedOldFavoriteTargetKeys` 的核心职责；保留旧 Set 的地方改为派生数据或删除。
- `buildSelectedOldFavoritePlanItems` 改为消费 `buildExecutableArchivePlan`。
- 未分类区域由 `currentTargetLedgerIds.length === 0` 或选择 `unclassified` 派生。

- [ ] **Step 3: 更新卡片 UI**

每条卡片显示：

- 标题。
- `来源：${sourceFolderTitle}`，不可点击。
- `UP：${author || '未知'}`。
- `标签：${前几个标签}${剩余数量}`，完整标签放 `title`。
- 用户已改目标时显示 `原建议：${原建议名称}`。
- 低置信时显示 `低置信：${分差和命中摘要}`。
- `视频来源` 按钮打开原视频，替代 `手动分类`。
- `再次整理` 按钮替代 `再次判断`。

- [ ] **Step 4: 增加目标下拉和撤回控件**

每个卡片的操作区包含：

- 收藏夹按钮：短名，`aria-pressed=true` 时蓝色点亮，`title` 为完整名。
- 下拉：所有启用 bilimi 收藏夹 + `未分类`，显示完整名。
- 撤回控件：下拉只切换模式，按钮执行单条撤回或当前区域撤回。
- 其他收藏夹区域一次只展开一个视频；新增 `expandedOldFavoriteAid` 状态。

- [ ] **Step 5: 多目标未分类确认层**

在多目标模式下选择 `未分类`：

- 若当前只有一个目标，直接清空目标并移入未匹配区域。
- 若当前多个目标，显示轻量确认层，列出当前 bilimi 目标，并提供 `全部去掉不整理`、`只取消当前收藏夹`、`取消`。
- 确认层状态命名为 `pendingUnclassifiedDecision`，测试断言三种按钮行为。

- [ ] **Step 6: 更新样式测试和 CSS**

在 `styles.test.ts` 增加断言：

```ts
expect(normalizedStyles).toContain('.favorite-ledger-panel__preview-video[aria-pressed="true"]')
expect(normalizedStyles).toContain('.favorite-ledger-panel__preview-video-meta')
expect(normalizedStyles).toContain('.favorite-ledger-panel__preview-delta')
expect(normalizedStyles).toContain('.favorite-ledger-panel__preview-row--pending')
```

CSS 约束：

- 卡片固定最小高度，内部文本截断。
- 按钮蓝色选中、白色未选。
- 未匹配区域视觉更突出。
- 不嵌套卡片；分组是行级区域，视频条目是单个卡片。

- [ ] **Step 7: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS。

Commit:

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "feat: rebuild editable archive preview"
```

---

### Task 5: 纠错学习与关键词建议数据层

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Modify: `electron/main/store.ts`
- Create: `src/renderer/src/features/recommendation/correctionLearning.ts`
- Test: `src/renderer/src/features/recommendation/correctionLearning.test.ts`
- Test: `src/renderer/src/features/state/assistantState.test.ts`
- Test: `electron/main/store.test.ts`

- [ ] **Step 1: 新增类型**

在 `types.ts` 增加：

```ts
export type FavoriteCorrectionSource = 'user' | 'deepseek' | 'user-confirmed-deepseek'
export type FavoriteCorrectionFeedbackType = 'strong-correction' | 'weak-negative'
export type FavoriteKeywordSuggestionAction = 'add-keyword' | 'remove-keyword' | 'downgrade-to-weak' | 'replace-with-combination' | 'add-entity-alias' | 'add-concept-variant'
export type FavoriteKeywordSuggestionStatus = 'pending' | 'accepted' | 'ignored' | 'deleted'

export type FavoriteCorrectionRecord = {
  id: string
  aid: number
  title: string
  originalLedgerId?: FavoriteLedgerId
  userLedgerIds: FavoriteLedgerId[]
  source: FavoriteCorrectionSource
  feedbackType: FavoriteCorrectionFeedbackType
  sourceScene: 'archive-preview' | 'daily-favorite'
  sourceFolderTitle?: string
  author?: string
  tags: string[]
  matchedKeywords: string[]
  score?: number
  confidence?: ClassificationConfidenceLevel
  scoreGap?: number
  createdAt: string
  confirmedAt?: string
}

export type FavoriteKeywordSuggestion = {
  id: string
  action: FavoriteKeywordSuggestionAction
  ledgerId?: FavoriteLedgerId
  keyword?: string
  replacement?: string
  reason: string
  source: FavoriteCorrectionSource
  status: FavoriteKeywordSuggestionStatus
  createdAt: string
}
```

扩展 `AssistantPreferences`：

```ts
favoriteArchiveStrategy: FavoriteArchiveStrategy
favoriteCorrectionLearningEnabled: boolean
favoriteCorrectionLearningClassificationEnabled: boolean
favoriteCorrectionRecords: FavoriteCorrectionRecord[]
favoriteKeywordSuggestions: FavoriteKeywordSuggestion[]
```

- [ ] **Step 2: 写学习记录测试**

```ts
import { describe, expect, it } from 'vitest'
import { createCorrectionDraft, confirmCorrectionDrafts, applyAidCorrectionMemory } from './correctionLearning'

describe('correctionLearning', () => {
  it('keeps preview corrections as drafts until execution confirms them', () => {
    const draft = createCorrectionDraft({
      aid: 1,
      title: '星铁剧情解析',
      originalLedgerId: 'movie-tv',
      userLedgerIds: ['game'],
      sourceScene: 'archive-preview',
      source: 'user',
      tags: ['星铁']
    })

    expect(draft.confirmedAt).toBeUndefined()
    expect(confirmCorrectionDrafts([draft], '2026-07-05T00:00:00.000Z')[0].confirmedAt).toBe('2026-07-05T00:00:00.000Z')
  })

  it('uses aid-level memory before normal classification when enabled', () => {
    const record = confirmCorrectionDrafts([
      createCorrectionDraft({
        aid: 1,
        title: '东京旅行攻略',
        originalLedgerId: 'game',
        userLedgerIds: ['life-interest'],
        sourceScene: 'archive-preview',
        source: 'user',
        tags: []
      })
    ], '2026-07-05T00:00:00.000Z')[0]

    expect(applyAidCorrectionMemory({ aid: 1 }, [record])?.ledgerIds).toEqual(['life-interest'])
  })
})
```

- [ ] **Step 3: 实现纠错数据工具**

`correctionLearning.ts` 导出：

- `createCorrectionDraft(args)`：强纠错或弱负反馈。
- `confirmCorrectionDrafts(drafts, now)`：确认执行后写 `confirmedAt`。
- `discardCorrectionDrafts(drafts, aid?)`：撤回或取消时丢弃。
- `applyAidCorrectionMemory(context, records)`：同 aid 优先生效。
- `normalizeKeywordSuggestions(suggestions)`：只保留合法状态和合法 action。

- [ ] **Step 4: 持久化默认值和归一化**

在 `assistantState.ts` 与 `store.ts`：

- `favoriteArchiveStrategy` 默认 `'aggressive'`。
- `favoriteCorrectionLearningEnabled` 默认 `true`。
- `favoriteCorrectionLearningClassificationEnabled` 默认 `true`。
- 纠错记录与关键词建议默认空数组。
- 读旧配置时缺失字段不报错。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/recommendation/correctionLearning.test.ts src/renderer/src/features/state/assistantState.test.ts electron/main/store.test.ts`

Expected: PASS。

Commit:

```bash
git add src/shared/types.ts src/renderer/src/features/recommendation/correctionLearning.ts src/renderer/src/features/recommendation/correctionLearning.test.ts src/renderer/src/features/state/assistantState.ts src/renderer/src/features/state/assistantState.test.ts electron/main/store.ts electron/main/store.test.ts
git commit -m "feat: persist favorite correction learning"
```

---

### Task 6: 设置页管理整理策略、纠错学习和关键词建议

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: 写设置页测试**

```ts
it('renders archive strategy and correction learning settings', async () => {
  renderFloatingAssistantApp()
  fireEvent.click(screen.getByRole('tab', { name: '设置' }))

  expect(screen.getByRole('group', { name: '整理策略' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '积极整理' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '记录纠错学习' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '纠错学习参与分类' })).toBeChecked()
})

it('can expand, delete, and clear correction records', async () => {
  renderFloatingAssistantAppWithPreferences({
    favoriteCorrectionRecords: [{
      id: 'c1',
      aid: 1,
      title: '东京旅行攻略',
      originalLedgerId: 'game',
      userLedgerIds: ['life-interest'],
      source: 'user',
      feedbackType: 'strong-correction',
      sourceScene: 'archive-preview',
      tags: ['旅行'],
      matchedKeywords: ['攻略'],
      createdAt: '2026-07-05T00:00:00.000Z',
      confirmedAt: '2026-07-05T00:01:00.000Z'
    }]
  })

  fireEvent.click(screen.getByRole('tab', { name: '设置' }))
  fireEvent.click(screen.getByRole('button', { name: /展开纠错 东京旅行攻略/ }))
  expect(screen.getByText(/标签：旅行/)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /删除纠错 东京旅行攻略/ }))
  expect(screen.queryByText('东京旅行攻略')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 新增设置区**

在 `FloatingAssistantApp.tsx` 设置页中：

- `整理策略` 单选：积极整理、均衡整理、保守整理，保存 `favoriteArchiveStrategy`。
- 纠错学习开关：记录纠错学习、纠错学习参与分类。
- 纠错学习列表：摘要显示标题、原建议、用户选择、时间；展开显示 UP、标签、来源场景、来源收藏夹、命中关键词、分数、置信度、分差。
- 操作：删除单条、清空全部。
- 关键词建议列表：显示 action、目标收藏夹、关键词、替换词、理由；按钮为采纳、忽略、删除。

- [ ] **Step 3: 采纳关键词建议**

采纳行为：

- `add-keyword`：把 `keyword` 加入目标 ledger，去重。
- `remove-keyword`：从目标 ledger 移除 `keyword`。
- `downgrade-to-weak`：不改展示词，仅把建议状态标记 accepted，并提示当前版本弱词由分类器内置解释。
- `replace-with-combination`：移除 `keyword`，加入 `replacement`。
- `add-entity-alias` 和 `add-concept-variant`：第一版先进入 accepted 状态，并提示需要后续版本纳入内置词库；不自动改代码内置词库。

- [ ] **Step 4: 更新样式**

CSS 需要：

- 设置组不使用嵌套卡片。
- 列表项可折叠，摘要不撑破容器。
- 关键词建议按钮固定高度，文本不溢出。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS。

Commit:

```bash
git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "feat: add correction learning settings"
```

---

### Task 7: DeepSeek 归档预览整理

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Create: `src/renderer/src/features/favorites/deepseekArchiveOrganizer.ts`
- Test: `electron/main/deepseekService.test.ts`
- Test: `src/renderer/src/features/favorites/deepseekArchiveOrganizer.test.ts`

- [ ] **Step 1: 扩展 DeepSeek 请求和结果类型**

在 `DeepSeekGenerateRequest` 增加：

```ts
| {
    kind: 'favorite-archive-organize'
    mode: 'all' | 'classified-only' | 'unclassified-only'
    videos: DeepSeekArchiveVideoInput[]
    ledgers: DeepSeekArchiveLedgerInput[]
    multiArchiveLimit: 1 | 2 | 3
  }
```

在 `DeepSeekGenerateResult` 增加：

```ts
| {
    kind: 'favorite-archive-organize'
    results: DeepSeekArchiveVideoResult[]
    keywordSuggestions: FavoriteKeywordSuggestion[]
  }
```

- [ ] **Step 2: 写 DeepSeek 服务解析测试**

在 `deepseekService.test.ts` mock 返回：

```json
{
  "results": [
    {
      "aid": 1,
      "targetLedgerIds": ["life-interest"],
      "keepOriginal": false,
      "reason": "旅行攻略语义更接近日常生活",
      "confidence": 0.86,
      "lowConfidence": false,
      "secondPassChanged": true
    }
  ],
  "keywordSuggestions": [
    {
      "action": "replace-with-combination",
      "ledgerId": "game",
      "keyword": "攻略",
      "replacement": "游戏攻略",
      "reason": "裸攻略容易误分旅行内容"
    }
  ]
}
```

断言输出 kind、results 和 suggestions 均被归一化。

- [ ] **Step 3: 实现 prompt 和解析**

在 `deepseekService.ts`：

- `buildMessages` 新增归档整理 system prompt。
- prompt 明确：只能输出已有启用 bilimi 收藏夹或 `未分类`，不能创建收藏夹，不能直接修改关键词，返回 JSON。
- `parseDeepSeekResult` 校验 aid、目标数组、置信度、理由。
- 置信度缺失或非法时标记该条 invalid，不让渲染层应用。

- [ ] **Step 4: 写 bilimi 应用建议测试**

`deepseekArchiveOrganizer.test.ts`：

```ts
it('validates DeepSeek targets and applies successful suggestions to the preview plan', () => {
  const applied = applyDeepSeekArchiveResults({
    state: createArchivePlanState([{
      aid: 1,
      title: '东京旅行攻略',
      sourceFolderTitle: '默认收藏夹',
      originalSuggestedLedgerIds: [],
      currentTargetLedgerIds: [],
      selectedTargetLedgerIds: [],
      userModified: false
    }]),
    enabledLedgerIds: ['life-interest'],
    multiArchiveLimit: 1,
    results: [{
      aid: 1,
      targetLedgerIds: ['life-interest'],
      keepOriginal: false,
      reason: '旅行攻略',
      confidence: 0.86,
      lowConfidence: false,
      secondPassChanged: true
    }]
  })

  expect(applied.state.items[0]).toMatchObject({
    currentTargetLedgerIds: ['life-interest'],
    selectedTargetLedgerIds: ['life-interest'],
    lastChangeSource: 'deepseek'
  })
  expect(applied.messages[0]).toContain('DeepSeek 整理：未分类 -> bilimi·生活日常')
})
```

- [ ] **Step 5: 实现应用层**

`deepseekArchiveOrganizer.ts` 导出：

- `buildDeepSeekArchiveRequest(previewState, ledgers, mode, multiArchiveLimit)`。
- `applyDeepSeekArchiveResults(args)`：校验目标存在且启用，按上限截断，拒绝不存在目标，`未分类` 清空执行目标。
- `createDeepSeekArchiveSnapshot(state)` 与 `revertDeepSeekArchiveRun(state, snapshot)`。
- 返回统计：成功数、失败数、截断数、红字位移提示。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- electron/main/deepseekService.test.ts src/renderer/src/features/favorites/deepseekArchiveOrganizer.test.ts`

Expected: PASS。

Commit:

```bash
git add src/shared/types.ts electron/main/deepseekService.ts electron/main/deepseekService.test.ts electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/features/favorites/deepseekArchiveOrganizer.ts src/renderer/src/features/favorites/deepseekArchiveOrganizer.test.ts
git commit -m "feat: add DeepSeek archive organizer"
```

---

### Task 8: 归档预览 UI 接入 DeepSeek 整理

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: 写 UI 测试**

覆盖：

- DeepSeek 未开启或无 key 时按钮禁用并提示 `未开启 DeepSeek`。
- 下拉默认 `全体整理`，切换模式不自动发请求。
- `仅二判` 不发送未匹配区域视频。
- `仅整理未分类` 只发送未匹配区域视频。
- 返回建议后视频移动分组、按钮点亮、显示红字位移提示和高亮。
- 整轮撤回恢复 DeepSeek 运行前状态。

- [ ] **Step 2: 增加 runtime 入口**

在 `assistantRuntimeTypes.ts` 增加：

```ts
| { id: string; type: 'organize-old-favorites-with-deepseek'; mode: 'all' | 'classified-only' | 'unclassified-only'; request: DeepSeekGenerateRequest }
```

在 `App.tsx` 的 runtime switch 中调用 `window.bilimiDesktop.generateDeepSeek`，保持现有旧藏扫描不自动调用 DeepSeek。

- [ ] **Step 3: UI 接入**

在归档预览顶部右侧添加：

- `DeepSeek 整理` 按钮。
- 模式下拉：全体整理、仅二判、仅整理未分类。
- 隐私提示：会发送标题、UP 主、标签、简介、来源收藏夹、当前建议和 bilimi 收藏夹信息。
- 请求中、部分失败、格式错误状态提示。

- [ ] **Step 4: 撤回 DeepSeek 改动**

在 `FavoriteLedgerPanel.tsx` 保存本轮 DeepSeek 快照：

- 单条撤回走现有 `revertArchivePlanItem`。
- 区域撤回走 `revertArchivePlanArea`。
- 整轮撤回走 `revertDeepSeekArchiveRun`。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx`

Expected: PASS。

Commit:

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/assistantRuntimeTypes.ts src/renderer/src/App.tsx src/renderer/src/styles.css src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx
git commit -m "feat: wire DeepSeek into archive preview"
```

---

### Task 9: DeepSeek 日常归类辅助判断

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/actions/actionExecutor.ts`
- Test: `electron/main/deepseekService.test.ts`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Test: `src/renderer/src/App.test.tsx`
- Test: `src/renderer/src/features/actions/actionExecutor.test.ts`

- [ ] **Step 1: 增加设置类型**

`AssistantPreferences` 新增：

```ts
deepseekDailyClassificationEnabled: boolean
deepseekDailyClassificationMode: 'all' | 'low-confidence-only'
```

默认：

- `deepseekDailyClassificationEnabled: false`
- `deepseekDailyClassificationMode: 'all'`

- [ ] **Step 2: 写设置测试**

在 `FloatingAssistantApp.test.tsx`：

```ts
it('keeps DeepSeek daily classification disabled by default and reveals radio choices when enabled', async () => {
  renderFloatingAssistantAppWithPreferences({
    deepseekEnabled: true,
    deepseekApiKeyStored: true
  })

  fireEvent.click(screen.getByRole('tab', { name: '设置' }))
  const toggle = screen.getByRole('checkbox', { name: '启用 DeepSeek 辅助判断归类收藏夹' })
  expect(toggle).not.toBeChecked()

  fireEvent.click(toggle)
  expect(screen.getByRole('radio', { name: '全部归类都辅助判断' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '仅低置信时辅助判断' })).toBeInTheDocument()
})
```

- [ ] **Step 3: 扩展 DeepSeek 日常请求**

`DeepSeekGenerateRequest` 增加 `favorite-daily-classify-review`：

- 输入当前视频上下文、本地分类结果、诊断、启用收藏夹。
- 输出建议目标、是否修正、理由、置信度、关键词建议。

- [ ] **Step 4: 日常收藏流程接入**

在 `App.tsx` 的日常赏/藏/赐收藏目标选择处：

- 先按本地规则得到 `archiveTargets`。
- 若 DeepSeek 总开关、API key、日常辅助开关均开启：
  - `all`：所有本地归类结果发二判。
  - `low-confidence-only`：只对低置信、分差过小、冲突或多义词明显结果发二判。
- DeepSeek 无误：不提示，不改目标。
- DeepSeek 认为有误且还未真实收藏：替换当前入口建议目标，显示修正提示，生成纠错草稿。
- DeepSeek 认为有误且本地规则已经完成真实收藏：后台追加到 DeepSeek 目标，按入口移动语义从错误目标移出或标记已调整；成功后非阻塞提示，失败则保留当前状态并提示重试或手动整理。
- 该流程不修改整理旧藏归档预览状态。

- [ ] **Step 5: 记录学习来源**

日常 DeepSeek 调整：

- 原始 AI 建议 source 为 `deepseek`。
- 用户最终完成动作或后台真实调整成功后转为 `user-confirmed-deepseek`。
- 用户又手动改目标，以最终 `user` 选择为准。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- electron/main/deepseekService.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx src/renderer/src/features/actions/actionExecutor.test.ts`

Expected: PASS。

Commit:

```bash
git add src/shared/types.ts electron/main/deepseekService.ts src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/App.tsx src/renderer/src/features/actions/actionExecutor.ts electron/main/deepseekService.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx src/renderer/src/features/actions/actionExecutor.test.ts
git commit -m "feat: add DeepSeek daily classification review"
```

---

### Task 10: 确认执行、纠错草稿转正和关键词建议汇总

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteArchivePlanState.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts`
- Test: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: 写确认执行学习测试**

```ts
it('confirms archive preview correction drafts only after executing the selected plan', async () => {
  renderFavoriteLedgerPanelWithPreview({
    title: '星铁剧情解析',
    originalSuggestedLedgerIds: ['movie-tv'],
    currentTargetLedgerIds: ['game'],
    selectedTargetLedgerIds: ['game'],
    userModified: true
  })

  fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

  await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({
      favoriteCorrectionRecords: expect.arrayContaining([
        expect.objectContaining({
          source: 'user',
          feedbackType: 'strong-correction',
          confirmedAt: expect.any(String)
        })
      ])
    })
  ))
})
```

- [ ] **Step 2: 草稿生命周期**

归档预览：

- 手动改目标、从未分类选真实 bilimi 收藏夹：产生草稿。
- 蓝色取消成白色：产生弱负反馈草稿。
- 撤回、取消、未执行：丢弃草稿。
- 确认执行成功项：转为有效记录。
- DeepSeek 建议未确认：只保留关键词建议和 AI 诊断，不生成强纠错。
- DeepSeek 建议被确认执行：记录为 `user-confirmed-deepseek`。

- [ ] **Step 3: 确认执行计划过滤**

`buildExecutableArchivePlan` 必须保证：

- `未分类` 不进入执行计划。
- 白色未选状态不进入执行计划。
- 真实 bilimi 目标可进入，即使当前没有 `bilibiliFolderId`，确认前走现有同步或备册流程。
- 多目标按 `favoriteArchiveMultiMode` 限制。

- [ ] **Step 4: 关键词建议汇总**

把 DeepSeek 归档预览、DeepSeek 日常辅助和本地分类诊断生成的建议统一追加到 `favoriteKeywordSuggestions`：

- 相同 action、ledgerId、keyword、replacement 的 pending 建议去重。
- 用户采纳、忽略或删除后不被同一轮重复添加。
- 第一版不自动增删内置实体别名和概念变体，只进入建议列表。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts src/renderer/src/App.test.tsx`

Expected: PASS。

Commit:

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/App.tsx src/renderer/src/features/favorites/favoriteArchivePlanState.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/favorites/favoriteArchivePlanState.test.ts src/renderer/src/App.test.tsx
git commit -m "feat: confirm archive corrections and suggestions"
```

---

### Task 11: 集成回归、构建和手动验收

**Files:**
- Modify: `README.md` if user-facing behavior needs short documentation
- Modify: `CHANGELOG.md` if this branch keeps release notes
- Test: existing test suite

- [ ] **Step 1: 全量测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 构建**

Run: `npm run build`

Expected: PASS，输出 `out/`。

- [ ] **Step 3: dev 手动验收**

Run: `npm run dev`

验收：

- 打开设置，确认整理策略默认积极整理。
- DeepSeek 未配置时，归档预览 DeepSeek 整理按钮置灰并提示。
- 扫描旧藏，未匹配区域默认白色，不进入执行计划。
- 未匹配区域选择 `bilimi·暂存` 后进入执行计划。
- 单条改目标后移动分组，显示原建议，可撤回。
- 卡片显示来源收藏夹、UP 主、标签，长文本可悬停看完整内容。
- 日常藏入口在 DeepSeek 辅助判断关闭时仍走本地分类。

- [ ] **Step 4: preview 手动验收**

Run: `npm run preview`

重复 Step 3 的关键路径，额外确认：

- `window.bilimiDesktop` bridge 存在。
- 归档预览确认执行仍只追加到 bilimi 收藏夹，不删除原收藏。
- 设置保存后重启 preview 能恢复新增偏好。

- [ ] **Step 5: Windows 安装包验收边界**

本任务不默认打包。若准备打包或发布 Windows 安装包，必须按 `docs/release-checklist.md` 执行：

```bash
npm test
npm run build
npm run preview
npm run dist:win
```

安装 `dist/` 中生成的 Windows 安装包后，按清单完成 dev、preview、安装包三种形态关键路径验收，并记录 DeepSeek 未配置、配置错误、配置正确三种状态。

- [ ] **Step 6: 提交验收文档更新**

如果 README 或 CHANGELOG 有改动：

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document archive classification updates"
```

若没有文档改动，则不创建空提交。

---

## 需求覆盖自检

- 分类引擎：Task 1、Task 2 覆盖文本归一化、实体别名、概念变体、用户关键词轻量扩展的基础、强弱词、多义词组合、反向约束、置信度、诊断、默认关键词调整。
- 归档预览交互：Task 3、Task 4、Task 10 覆盖原始建议、当前计划、蓝白按钮、未分类状态、暂存真实收藏夹、分组移动、下拉选择、多目标确认、撤回、再次整理、执行计划过滤。
- DeepSeek 归档预览整理：Task 7、Task 8、Task 10 覆盖入口、三种模式、输入输出、bilimi 校验、红字位移提示、高亮、撤回、失败处理、关键词建议。
- DeepSeek 日常归类辅助判断：Task 9 覆盖设置、两种二判范围、自动修正建议目标、已真实收藏后的后台调整、非阻塞提示、学习来源区分。
- 纠错学习和关键词建议设置页：Task 5、Task 6、Task 10 覆盖记录开关、参与分类开关、草稿转正、aid 级记忆、弱负反馈、展开列表、删除、清空、建议采纳/忽略/删除。
- 测试与验收拆分：每个任务有局部测试和 commit；Task 11 覆盖全量测试、build、dev、preview，以及 Windows 安装包发布前按 `docs/release-checklist.md` 完成三形态验收。

## 风险和执行顺序建议

- 最大风险是把旧的 `selectedOldFavoriteTargetKeys` 与新计划状态混用，导致 UI 显示和执行计划不一致。Task 3 先建立纯状态模型，Task 4 再接 UI。
- 第二风险是 DeepSeek 与本地分类边界混淆。Task 7 的 request 明确不传本地规则作为约束，只传第一轮建议和诊断摘要；Task 8 保证按钮手动触发，扫描旧藏不自动调用 DeepSeek。
- 第三风险是纠错学习过早污染分类。Task 5 的草稿必须等 Task 10 确认执行后转正；DeepSeek 原始建议不作为强纠错。
- 执行顺序不要跳过 Task 1 到 Task 3。后续 UI 和 AI 都依赖分类诊断与预览计划状态。
