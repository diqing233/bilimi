# 备册状态与远端草稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“备册”严格按实际 B 站候选分流，空候选显示未备册并先确认创建；让所有未被明确忽略的实际 bilimi 收藏夹可投影为独立远端草稿。

**Architecture:** `favoriteLedgerApi` 的脚本是远端清单与本地规则状态的唯一交汇点：用户解除标记只禁止静默认领，不覆盖“无候选=未备册”的事实；备册创建被显式确认门控。主进程仅将用户选择的“不再提醒”ID传入草稿过滤，恢复待处理记录不再隐藏真实远端草稿。现有右侧全量与收藏库单项入口复用既有确认窗口，不增加新按钮。

**Tech Stack:** TypeScript、React、Vitest、Testing Library、Electron IPC、B 站页面脚本。

---

### Task 1: 固化本轮合同与实施范围

**Files:**
- Modify: `docs/项目功能项目书.md:141-205`
- Modify: `docs/requirement-ledgers/2026-08-20-empty-remote-folders-status.md`
- Create: `docs/superpowers/plans/2026-08-20-favorite-backup-state-and-remote-drafts.md`

- [x] **Step 1: 按 R001-R006 写入完整备册矩阵**

将状态分支写为：有精确候选=`未绑定→确认绑定`；无候选=`未备册→确认创建并绑定`；远端 bilimi 无规则=`未保存 · 未绑定`草稿；已删除规则只可恢复。明确确认页不是常驻按钮，并列出单项、全量、详情和宠物入口的范围。

- [x] **Step 2: 记录不修改边界**

不新增“重试备册/重新绑定/对账”按钮；不改视频同步、DeepSeek、转写；不调用真实 B 站写操作；保留另一个未跟踪 DeepSeek 账本。

### Task 2: 用失败测试定义“解除标记不覆盖无候选”和“创建必须确认”

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 新增状态脚本失败测试**

构造带 `managedFolderDeletedByUser=true` 的默认规则，远端列表为空；断言状态为 `unbacked`、没有旧 remote ID、`unboundLedgerIds=[]`、候选列表为空。构造未备册规则调用普通全量备册；断言不发 `/folder/add`，返回空候选的确认需求。

- [x] **Step 2: 新增收藏库失败测试**

构造无正式分册、无候选的当前工作夹；断言显示 `未备册`，点击原有 `备册当前收藏夹`后仅显示“确认创建并绑定”，未点击确认时不调用 `ensureFavoriteLedger`。

- [x] **Step 3: 运行 RED**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "released.*no.*candidate|confirmation before creating|current.*unbacked"`

Expected: FAIL，因为当前解除标记直接返回 `unbound`，普通全量备册会直接调用创建。

### Task 3: 最小修复备册状态和确认门控

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:157-220,492-600`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: 让解除标记保留候选但不伪造候选**

`managedFolderDeletedByUser`有精确候选时返回带候选 ID 的 `unbound`；无候选时删除陈旧远端字段并返回 `unbacked`。显式选定 remote ID 的路径保持最高优先级。

- [x] **Step 2: 把创建放在确认门之后**

普通 `buildEnsureFavoriteLedgersScript`遇到 `unbacked` 已启用规则时返回空候选确认需求；仅 `confirmCreateAndBind=true` 才进入创建循环。保留同名候选的确认绑定流程，且不自动改名、同步视频或处理其它目标。

- [x] **Step 3: 运行 GREEN**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "released.*no.*candidate|confirmation before creating|current.*unbacked"`

Expected: PASS.

### Task 4: 让真实远端 bilimi 收藏夹持续投影为草稿

**Files:**
- Modify: `electron/main/index.ts:2458-2461`
- Modify: `electron/main/store.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 新增失败测试**

构造永久“不再提醒”列表为空、恢复待处理列表含远端 ID的账号；断言状态读取仍将该 ID传给草稿投影并显示本地草稿。另断言明确“不再提醒”的 ID仍不显示。

- [x] **Step 2: 仅把永久“不再提醒”当成草稿过滤**

IPC 查询不再把“曾本地删除、等待重新发现”的内部 pending ID合并进草稿忽略列表。pending记录可以保留作审计/兼容数据，但不得隐藏 B 站实际仍存在的独立 bilimi 收藏夹。

- [x] **Step 3: 运行 GREEN**

Run: `npx vitest run electron/main/store.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx -t "remote.*draft|dismissed|pending"`

Expected: PASS，并证明空夹、未保存远端草稿和明确不再提醒的边界。

### Task 5: 回归、账本证据与本地提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-20-empty-remote-folders-status.md`

- [x] **Step 1: 运行相关全量测试和构建**

Run: `npm test -- --run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx electron/main/store.test.ts`

Run: `npm run build`

- [x] **Step 2: 完成按 R001-R006 的账本证据**

逐项写入代码位置、自动化证据与未执行真实 B 站写操作的界限。真实 Electron 只做打开、读取、取消确认与交互流畅性检查；不点击确认创建/绑定。

- [ ] **Step 3: 提交前核对与本地提交**

运行 `git diff --check`、检查工作树只暂存本轮项目书、账本、计划、代码和测试；排除 `2026-08-20-deepseek-auto-summary-not-triggered.md`。在 `main` 本地提交一次，不 push、merge、rebase。
