# 推荐收藏夹扫描投影重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留现有扫描推荐界面，只让专属 UP 追更与高频标签作为扫描派生候选；一键采用复用普通收藏夹保存/勾选事务，按预计算的同名同规则关系联动，并彻底移除推荐专用墓碑、绑定和稳定 ID 强关联。

**Architecture:** 扫描协调器维护纯候选及候选到普通规则的预计算链接，候选 ID 不再兼任收藏夹规则 ID。采用/取消由主进程串行事务更新普通账号规则、候选链接、当前轮参与状态和受影响分类；renderer 只显示权威链接并发送候选操作，不在点击时扫描视频或匹配规则。

**Tech Stack:** TypeScript 5.8、Electron 42、React 19、Vitest 3、Testing Library、electron-store。

---

## 当前修复批次（R015–R017，优先执行）

在继续推荐联动改造前，先修复普通新建收藏夹的删除/备册边界。R015、R016 报告的不是扫描推荐重现：它是用户删除一个已保存普通规则后，旧远端 ID 被误放进远端观察草稿的重发现队列，显式备册又将其投影回规则列表。该路径必须与 R001–R004 中“当前扫描事实仍可产生未采用推荐候选”完全隔离。

### Task 0: 保护普通规则删除不被备册恢复

**覆盖：** R015、R016、R017 / I010。

**允许修改：** `electron/main/index.ts`、其已有删除 IPC 测试；必要时 `src/renderer/src/App.tsx` 及其备册测试。不得修改推荐候选生成、普通规则新建表单、B 站实际创建接口、默认规则删除保护或远端观察草稿的显式重发现机制，除非失败测试证明它们是根因。

1. 写失败集成回归：普通自建 `saved-rule` 已删除后，删除 IPC 不得把其远端 ID 标记为 remote-draft rediscovery pending；随后显式备册的输入和结果均不得含此规则。该测试必须和“纯远端观察草稿可在显式备册后重新发现”并列。
2. 运行该测试确认当前实现失败，失败原因必须是普通删除错误进入草稿重发现/备册投影，而非测试设定错误。
3. 只移除普通规则删除通往 `markFavoriteLedgerRemoteDraftRediscoveryPending` 的桥接；保留纯远端观察草稿删除路径，以及备册中对仍存在且显式选择规则的创建/绑定。
4. 运行删除 IPC、远端草稿、备册 API、推荐协调器和 renderer 定向回归；在 Electron 开发版验证删除普通规则后备册不再出现，同时重新扫描仍显示未采用推荐候选。

**预期数据与 UI：** 被删除的普通规则不在持久化规则目录、受管本地目录、备册目标或备册结果中；同名远端 folder 只可作为独立远端观察草稿按既有显式流程出现，绝不复活原规则或作为推荐规则。

**回归风险：** 删除/备册路径是成熟子系统。测试必须保护默认规则的 `managedFolderDeletedByUser`、纯远端观察草稿的重发现、已存在普通规则的显式备册和 R003 的无 B 站副作用采用。

---

## 实施前原文核对

执行前必须从头通读：

- `docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md` 原文 R001–R010 与索引；
- `docs/superpowers/specs/2026-09-06-recommended-favorites-scan-projection-design.md`；
- `docs/项目功能项目书.md` 第 5.5、9.6–9.9 节。

按原文顺序实施的已确认项：

1. R001：推荐只依赖扫描数据，只保留专属 UP 追更和高频标签；删除旧自动生成逻辑。
2. R001、R002：删除普通规则后下方取消勾选；相同扫描事实仍可重新推荐。
3. R001、R003：点击推荐一键完成普通规则创建、保存和勾选，不走推荐专用墓碑/绑定。
4. R001、R003、R004：只有名称、规则类型和规则关键词一致才联动；点击前预计算，有匹配复用、无匹配新建。
5. R001：整理流程实时处理扫描数据，不新增复杂历史约束。
6. R004：DeepSeek 不生成收藏夹，只继续选择已有规则。
7. R008：推荐生成是现有能力，本轮不新增入口或重做界面。

待用户决定：无。

被明确替代：

- R001 最初描述的“进入编辑后由用户起名、改类型、保存”被 R003 的“一键生成并完成保存勾选”替代。
- 项目书 9.6–9.9 中推荐永久来源身份、推荐删除墓碑、稳定 ID 强关联和推荐远端覆盖集语义被 R001–R004、R006–R010 替代。

明确不做：

- 不新增推荐生成按钮或第二套推荐功能（R008）。
- 不让 DeepSeek 创建收藏夹（R004）。
- 不修改页面缩放、布局、普通收藏夹操作、备册、同步、远端删除及其他受保护流程。

## 计划文件结构

**Create**

- `src/shared/favoriteRecommendationProjection.ts`：候选/普通规则语义规范化、预计算唯一匹配和歧义结果。
- `src/shared/favoriteRecommendationProjection.test.ts`：纯匹配与规则创建输入测试。

**Modify**

- `src/shared/oldFavoriteWorkspace.ts`：公开候选链接及候选→实际规则 ID映射。
- `src/shared/favoriteLedgers.ts`：扫描自动推荐种类只保留 `author | tag`；抽取普通自建规则 ID分配器供手工与推荐共用。
- `src/shared/favoriteLedgers.test.ts`：ID 分配与两类推荐命名回归。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：纯扫描候选、链接预计算、一键采用/取消、按实际规则 ID分类。
- `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：扫描、采用、取消、删除、恢复及无 B 站副作用测试。
- `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`：候选选择命令继续只接收候选 key，并返回权威链接快照。
- `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`：命令边界与过期/歧义失败测试。
- `electron/main/index.ts`：提供普通规则目录事务回调，移除 `saveRecommendedLedgers` 推荐专用持久化接线。
- `electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts`：删除推荐专用 apply/reconcile/remove；只保留通用远端观察草稿合并。
- `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`：旧推荐规则迁移为普通规则及远端事实保留测试。
- `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`：消费权威候选选择/链接，不维持推荐草稿持久化队列。
- `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`：候选操作队列、过期响应、失败回滚测试。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：删除 promoted recommendation 草稿桥接；显示并使用预计算链接。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`：上下联动、一键采用、改名断链、取消再点和点击性能测试。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：复用共享普通规则 ID分配器，并移除推荐来源的删除/编辑例外。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`：普通新建、编辑、删除回归。
- `src/renderer/src/App.tsx`、`electron/main/favoriteLibraryManagedFolderProjection.ts`：移除“推荐删除记录抑制扫描候选/规则”的特殊分流，仅保留通用精确远端 ID保护。
- 对应 `*.test.ts(x)`：远端观察与删除保护回归。
- `docs/项目功能项目书.md`：写入当前生效推荐模型并标注历史章节替代关系。
- `docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md`：逐项回填代码、测试、界面证据。

**Delete only after zero-reference verification**

- `src/shared/favoriteLedgerDraftDeletion.ts` 及测试中的推荐纯草稿分支；若通用远端观察删除仍引用该文件，则只删除推荐函数，不删除文件。
- `electron/main/favoriteLedgerDraftDeletionIpc.test.ts` 中只验证推荐纯草稿 IPC 的断言；通用草稿删除断言保留。

### Task 1: 建立隔离分支和失败基线

**Files:**

- Reference: `docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md`
- Reference: `docs/superpowers/specs/2026-09-06-recommended-favorites-scan-projection-design.md`
- Create in worktree: `docs/superpowers/plans/2026-09-06-recommended-favorites-scan-projection.md`

- [ ] **Step 1: 记录根目录状态并验证基线提交**

Run from `C:\Users\diqing\bilimi`:

```powershell
git status --short --branch
git log -3 --oneline
git rev-parse HEAD
```

Expected: branch is `main`; HEAD is the user-approved current local `main` baseline; existing unrelated modified files are listed and left untouched.

- [ ] **Step 2: 创建独立分支与 worktree**

Use the `superpowers:using-git-worktrees` skill, then run with a verified unused directory:

```powershell
git branch codex/recommended-favorites-scan-projection HEAD
git worktree add C:\Users\diqing\bilimi-recommended-favorites codex/recommended-favorites-scan-projection
```

Expected: new worktree is based exactly on the recorded `main` HEAD; root working tree changes remain unchanged.

- [ ] **Step 3: 把本轮账本、设计和计划复制为 Git 补丁应用到隔离 worktree**

Do not copy unrelated root changes. Generate a patch containing only the three files, inspect it, then apply it inside the worktree:

```powershell
git diff --no-index -- NUL docs\requirement-ledgers\2026-09-06-recommended-favorites-redesign-discussion.md
git diff --no-index -- NUL docs\superpowers\specs\2026-09-06-recommended-favorites-scan-projection-design.md
git diff --no-index -- NUL docs\superpowers\plans\2026-09-06-recommended-favorites-scan-projection.md
```

Expected: patch content contains only this topic. Apply with `apply_patch` in the isolated worktree, not with filesystem copy commands.

- [ ] **Step 4: 运行推荐相关现有测试作为失败/通过基线**

Run:

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/shared/favoriteLedgers.test.ts
```

Expected: record current result under `.codex-artifacts/recommended-favorites/baseline-tests.txt`; any pre-existing failure must be reported before implementation.

- [ ] **Step 5: 提交文档基线**

```powershell
git add docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md docs/superpowers/specs/2026-09-06-recommended-favorites-scan-projection-design.md docs/superpowers/plans/2026-09-06-recommended-favorites-scan-projection.md
git commit -m "docs: define scan-derived favorite recommendations"
```

Expected: one documentation-only commit; no application source files changed.

### Task 2: 建立纯候选与预计算联动模型

**Files:**

- Create: `src/shared/favoriteRecommendationProjection.ts`
- Create: `src/shared/favoriteRecommendationProjection.test.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts:113-122,438-442`
- Modify: `src/shared/favoriteLedgers.ts:35-160,190-195`
- Test: `src/shared/favoriteLedgers.test.ts`

- [ ] **Step 1: 写预计算匹配失败测试**

Add tests covering unique, none, renamed, rule mismatch and ambiguity:

```ts
import { describe, expect, it } from 'vitest'
import { buildFavoriteRecommendationLinks } from './favoriteRecommendationProjection'

const candidate = {
  id: 'scan:author:merlin-fit', displayName: 'bilimi·梅林FIT', kind: 'author' as const,
  keywords: ['梅林FIT'], count: 3, reason: '专属 UP 追更'
}

it('links only one ordinary ledger with the same normalized name and rule semantics', () => {
  const result = buildFavoriteRecommendationLinks([candidate], [{
    id: 'custom-user-1', displayName: 'bilimi·梅林FIT', ruleType: 'author', keywords: ['梅林FIT'],
    enabled: false, priority: 10, isDefault: false, ruleOrigin: 'saved-rule'
  }])
  expect(result[candidate.id]).toEqual({ status: 'linked', ledgerId: 'custom-user-1' })
})

it.each([
  ['renamed', { displayName: 'bilimi·我的梅林' }],
  ['different type', { ruleType: 'tag' as const }],
  ['different keywords', { keywords: ['梅林'] }]
])('does not link %s ledger', (_label, patch) => {
  const result = buildFavoriteRecommendationLinks([candidate], [{
    id: 'custom-user-1', displayName: 'bilimi·梅林FIT', ruleType: 'author', keywords: ['梅林FIT'],
    enabled: false, priority: 10, isDefault: false, ruleOrigin: 'saved-rule', ...patch
  }])
  expect(result[candidate.id]).toEqual({ status: 'unlinked' })
})

it('reports ambiguity instead of choosing or creating a third rule', () => {
  const base = { displayName: 'bilimi·梅林FIT', ruleType: 'author' as const, keywords: ['梅林FIT'], enabled: false, priority: 10, isDefault: false }
  const result = buildFavoriteRecommendationLinks([candidate], [{ id: 'a', ...base }, { id: 'b', ...base }])
  expect(result[candidate.id]).toEqual({ status: 'ambiguous', ledgerIds: ['a', 'b'] })
})
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
npx vitest run src/shared/favoriteRecommendationProjection.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: 实现纯匹配模块**

Create the module with no I/O and no Bilibili fields:

```ts
import type { FavoriteLedger } from './types'
import type { OldFavoriteWorkspaceRecommendationCandidate } from './oldFavoriteWorkspace'

export type FavoriteRecommendationLink =
  | { status: 'unlinked' }
  | { status: 'linked'; ledgerId: string }
  | { status: 'ambiguous'; ledgerIds: string[] }

function normalizedText(value: string) {
  return value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans-CN')
}

function normalizedKeywords(values: readonly string[]) {
  return [...new Set(values.map(normalizedText).filter(Boolean))].sort()
}

function candidateRuleType(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return candidate.kind === 'author' ? 'author' as const : 'tag' as const
}

export function recommendationMatchesFavoriteLedger(
  candidate: OldFavoriteWorkspaceRecommendationCandidate,
  ledger: FavoriteLedger
) {
  return normalizedText(candidate.displayName) === normalizedText(ledger.displayName) &&
    candidateRuleType(candidate) === (ledger.ruleType ?? 'keyword') &&
    JSON.stringify(normalizedKeywords(candidate.keywords ?? [])) === JSON.stringify(normalizedKeywords(ledger.keywords))
}

export function buildFavoriteRecommendationLinks(
  candidates: readonly OldFavoriteWorkspaceRecommendationCandidate[],
  ledgers: readonly FavoriteLedger[]
): Record<string, FavoriteRecommendationLink> {
  return Object.fromEntries(candidates.map((candidate) => {
    const matches = ledgers.filter((ledger) => recommendationMatchesFavoriteLedger(candidate, ledger)).map((ledger) => ledger.id).sort()
    return [candidate.id, matches.length === 0
      ? { status: 'unlinked' }
      : matches.length === 1
        ? { status: 'linked', ledgerId: matches[0]! }
        : { status: 'ambiguous', ledgerIds: matches }]
  }))
}
```

- [ ] **Step 4: 更新公开快照类型**

Change recommendation kinds to `author | tag` and publish links plus adopted rule IDs:

```ts
export type OldFavoriteWorkspaceRecommendationCandidate = {
  id: string
  displayName: string
  keywords: string[]
  kind: 'author' | 'tag'
  count: number
  currentSegmentCount?: number
  reason: string
}

recommendations: {
  candidates: OldFavoriteWorkspaceRecommendationCandidate[]
  adoptedCandidateIds: string[]
  linkedLedgerIdsByCandidateId: Record<string, string>
  links: Record<string, FavoriteRecommendationLink>
}
```

Import `FavoriteRecommendationLink` as a type. Update snapshot clone/normalization helpers to preserve these maps.

- [ ] **Step 5: 让手工新建与推荐新建共用普通规则 ID分配器**

Move the current `FavoriteLedgerOverview.tsx` ID logic into `favoriteLedgers.ts`:

```ts
export function createUserFavoriteLedgerId(title: string, now = Date.now()) {
  const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '') || 'ledger'
  return `custom-${slug}-${now}`
}
```

Change `RecommendedFavoriteLedgerKind` to `author | tag`; remove the `series` branch only from automatic recommendation naming and tests. Do not remove the existing `save-draft-ledger-rule` / `create-local-ledger-and-reclassify` user-created-rule flows merely because they currently encode a manual rule as `series`; Task 3 moves those flows out of recommendation state before the type is narrowed.

- [ ] **Step 6: 运行共享层测试**

```powershell
npx vitest run src/shared/favoriteRecommendationProjection.test.ts src/shared/favoriteLedgers.test.ts src/shared/oldFavoriteWorkspace.test.ts
```

Expected: PASS.

- [ ] **Step 7: 提交纯模型**

```powershell
git add src/shared/favoriteRecommendationProjection.ts src/shared/favoriteRecommendationProjection.test.ts src/shared/oldFavoriteWorkspace.ts src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts src/shared/oldFavoriteWorkspace.test.ts
git commit -m "refactor: separate scan recommendations from favorite rules"
```

### Task 3: 让扫描推荐只由当前扫描事实重建

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:365-375,820-968,2489-2551,3311-3391,7086-7269`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: 写失败测试证明上方规则不能生成或保留候选**

Add coordinator tests:

```ts
it('rebuilds recommendations only from current scan authors and tags', async () => {
  // Saved rule exists but its UP/tag is absent from the scan.
  const coordinator = createCoordinator({ savedLedgers: [savedAuthorLedger('梅林FIT')] })
  await finishScan(coordinator, [scanItem(1, { author: '其他UP', tags: ['旅行'] }), scanItem(2, { author: '其他UP', tags: ['旅行'] })])
  const snapshot = await coordinator.open('100')
  expect(snapshot?.recommendations.candidates.map((item) => item.displayName)).not.toContain('bilimi·梅林FIT')
  expect(snapshot?.recommendations.candidates.every((item) => item.kind === 'author' || item.kind === 'tag')).toBe(true)
})

it('drops a no-longer-generated adopted candidate but permits it to return unselected later', async () => {
  const coordinator = createCoordinator()
  const first = await finishScan(coordinator, [
    scanItem(1, { author: '梅林FIT' }), scanItem(2, { author: '梅林FIT' })
  ])
  const candidateId = first.recommendations.candidates.find((item) => item.kind === 'author')!.id
  await coordinator.setRecommendedCandidates('100', [candidateId])
  await replaceScan(coordinator, [scanItem(3, { author: '其他UP' })])
  await replaceScan(coordinator, [
    scanItem(4, { author: '梅林FIT' }), scanItem(5, { author: '梅林FIT' })
  ])
  const final = await coordinator.getSnapshot('100')
  expect(final.recommendations.candidates.map((item) => item.id)).toContain(candidateId)
  expect(final.recommendations.adoptedCandidateIds).not.toContain(candidateId)
})
```

- [ ] **Step 2: 运行目标测试确认旧行为失败**

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "current scan authors and tags|return unselected"
```

Expected: FAIL because saved enabled recommendations are hydrated and adopted prior candidates are retained.

- [ ] **Step 3: 删除候选与历史规则合并**

Replace `mergeGeneratedRecommendations()` with pure selection filtering:

```ts
function recommendationsFromIndex(index: RecommendationIndex, prior?: RecommendationState): RecommendationState {
  const candidates = allocateRecommendationNames([...authors, ...tags])
  const availableIds = new Set(candidates.map((candidate) => candidate.id))
  return {
    initialized: true,
    candidates,
    adoptedCandidateIds: (prior?.adoptedCandidateIds ?? []).filter((id) => availableIds.has(id)),
    linkedLedgerIdsByCandidateId: Object.fromEntries(Object.entries(prior?.linkedLedgerIdsByCandidateId ?? {})
      .filter(([candidateId]) => availableIds.has(candidateId))),
    links: {}
  }
}
```

Remove `hydrateRecommendationsFromSavedEnabledLedgers()` calls and method. Remove `series` candidate branches. Tag/author thresholds and current asynchronous index updates remain unchanged.

- [ ] **Step 4: 将整理中用户主动新建/编辑规则移出推荐候选状态**

`save-draft-ledger-rule` and `create-local-ledger-and-reclassify` are protected manual-rule features, not automatic recommendations. Before narrowing recommendation kinds, change them to persist/update an ordinary `saved-rule` through the rule-directory transaction and reclassify with that real rule ID. They must not append a synthetic `kind: 'series'` candidate or add it to `adoptedCandidateIds`.

Add a regression test:

```ts
it('keeps a user-created organization rule outside scan recommendations', async () => {
  const coordinator = createCoordinator()
  await readyWorkspace(coordinator)
  await coordinator.saveDraftLedgerRule('100', {
    analysisId: 'manual-rule', ledgerId: 'custom-music', title: '音乐',
    keywords: ['旋律'], ruleType: 'keyword', adopt: true
  })
  const snapshot = await coordinator.getSnapshot('100')
  expect(snapshot.recommendations.candidates.map((candidate) => candidate.id)).not.toContain('custom-music')
  expect(Object.values(snapshot.classifications).some((row) => row.targetLedgerIds.includes('custom-music'))).toBe(true)
})
```

- [ ] **Step 5: 在扫描、标签刷新和恢复后预计算链接**

Add a coordinator helper that loads ordinary saved rules outside click handlers:

```ts
private async withRecommendationLinks(workspace: OldFavoriteWorkspace, state: RecommendationState) {
  const ledgers = await this.options.listSavedFavoriteLedgers?.(workspace.accountMid) ?? []
  const links = buildFavoriteRecommendationLinks(state.candidates, ledgers)
  const linkedLedgerIdsByCandidateId = Object.fromEntries(Object.entries(links).flatMap(([candidateId, link]) =>
    link.status === 'linked' ? [[candidateId, link.ledgerId]] : []))
  return { ...state, links, linkedLedgerIdsByCandidateId }
}
```

Call it after scan completion, tag-batch recommendation rebuild, workspace recovery and saved-rule configuration refresh. Do not call it from renderer event handlers.

- [ ] **Step 6: 运行扫描与恢复测试**

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "recommend|tag enrichment|recover"
```

Expected: PASS; no candidate is created solely from saved rules.

- [ ] **Step 7: 提交扫描纯化**

```powershell
git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts
git commit -m "refactor: derive favorite recommendations from scans only"
```

### Task 4: 实现主进程普通规则一键采用事务

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:1230-1280,2363-2395,4165-4315,7273-7284`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts:55-75,230-275,580-610`
- Modify: `electron/main/index.ts:2890-3020`
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`

- [ ] **Step 1: 写一键采用和取消失败测试**

Cover unique reuse, new rule, cancel, ambiguity and rollback:

```ts
it('adopts an unlinked candidate by saving one ordinary rule and classifying with its real id', async () => {
  const saveRuleDirectory = vi.fn(async (_accountMid, update) => update)
  const coordinator = createCoordinator({ saveRuleDirectory })
  const before = await readyWorkspaceWithAuthorRecommendation(coordinator, '梅林FIT')
  const candidateId = before.recommendations.candidates[0]!.id
  const after = await coordinator.setRecommendedCandidates('100', [candidateId])
  const ledgerId = after.recommendations.linkedLedgerIdsByCandidateId[candidateId]
  expect(ledgerId).toMatch(/^custom-/)
  expect(ledgerId).not.toBe(candidateId)
  expect(saveRuleDirectory).toHaveBeenCalledWith('100', expect.objectContaining({
    upserts: [expect.objectContaining({ id: ledgerId, displayName: 'bilimi·梅林FIT', ruleType: 'author', ruleOrigin: 'saved-rule', enabled: true })]
  }))
  expect(Object.values(after.classifications).some((row) => row.targetLedgerIds.includes(ledgerId))).toBe(true)
})

it('reuses a prelinked ordinary rule without creating another rule', async () => {
  const existing = ordinaryAuthorLedger('custom-existing', '梅林FIT', false)
  const applyChanges = vi.fn(async () => ({ before: [existing], after: [{ ...existing, enabled: true }] }))
  const coordinator = createCoordinator({ savedLedgers: [existing], applyFavoriteRecommendationRuleChanges: applyChanges })
  const snapshot = await readyWorkspaceWithAuthorRecommendation(coordinator, '梅林FIT')
  await coordinator.setRecommendedCandidates('100', [snapshot.recommendations.candidates[0]!.id])
  expect(applyChanges).toHaveBeenCalledWith('100', { upserts: [], enabled: [{ ledgerId: 'custom-existing', enabled: true }] })
})

it('cancels a candidate by disabling its linked ordinary rule without deleting it', async () => {
  const coordinator = createCoordinatorWithAdoptedOrdinaryRule('custom-existing', '梅林FIT')
  await coordinator.setRecommendedCandidates('100', [])
  expect(await savedLedgerById(coordinator, 'custom-existing')).toMatchObject({ enabled: false })
})

it('fails closed for ambiguous links', async () => {
  const applyChanges = vi.fn()
  const coordinator = createCoordinator({
    savedLedgers: [ordinaryAuthorLedger('a', '梅林FIT', false), ordinaryAuthorLedger('b', '梅林FIT', false)],
    applyFavoriteRecommendationRuleChanges: applyChanges
  })
  const snapshot = await readyWorkspaceWithAuthorRecommendation(coordinator, '梅林FIT')
  await expect(coordinator.setRecommendedCandidates('100', [snapshot.recommendations.candidates[0]!.id]))
    .rejects.toThrow('存在重复收藏夹，请先处理重复项。')
  expect(applyChanges).not.toHaveBeenCalled()
})

it('restores the prior ordinary rule directory when classification publication fails', async () => {
  const restoreFavoriteRuleDirectory = vi.fn()
  const coordinator = createCoordinator({ restoreFavoriteRuleDirectory, failClassificationPublication: true })
  const snapshot = await readyWorkspaceWithAuthorRecommendation(coordinator, '梅林FIT')
  await expect(coordinator.setRecommendedCandidates('100', [snapshot.recommendations.candidates[0]!.id])).rejects.toThrow()
  expect(restoreFavoriteRuleDirectory).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "ordinary rule|prelinked|ambiguous links|classification publication fails"
```

Expected: FAIL because current code persists `recommendation-draft` rules with candidate IDs.

- [ ] **Step 3: 用普通规则事务替换 `saveRecommendedLedgers`**

Add coordinator options:

```ts
listSavedFavoriteLedgers?: (accountMid: string) => Promise<FavoriteLedger[]>
applyFavoriteRecommendationRuleChanges?: (
  accountMid: string,
  changes: { upserts: FavoriteLedger[]; enabled: Array<{ ledgerId: string; enabled: boolean }> }
) => Promise<{ before: FavoriteLedger[]; after: FavoriteLedger[] }>
restoreFavoriteRuleDirectory?: (accountMid: string, ledgers: FavoriteLedger[]) => Promise<void>
```

In `index.ts`, implement them with `loadFavoriteAccountPreferences()` and `saveFavoriteAccountPreferences()`. Upserts use `ruleOrigin: 'saved-rule'`, `syncState: 'local-draft'`, `bindingState: 'unbacked'`, and the same normal preference save path as manual creation. The callback must not call Bilibili APIs, binding services or repository remote commands.

- [ ] **Step 4: 将候选增减转换为普通规则变化**

Inside the main-process queue:

```ts
for (const candidateId of addedIds) {
  const link = state.links[candidateId]
  if (link?.status === 'ambiguous') throw new Error('存在重复收藏夹，请先处理重复项。')
  if (link?.status === 'linked') enabled.push({ ledgerId: link.ledgerId, enabled: true })
  else {
    const candidate = requireCandidate(state, candidateId)
    const ledgerId = createUserFavoriteLedgerId(candidate.displayName)
    upserts.push({
      id: ledgerId, displayName: candidate.displayName, keywords: [...candidate.keywords],
      ruleType: candidate.kind, enabled: true, priority: nextPriority,
      syncState: 'local-draft', ruleOrigin: 'saved-rule', bindingState: 'unbacked', isDefault: false
    })
  }
}
for (const candidateId of removedIds) {
  const ledgerId = state.linkedLedgerIdsByCandidateId[candidateId]
  if (ledgerId) enabled.push({ ledgerId, enabled: false })
}
```

After saving, rebuild links from returned `after` rules, update candidate selection, and classify using the linked real ledger IDs. On any later failure, restore `before` and the prior workspace overlay before returning an error.

- [ ] **Step 5: 分类器只接收实际普通规则 ID**

Replace `asRecommendedClassificationLedger(candidate)` with:

```ts
function asLinkedRecommendationLedger(candidate: StoredRecommendation, ledger: FavoriteLedger): FavoriteLedger {
  return {
    ...ledger,
    id: ledger.id,
    displayName: ledger.displayName,
    keywords: [...ledger.keywords],
    enabled: true,
    ruleOrigin: 'saved-rule'
  }
}
```

Build selected/excluded lists through `linkedLedgerIdsByCandidateId`. All emitted `targetLedgerIds`, history entries, archive targets and sync preflight IDs must be actual rule IDs.

- [ ] **Step 6: 删除推荐专用持久化函数**

Remove these exports/call sites after replacement:

```ts
applyRecommendedLedgers
removeRecommendedLedgers
reconcileRecommendedLedgers
markRecommendedLedgersLocalDraft
persistRecommendedLedgersUnsafe
saveRecommendedLedgers
notifyRecommendedLedgersChanged
```

Keep `mergeRecoveredLedgerDrafts()` only for generic exact remote-folder observation reconciliation.

- [ ] **Step 7: 验证 IPC 仍只接受候选 key**

`set-recommended-candidates` must reject unknown candidate keys and renderer-supplied rule objects. Add an ambiguity assertion and verify the returned snapshot contains authoritative links.

- [ ] **Step 8: 运行主进程事务测试**

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts
```

Expected: PASS; Bilibili write/bind/delete spies are zero for adopt/cancel.

- [ ] **Step 9: 提交主进程事务**

```powershell
git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/index.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts
git commit -m "refactor: adopt recommendations as ordinary favorite rules"
```

### Task 5: 简化 renderer，点击只使用权威预计算链接

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:98-210,360-1025,1685-1720`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts:185-210,750-920,1170-1180`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:190-195,910-920,1720`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] **Step 1: 写 renderer 失败测试**

```ts
it('uses the published link without scanning ledgers during recommendation click', async () => {
  const command = vi.fn().mockResolvedValue(snapshotWithLink('candidate-up', 'custom-user-up'))
  renderPanel({ snapshot: snapshotWithLink('candidate-up', 'custom-user-up'), command })
  await user.click(screen.getByRole('checkbox', { name: /专属 UP 追更/ }))
  expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['candidate-up'] })
  expect(onSaveLedgers).not.toHaveBeenCalled()
})

it('shows both controls checked only after the authoritative adoption snapshot returns', async () => {
  const pending = deferred<OldFavoriteWorkspaceSnapshot>()
  const command = vi.fn(() => pending.promise)
  renderPanel({ snapshot: snapshotWithUnlinkedCandidate('candidate-up'), command })
  await user.click(screen.getByRole('checkbox', { name: /专属 UP 追更/ }))
  expect(screen.getByRole('checkbox', { name: /专属 UP 追更/ })).not.toBeChecked()
  pending.resolve(snapshotWithAdoptedLink('candidate-up', 'custom-user-up'))
  expect(await screen.findByRole('checkbox', { name: /专属 UP 追更/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /bilimi·UP/ })).toBeChecked()
})

it('unlinks after an upper rule rename snapshot and delegates the next click to the command', async () => {
  const command = vi.fn().mockResolvedValue(snapshotWithAdoptedLink('candidate-up', 'custom-new-up'))
  const view = renderPanel({ snapshot: snapshotWithLink('candidate-up', 'custom-user-up'), command })
  view.rerender(panelProps({ snapshot: snapshotWithUnlinkedCandidate('candidate-up'), ledgers: [renamedLedger('custom-user-up')] }))
  await user.click(screen.getByRole('checkbox', { name: /专属 UP 追更/ }))
  expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['candidate-up'] })
  expect(onSaveLedgers).not.toHaveBeenCalled()
})

it('shows the duplicate-rule error for an ambiguous precomputed link', async () => {
  renderPanel({ snapshot: snapshotWithAmbiguousCandidate('candidate-up', ['a', 'b']) })
  await user.click(screen.getByRole('checkbox', { name: /专属 UP 追更/ }))
  expect(await screen.findByText('存在重复收藏夹，请先处理重复项。')).toBeVisible()
})
```

- [ ] **Step 2: 运行目标测试确认失败**

```powershell
npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "published link|authoritative adoption|upper rule rename|ambiguous"
```

Expected: FAIL because renderer currently creates and persists promoted recommendation drafts.

- [ ] **Step 3: 删除 renderer 推荐草稿桥接**

Remove:

```ts
savedRecommendationLedger
isPureRecommendedLocalDraft
isRecommendationShadowedByFormalTitle
mergePromotedRecommendationLedgers
promotedRecommendationLedgers state/refs
pendingRecommendationSavesRef
awaitingPromotedRecommendationAcknowledgementRef
pendingRecommendationCancellationLedgerIdsRef
recommendationPromotionSaving
promoteSelectedRecommendationLedgers
dismissedGeneratedRecommendationLedgerIds
```

Do not replace them with another optimistic ledger list. `ledgers` props remain the only upper-rule directory.

- [ ] **Step 4: 使用 snapshot links 投影上下状态**

```ts
const link = activeSnapshot.recommendations.links[candidate.id]
const linkedLedgerId = link?.status === 'linked' ? link.ledgerId : undefined
const recommendationChecked = activeSnapshot.recommendations.adoptedCandidateIds.includes(candidate.id)
const upperChecked = linkedLedgerId
  ? organizationSavedLedgerEnabledById.get(linkedLedgerId) ?? false
  : false
```

Candidate click only calls `workspace.setRecommendedCandidates(nextCandidateIds)`. The hook may keep a lightweight pending checkbox state, but must never call `onSaveLedgers`, create a rule ID or compare all ledgers on click.

- [ ] **Step 5: 简化 hook 队列**

Keep last-write-wins serialization and account/workspace generation checks. Remove any queue step that expects renderer-created rules or waits for a recommendation ledger save. On failure, restore `recommendedCandidateIds` from the last authoritative snapshot.

- [ ] **Step 6: 手工新建继续使用共享 ID 分配器**

Replace local `idFor()` implementation in `FavoriteLedgerOverview.tsx` with `createUserFavoriteLedgerId()`. A newly saved manual rule keeps `ruleOrigin: 'saved-rule'`. Remove deletion-button exceptions that treat `recommendation-draft` differently; migrated recommendation rules use ordinary behavior.

- [ ] **Step 7: 运行 renderer 测试**

```powershell
npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx
```

Expected: PASS; tests explicitly assert `onSaveLedgers` is not called directly by recommendation clicks and no Bilibili bridge is invoked.

- [ ] **Step 8: 提交 renderer 简化**

```powershell
git add src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx
git commit -m "refactor: render recommendation links from authoritative state"
```

### Task 6: 删除推荐专用墓碑、绑定和恢复分流

**Files:**

- Modify: `src/renderer/src/App.tsx:1594-1605,2450-2465,2630-2650,2800-2820,3010-3030`
- Modify: `electron/main/index.ts:1094-1120,3150-3170`
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts:120-150,265-290`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:300-490,850-980`
- Modify or delete recommendation functions: `src/shared/favoriteLedgerDraftDeletion.ts`
- Test: corresponding `App.test.tsx`, `favoriteLibraryManagedFolderProjection.test.ts`, `favoriteLedgerApi.test.ts`, `favoriteLedgerDraftDeletion.test.ts`

- [ ] **Step 1: 写删除后可重新推荐的失败回归**

Add an integration-style test where a formerly `recommendation-draft` rule and its deletion record exist, but current scan facts still generate the candidate:

```ts
it('does not use deleted recommendation records as a scan-candidate blacklist', async () => {
  const snapshot = await finishScanWithDeletedRuleRecord({ author: '梅林FIT', remoteFolderId: '4065678011' })
  expect(snapshot.recommendations.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'author', displayName: 'bilimi·梅林FIT' })
  ]))
  expect(snapshot.recommendations.adoptedCandidateIds).toEqual([])
})
```

Keep a separate test proving confirmed deletion of exact remote folder ID still suppresses only its generic remote observation projection.

- [ ] **Step 2: 运行测试确认旧黑名单行为失败**

```powershell
npx vitest run src/renderer/src/App.test.tsx electron/main/favoriteLibraryManagedFolderProjection.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "scan-candidate blacklist|exact remote folder"
```

Expected: the new scan-candidate test fails before removal; generic exact remote protection test passes.

- [ ] **Step 3: 移除推荐来源筛选**

Delete helpers and arguments whose only purpose is:

```ts
record.ledger.ruleOrigin === 'recommendation-draft'
getFavoriteLedgerDeletedRecommendationRemoteFolderIds
deletedRecommendationRemoteFolderIdsForAccount
recommendationDeletedRemoteFolderIds
deletedRecommendationLogicalLedgerIds
```

Do not delete generic `confirmedDeletedRemoteFolderIds`, remote observation tombstones or exact remote deletion confirmation used by ordinary remote folders.

- [ ] **Step 4: 迁移旧推荐规则为普通规则语义**

In favorite-ledger normalization, convert account-saved legacy recommendation rules without changing remote facts:

```ts
if (cloned.ruleOrigin === 'recommendation-draft') {
  return {
    ...cloned,
    ruleOrigin: 'saved-rule',
    ...(cloned.syncState ? {} : { syncState: cloned.bilibiliFolderId ? undefined : 'local-draft' }),
    ...(cloned.bindingState ? {} : { bindingState: cloned.bilibiliFolderId ? 'bound' : 'unbacked' })
  }
}
```

Preserve `bilibiliFolderId`, `bilibiliFolderIds`, shard information, members and enabled state. Add tests for the `梅林FIT → 4065678011 → bilimi小咪的收藏夹` historical record to prove it remains an ordinary bound rule but does not link to a differently named candidate.

- [ ] **Step 5: 删除纯推荐草稿删除入口**

After `rg` confirms zero production callers, remove `isPureRecommendationLedgerDraft()` and `removePureRecommendationLedgerDraft()`. Keep generic unsaved remote observation deletion helpers.

- [ ] **Step 6: 运行删除、迁移、备册状态测试**

```powershell
npx vitest run src/shared/favoriteLedgerDraftDeletion.test.ts src/shared/favoriteLedgers.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx
```

Expected: PASS. Deleted recommendation records do not hide scan candidates; exact remote deletion protection still works; bound legacy rules preserve exact remote IDs.

- [ ] **Step 7: 提交旧逻辑断链**

```powershell
git add src/renderer/src/App.tsx src/renderer/src/App.test.tsx electron/main/index.ts electron/main/favoriteLibraryManagedFolderProjection.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/shared/favoriteLedgerDraftDeletion.ts src/shared/favoriteLedgerDraftDeletion.test.ts src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts
git commit -m "refactor: remove recommendation-specific remote lifecycle"
```

### Task 7: 恢复、历史、归档预览和 DeepSeek 回归

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

- [ ] **Step 1: 写历史恢复映射失败测试**

```ts
it('restores candidate selection and its ordinary ledger mapping together', async () => {
  // Adopt recommendation -> move history cursor back -> forward.
  // Back: ordinary rule/selection match the baseline.
  // Forward: candidate is selected and classifications target the restored real ledger id, never candidate id.
})

it('rebuilds links after a restored rule rename without reconnecting by old id', async () => {
  const coordinator = createCoordinatorWithRecommendationHistory()
  await coordinator.restoreFavoriteLedgerHistoryState('100', historyStateWithRenamedRule('custom-user-up', 'bilimi·我的UP'))
  const snapshot = await coordinator.getSnapshot('100')
  expect(snapshot.recommendations.links['candidate-up']).toEqual({ status: 'unlinked' })
  expect(snapshot.recommendations.linkedLedgerIdsByCandidateId).not.toHaveProperty('candidate-up')
})
```

- [ ] **Step 2: 更新历史状态类型**

Extend `OldFavoriteWorkspaceFavoriteRuleHistoryState`:

```ts
export type OldFavoriteWorkspaceFavoriteRuleHistoryState = {
  ledgers: FavoriteLedger[]
  adoptedCandidateIds: string[]
  linkedLedgerIdsByCandidateId: Record<string, string>
  excludedLedgerIds: string[]
}
```

History restores ordinary rule directory first, then rebuilds semantic links and validates that restored classifications target existing real ledger IDs. Never reconstruct links from old candidate IDs alone.

- [ ] **Step 3: 校正归档预览和同步预检**

Search all uses of recommendation candidate IDs in archive targets, backup targets and execution plans. Replace candidate IDs with `linkedLedgerIdsByCandidateId[candidateId]`; unlinked candidates cannot become archive or Bilibili targets.

- [ ] **Step 4: 验证 DeepSeek 仅看到已有规则**

Add/retain assertion:

```ts
expect(deepSeekRequest.ledgers.map((ledger) => ledger.id)).toEqual(expect.arrayContaining([linkedLedgerId]))
expect(deepSeekRequest.ledgers.map((ledger) => ledger.id)).not.toContain(candidateId)
expect(systemMessage).toContain('Do not create folders')
```

- [ ] **Step 5: 运行恢复与下游测试**

```powershell
npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
```

Expected: PASS; all classifications/archive targets use ordinary rule IDs.

- [ ] **Step 6: 提交下游一致性**

```powershell
git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts src/shared/oldFavoriteWorkspace.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
git commit -m "fix: keep recommendation links consistent through recovery"
```

### Task 8: 更新项目书和逐项账本证据

**Files:**

- Modify: `docs/项目功能项目书.md:418-465,729-770`
- Modify: `docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md`

- [ ] **Step 1: 在项目书写入当前生效设计**

Add a dated current-authority section after 9.9 with these exact principles:

```markdown
### 9.10 2026-09-06 推荐收藏夹扫描投影模型（当前生效）

推荐候选只由本轮扫描视频的 UP 与标签生成，只保留专属 UP 追更和高频标签。候选不是账号收藏夹规则，也不拥有 B 站绑定、删除墓碑、认领或恢复生命周期。

用户采用候选时复用普通收藏夹本地保存事务。系统在点击前按名称、规则类型和规范化关键词预计算唯一匹配：唯一匹配则复用并勾选；无匹配则新建普通规则并保存勾选；多重匹配失败关闭。上方改名或修改规则后不再联动。

删除普通规则后下方候选取消勾选；只要扫描事实仍满足条件，候选继续或再次出现。历史推荐来源记录不得作为候选黑名单。普通收藏夹的备册、同步、远端删除及精确远端 ID保护继续使用既有流程。
```

Mark 9.6–9.9 recommendation-specific identity/tombstone/link clauses as historical and superseded by 9.10. Preserve their original text.

- [ ] **Step 2: 更新第 5.5 节**

Replace recommendation-draft and stable-ID linkage wording with candidate→ordinary-rule link wording. Keep classification/history/archive snapshot consistency and no-Bilibili-on-local-save rules.

- [ ] **Step 3: 按 I001–I007 回填账本**

For each index row record separately:

- actual code location;
- exact automated test name and command;
- Bilibili spy result;
- required Electron UI check;
- current status (`已实施待界面验收` or `已验收`).

Do not write one generic “tests passed” result across multiple rows.

- [ ] **Step 4: 文档一致性检查**

```powershell
rg -n "推荐来源永久身份|推荐删除墓碑|stable ID|稳定规则 ID|recommendation-draft" docs/项目功能项目书.md
git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md
```

Expected: historical references remain but are explicitly marked superseded; current sections contain no contradictory active rule.

- [ ] **Step 5: 提交文档迭代**

```powershell
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md
git commit -m "docs: replace recommendation lifecycle with scan projection"
```

### Task 9: 全量验证、真实界面验收和最终提交检查

**Files:**

- Evidence: `.codex-artifacts/recommended-favorites/`
- Modify only if evidence finds a scoped defect: files already listed above.

- [ ] **Step 1: 运行定向完整测试**

```powershell
npx vitest run src/shared/favoriteRecommendationProjection.test.ts src/shared/favoriteLedgers.test.ts src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/App.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: 运行受保护回归和全量测试**

```powershell
npm test
npm run build
```

Expected: exit code 0. Save outputs under `.codex-artifacts/recommended-favorites/`.

- [ ] **Step 3: 静态确认旧推荐路径已无生产引用**

```powershell
rg -n "saveRecommendedLedgers|persistRecommendedLedgersUnsafe|promotedRecommendationLedgers|pendingRecommendationSavesRef|deletedRecommendationRemoteFolderIds|recommendation-draft" electron src
```

Expected: removed helpers have zero production references. Any remaining `recommendation-draft` appears only in migration compatibility/tests and is documented.

- [ ] **Step 4: 启动 Electron 开发版真实验收**

Run:

```powershell
npm run dev
```

Verify and capture screenshots/logs:

1. 清洁用户数据扫描后只出现专属 UP追更与高频标签。
2. 点击未匹配推荐，一次创建普通规则并上下勾选；B 站页面/目录无创建请求。
3. 下方取消，再点时复用同名同规则普通规则。
4. 上方改名，下方立即解除联动；再点创建新普通规则。
5. 删除普通规则，下方未勾选；重新扫描同一事实仍推荐。
6. 历史 `梅林FIT` 规则即使绑定 `4065678011 / bilimi小咪的收藏夹`，也不与名称不同的候选联动，不生成“小咪”推荐规则。
7. 显式备册、确认同步、远端删除、DeepSeek 分类仍按原功能工作。
8. 连续鼠标移动、点击、滚动、窗口缩放、最小化、恢复和关闭无明显卡顿；页面尺寸未缩小。

Expected: screenshots stored only in `.codex-artifacts/recommended-favorites/` and referenced per ledger item.

- [ ] **Step 5: 最终原文逐条回读**

Read R001–R010 and I001–I007 from top to bottom. Confirm each has code location, exact test and UI evidence. If any UI or Bilibili condition cannot be verified, leave it `已实施待验证` and do not claim full completion.

- [ ] **Step 6: 工作树检查**

```powershell
git status --short --branch
git diff --stat HEAD~1
git diff --check
git log --oneline --decorate -8
```

Expected: only planned topic files are changed; no unrelated files and no uncommitted implementation remains.

- [ ] **Step 7: 请求代码复审**

Use `superpowers:requesting-code-review`. Review must specifically inspect candidate/rule ID separation, transaction rollback, removal of Bilibili side effects, migration preservation and click-path performance.

- [ ] **Step 8: 修复复审问题并创建本轮最终提交（若需要）**

Run targeted tests after each review fix, then:

```powershell
git add src/shared/favoriteRecommendationProjection.ts src/shared/favoriteRecommendationProjection.test.ts src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts src/shared/oldFavoriteWorkspace.ts src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts electron/main/favoriteLibraryManagedFolderProjection.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/index.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx docs/项目功能项目书.md docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md
git commit -m "fix: finalize scan-derived favorite recommendations"
```

Expected: clean isolated branch. Do not merge, push, rebase, package or delete the worktree. Wait for the user to explicitly request merge.

## 当前迭代批次（R018–R024）

本批次基于 R018–R024 对既有推荐改造和普通备册边界的补充。它不创建新入口、不替代现有确认弹窗，也不把 B 站 API 所需的当前精确 ID 改为名称；名称只用于发现、候选与分册归属，确认后的 ID 只作 API 操作句柄。

### Task 10: 名称发现、同名分册与删除后重发现

**覆盖：** R018、R019、R020、R021、R022 / I011、I012。

**允许修改：** `src/shared/favoriteLedgers.ts`、`src/renderer/src/features/favorites/favoriteLedgerApi.ts`、`electron/main/favoriteLibraryManagedFolderProjection.ts`、`electron/main/favoriteRepositoryBindingService.ts`、相关现有测试。不得改动 B 站请求的精确 ID 参数、现有候选确认/删除知情同意、普通规则真实 ID、推荐的名称加规则语义联动，或增加自动绑定/删除。

1. 将远端名称规范化为基础名和分册号：`名称` 为首册，手工 `名称①` 及自动 `名称②`、`名称③` 都按同一基础名分组；只读兼容旧 `名称·2`。名称匹配不得读取本地关键词、规则类型、旧 folder ID 或删除记录。
2. 对 B 站存在而本地无同基础名规则的情况，仅生成按真实远端 ID 区分的未保存观察草稿；不保存、不绑定、不备册、不参与分类或同步。普通规则本地删除后，备册不得恢复旧规则；仍存在的远端夹只能在下一次显式备册中作为新的独立观察草稿出现。
3. 显式备册先读取当前目录：同名候选进入既有确认绑定流程，用户明确选择后才建立分册；无候选才创建基础名 `名称`。容量不足时创建 `名称②`、`名称③`，跳过 `①`，并保留用户手工命名 `名称①` 的识别能力。
4. 运行并记录名称绑定、新 ID 同名夹、同名多夹、手工 `①`、容量 `②`、普通删除后备册、未保存草稿、确认绑定与确认删除的定向测试。Electron 验收应确认同名候选不自动绑定/删除，且删除规则不复活。

**预期数据与 UI：** 本地规则与远端夹只有在既有确认页经用户同意后才形成物理分册；多个同名远端夹可成为一个规则的多个分册。用户看到的首册无数字，自动扩容从 `②` 起；任何精确远端写入仍使用经确认的当前 ID。

**回归风险：** 同名规则的本地真实 ID、默认规则删除保护、远端草稿重新发现、推荐语义链接和已正式绑定分册都属于受保护路径。

### Task 11: 远端成功后的当前账号收藏页与掌库刷新

**覆盖：** R023、R024 / I013。

**允许修改：** `electron/main/bilibiliSessionRefresh.ts`、`electron/main/index.ts`、`electron/main/favoriteRepositoryBindingService.ts`、`electron/main/favoriteRepositorySyncService.ts` 与对应测试。不得修改 B 站弹窗的创建/改名/删除确认方式、普通网页刷新按钮、视频页 URL、账号切换规则或远端操作成功判定。

1. 在 B 站创建、已确认改名和已确认删除的成功回执后，调用账号级回调：先重投影当前账号的 bilimi 掌库权威快照，再定向刷新个人空间收藏列表页面。
2. 刷新器只选择同一 session 且 URL 为 `space.bilibili.com/<当前 mid>/favlist...` 的 WebView；同一账号的并发成功操作复用单飞 Promise。启动重载前再次校验 URL，页面已经跳转时跳过，避免误刷新视频页或其他账号页。
3. 投影或页面重载失败只留下可重试的刷新事实，不反转已确认的远端创建/改名/删除结果，也不进行额外远端写入。
4. 运行创建、改名、删除、部分删除成功、失败/取消、同账号合并、账号隔离、首页/视频页排除、页面跳转竞态的单元与集成测试。开发版中人工验证 B 站目录计数和折叠列表在成功后收束，bilimi 掌库同步更新。

**预期数据与 UI：** 当前账号收藏页不再需要用户手动刷新才移除已删除目录或更新计数；掌库与该页面使用同一次最新远端事实。非目标标签保持原样。

**回归风险：** WebView 重载可能打断用户浏览，故 URL、账号、session 和操作成功条件均必须同时成立；刷新调度不能阻塞主进程或重复远端变更。

### Task 12: 文档、账本和最终验收

**覆盖：** R018–R024 / I011、I012、I013。

**允许修改：** `docs/项目功能项目书.md`、`docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md`、本计划和 `.codex-artifacts/recommended-favorites/` 证据。不得改写账本原文区（包括重复编号 R021）。

1. 在项目书保留唯一的最终约束：名称决定发现/分册归属、ID 只作确认后的 API 句柄；首册/扩容命名、观察草稿和确认边界保持明确。写入创建/改名/删除真实成功后的当前账号 `/favlist` 与掌库定向刷新及排除范围。
2. 为 I011、I012、I013 分别回填实际代码位置、确切测试命令、测试结果和开发版界面验收证据；不能用一个笼统测试结果代替三项，也不能把无法接入真实 B 站账号的条件写成已完成验收。
3. 运行 `git diff --check`、定向 Vitest、`npm test`、`npm run build`，并在开发版核对普通删除后备册不复活、首册/分册命名、当前账号目录刷新、掌库刷新及非目标标签不刷新。提交前重新通读 R001–R024 全文和索引，逐项确认范围没有扩张。
