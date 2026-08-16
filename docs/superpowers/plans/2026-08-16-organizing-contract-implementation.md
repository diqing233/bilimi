# Organizing Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让整理收藏的批次总览、推荐删除、远端收藏夹与本地工作区分层、标签重复采用和绑定/同步边界符合已确认的项目书，并可由回归测试保护。

**Architecture:** 先修复纯前端、无数据迁移的两处现有投影错误；随后将“远端展示位置”“本地关系状态”“扫描资格”从 `isBilimiWorkFolder` 中拆开并为旧工作区提供兼容读取；再为标签索引增加已采用版本，最后把绑定和同步拆为明确的命令与确认流程。每一批只通过既有 IPC 读取或本地状态改动实现，真实 B 站写入仍只可从显式确认操作到达。

**Tech Stack:** Electron、TypeScript、React、Vitest、Testing Library、持久化 JSON 工作区。

---

## 范围和受保护流程

- 需求账本：`docs/requirement-ledgers/2026-08-16-organizing-contract-implementation.md`（实施前须从头通读原文区和索引）。
- 产品规则：`docs/项目功能项目书.md:229-319`；原始规则：两个 2026-08-16 扫描/远端账本。
- 根目录 `main`：用户已明确授权直接施工；不得修改或暂存未跟踪的 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`。
- 每批提交前均运行：`git status --short --branch`、`git diff --stat`、`git diff --check`、对应 Vitest、`npm test`。涉及界面/网络/窗口的规则还须在 Electron 开发版验收，自动测试不能替代。

### Task 1: 首批可用时展示本轮总览（I-01）

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx:241-248`

- [x] **Step 1: 写出只覆盖“其他批仍补标签”的失败回归测试。**

在 `OldFavoriteGuide.test.tsx` 构造两个批次：`segment-ready` 状态 `ready` 且含分类/推荐，`segment-enriching` 仍补取标签；顶层 `tagEnrichment.status` 为 `running`。选择“本轮总览”，断言推荐/归档总览不显示“等待标签完成”的空态，并显示已就绪批数据及“仍在补取”的提示。

- [x] **Step 2: 先运行测试确认旧实现失败。**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`

Expected: 新增断言失败，原因是 `viewScope === 'all'` 受全局 `enrichmentActive` 阻断。

- [x] **Step 3: 以已就绪批次作为总览可用性的唯一数据依据。**

在 `OldFavoriteGuide.tsx` 新增 `hasReadyWholeRunSegment = displayedSnapshot.segments.some((segment) => segment.status === 'ready' || segment.status === 'saved')`，并让本轮视图的 `canShowWholeRun` 使用该值而非全局标签状态；保留当前批在标签运行时的等待态。为部分总览传入剩余批的状态，页面只显示“部分结果，其他批仍在补取标签”，不能显示整轮完成。

- [x] **Step 4: 运行定向测试和完整回归。**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: 所有测试通过；记录既有测试警告但不把警告当作通过证据。

### Task 2: 由权威删除结果清理推荐投影（I-02）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:196-266,320-329`
- Read/verify callback contract: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:861-924,963-1033`
- Modify only if callback cannot报告“本地删除成功”: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: 写出删除成功和失败两个失败测试。**

渲染一个未备册推荐产生的 `promotedRecommendationLedgers`：删除成功的回调返回成功后，断言推荐候选、顶部卡片和局部映射同时移除；删除失败时断言三者仍在，且显示“删除未成功，请稍后重试。”。测试必须等到 `FavoriteLedgerOverview` 实际持久化删除返回，不能仅点击删除按钮。

- [x] **Step 2: 运行两个新增测试确认旧投影保留。**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: 成功删除后的顶部投影断言失败；失败路径保持原样。

- [x] **Step 3: 在删除成功信号返回后原子清理投影。**

让 `ControlledFavoriteLedgerPanel` 接收/使用一个只在 `deleteFavoriteLedgerDraft` 与 `onDeleteLedger` 都成功后触发的删除结果回调；回调按 ledger ID 删除 `promotedRecommendationLedgers`、候选勾选和 candidate/ledger 映射。删除失败或取消不修改这些状态；已备册/绑定项继续仅取消本轮推荐勾选。

- [x] **Step 4: 运行定向测试和完整回归。**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: PASS。

### Task 3: 拆分远端展示、关系状态和扫描资格（I-03）

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts:46-76,253-260`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts:80-121,648-708`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts:396-406,540-586`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:879-884`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:124-139,303-355`
- Read/align: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`, `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Tests: `src/shared/oldFavoriteWorkspace.test.ts`, `electron/main/oldFavoriteWorkspaceStore.test.ts`, `electron/main/oldFavoriteWorkspaceScanService.test.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`, `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [ ] **Step 1: 为三维投影写失败测试。**

覆盖四种实体：普通远端夹（用户区、可扫描）、名称含 bilimi 但无关系的远端夹（用户区、可扫描）、已绑定远端夹（用户区、关系徽标、不可扫描）、本地规则存在而远端关系待对账的夹（用户区关系徽标 + 工作区待对账卡、不可扫描）。旧工作区缺少新字段时必须读取为现有的兼容行为。

- [ ] **Step 2: 验证失败并加入可迁移的类型字段。**

Run: `npx vitest run src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: 新断言先失败。

定义 `remoteRelationship: 'none' | 'bound' | 'reconcile-required'` 与独立的 `scanEligible: boolean`；保留 `isBilimiWorkFolder` 的旧数据读取兼容但不再作为 UI 分组依据。store 缺字段时从可靠本地 rule/folder 关系导出并保存新投影，不因名称推断。

- [ ] **Step 3: 将扫描器和 UI 切至新投影。**

扫描器只接收 `scanEligible` 的远端夹；UI 将远端夹全部渲染到用户区，并将本地规则/草稿/关系状态渲染为工作区卡片。关系徽标不能移动远端实体；无关系夹永远不因为名字成为工作区。

- [ ] **Step 4: 运行定向、完整及迁移回归。**

Run: `npx vitest run src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: PASS。

### Task 4: 标签版本化和再次采用（I-04）

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:386-416,4211-4232`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts:540-586`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:261-280`
- Tests: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`, `electron/main/oldFavoriteWorkspaceStore.test.ts`, `electron/main/oldFavoriteWorkspaceScanService.test.ts`, `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [ ] **Step 1: 写可重复采用的失败测试。**

断言已采用批在没有 `pendingAids` 时仍可继续补取；扫描出新增或内容变化标签后显示“采用当前标签”；再次采用只改变系统分类/推荐/预览，人工分类和已勾选推荐不变；无新增/变化时不显示再次采用；旧持久化对象缺少版本字段可读。

- [ ] **Step 2: 验证失败并实现版本化状态。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: 继续操作因没有 `pendingAids` 被拒绝，新增采用按钮断言失败。

持久化每批标签内容版本和 `acceptedTagVersion`；继续补取读取所有已完成/可重试条目而不是仅 pending；仅 `tagVersion > acceptedTagVersion` 使状态成为 `awaiting-adoption`。采用后更新 accepted 版本、重建系统派生结果并合并回人工覆盖与推荐选择。

- [ ] **Step 3: 运行定向和完整回归。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: PASS。

### Task 5: 显式绑定、同步和对账（I-05）

**Files:**
- Modify only after Task 3 contracts exist: relevant `src/shared/oldFavoriteWorkspace.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.ts`, `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`, `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx` and tests.

- [ ] **Step 1: 先写绑定、同步和错误恢复的失败测试。**

断言扫描选择、普通同步选择和名称相似夹不会写绑定记录；“确认绑定”命令必须携带账号、local rule ID、remote folder ID、容量与副作用确认；确认成功前同步入口禁用；绑定失败保留待对账状态；绑定成功后同步是独立第二次调用。

- [ ] **Step 2: 先验证失败，再实现明确命令边界。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: 新增测试先失败，因为现有路径可能复用同步或扫描选择。

新增或收紧 `confirmBinding` 命令，只修改本地关系记录；将远端同步调用保持在独立 `sync` 命令之后。所有失败返回可读错误和可恢复状态，禁止隐式重试 B 站写入。

- [ ] **Step 3: 回归并进行受控真实验收。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: PASS。

Run: `npm test`

Expected: PASS。

Electron 验收：在开发版检查鼠标移动、点击、滚动、缩放、最小化和关闭；以测试账号/无写入路径验证确认信息、失败提示和禁用状态。真实绑定或同步 B 站前，向用户报告目标账号/夹和副作用并取得单独授权。

### Task 6: 按账本逐项验收和提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-16-organizing-contract-implementation.md`

- [ ] **Step 1: 按 I-01 至 I-05 回写实际代码位置、定向测试、完整测试和 Electron 验收结果。**

任何未做或无法实机验证的条目保留“已实施待验证”及准确原因，不能以其他测试通过替代。

- [ ] **Step 2: 完成最终 Git 验证和本地提交。**

Run: `git status --short --branch; git diff --stat; git diff --check; npm test`

Expected: 无空白错误、测试通过、仅本轮文件将进入暂存；未跟踪的 `2026-08-16-overview-recommendation-projection.md` 仍未被暂存。

Run: `git add <only-this-round-files> && git commit -m "fix: enforce organizing workspace contracts"`

Expected: 一个本地 `main` 提交；不 push、不 rebase、不发布。

## 自检

- I-01/I-02 是不触及持久化模型的快速保护批；I-03 在它们稳定后才迁移分层；I-04 依赖 I-03 的批次投影；I-05 最后才允许接触明确绑定动作。
- 已覆盖项目书中的继续扫描/补取、批次部分总览、用户收藏夹与本地工作区、取消推荐、再次采用和绑定/同步边界。扫描暂停/继续、网络/412/镜像重建保留现有实现，最终在 Task 5 Electron 验收中逐条验证；发现不符时追加同主题账本条目和测试后修复。
- 计划未将任何测试通过表述成真实 B 站写入成功；真实远端写入仍需用户单独授权。
