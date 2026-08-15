# 删除模式视觉状态与 B 站删除弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让右侧收藏夹删除模式有明确但不改变布局的红色视觉状态，并让详情页 B 站 bilimi 删除始终通过单一弹窗完成范围选择、无目标与核验失败提示。

**Architecture:** 删除模式继续复用已隔离的 `deletionStore`，只向标题操作区和已选卡片暴露短暂的 `data-*` 视觉状态；退出时仍由现有 `deletionStore.reset` 清空选择。详情页把远端删除流程拆成“范围选择 → 远端预览 → 最终确认”，并以同一弹窗组件呈现“无实际远端目标”和“无法核验”，避免写入外部错误提示或产生副作用。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Electron renderer CSS。

---

## 实施前核对

### 已确认（按讨论原文顺序）

1. `R001 / I001`：右侧收藏夹在点击 `x` 前维持现有正常外观与交互；点击后才进入删除模式，且不触发数据副作用。
2. `R001 / I002`：删除模式中只有“全选/取消全选、删除、x”文字为红色；外框、尺寸、位置、圆角不变；“重置”不变。
3. `R001 / I003`：删除模式中仅已勾选卡片红框；未勾选卡片、名称、备册/绑定状态文字和布局不变。
4. `R001、R003 / I004`：详情页外移除“同时从其他 bilimi 工作夹移除”的复选框和说明；同项只在远端删除弹窗内出现。本地删除与批量删除弹窗不改。
5. `R003 / I006`：详情页“从 B 站 bilimi 收藏夹删除”保持可点击；没有实际远端目标时仍打开弹窗，显示真实无目标提示，不执行删除。
6. `R005 / I007`：远端状态因网络、登录或接口错误无法核验时，弹窗显示“暂时无法核验 B 站收藏夹，请稍后重试”，没有确认删除入口，也不写本地/B 站数据。
7. `R005 / I008`：退出删除模式立即清空删除选择，恢复文字、边框和正常交互，不改变收藏夹、草稿、绑定、收藏库或 B 站。

### 明确不做

- `R002 / I005`：不创建浏览器视觉对照页；使用已有截图与 Electron 界面验收。

### 待用户决定与被替代项

- 无。

### 根因证据

- `FavoriteLedgerOverview.tsx:568-580` 已在进入和退出删除模式时重置 `deletionStore`，因此选择不会持久化；缺失的是删除模式的独立视觉标记，现有选择 CSS 在两种模式下都使用蓝色。
- `FavoriteLibraryApp.tsx:1801-1803,2448-2450` 以工作夹绑定状态禁用远端删除按钮，且把范围复选框和说明渲染在详情页外部。
- `FavoriteLibraryApp.tsx:1362-1364` 将“没有已观察到的远端位置”写入页面外错误；`1369-1389` 的预览异常向 `runDetailAction` 冒泡，再由 `1130-1142` 写入页面外错误。二者都不能满足弹窗内区分“无目标”和“无法核验”。

## 文件范围

- 修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
  - 暴露删除模式与已选卡片的纯视觉 `data-*` 状态，保留现有选择和退出重置逻辑。
- 修改：`src/renderer/src/styles.css`
  - 仅为删除模式标题文字和已选卡片覆盖颜色/边框，禁止改变几何布局。
- 修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
  - 覆盖进入、选择、退出后的视觉状态与隔离选择。
- 修改：`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
  - 用单一详情页弹窗承载范围选择、无目标提示、核验失败提示与既有预览确认。
- 修改：`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
  - 覆盖范围控件迁移、未绑定/无目标可点击、预览异常的无副作用提示。
- 修改：`docs/requirement-ledgers/2026-08-15-deletion-mode-visual-state.md`
  - 逐项填充代码位置和验证证据。

## Task 1: 为右侧删除模式写失败测试（R001、R005）

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 添加失败测试，要求正常模式没有删除视觉标记。**

  在现有 `uses one bulk toggle for normal and isolated deletion selections` 附近新增测试：渲染一条已启用收藏夹，断言标题操作容器没有 `data-deletion-mode`，卡片没有 `data-deletion-selected`，且“重置”没有危险状态属性。

- [x] **Step 2: 添加失败测试，要求选择与退出准确改变视觉状态。**

  点击“展开删除模式”，断言操作容器为删除模式；点击“加入删除 bilimi·音乐”，断言该卡片有 `data-deletion-selected`；点击“取消删除模式”后断言两个属性均消失且正常“移出同步”控件仍可用。测试不得调用 `onSaveLedgers`。

- [x] **Step 3: 运行定向测试并确认 RED。**

  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: 新断言因缺少删除模式视觉数据属性而失败；既有删除语义测试保持通过。

## Task 2: 实现右侧视觉状态并确认 GREEN（R001、R005）

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:992-1025`
- Modify: `src/renderer/src/styles.css:4919-5047`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 在操作栏和卡片添加纯视觉状态。**

  为 `.favorite-ledger-panel__category-actions` 写入 `data-deletion-mode={deletionModeActive || undefined}`；为每个 `.favorite-ledger-panel__chip-item` 写入 `data-deletion-selected={deletionModeActive && enabled && !disabledBySystem || undefined}`。不改 `enterDeletionMode`、`cancelDeletionMode` 的 `deletionStore.reset(enableEntries(..., true))`，因为该重置正是退出时清空选择的既有实现。

- [x] **Step 2: 添加最小 CSS 覆盖。**

  仅在 `[data-deletion-mode]` 下把“全选/取消全选、删除、x”文字设为既有危险红色，排除首个“重置”按钮；仅在 `[data-deletion-selected]` 下把两个卡片按钮的边框改为同一危险红色。不得改变 `width`、`min-height`、`padding`、`border-radius`、网格列或状态文字颜色。

- [x] **Step 3: 运行定向测试并确认 GREEN。**

  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: 新测试和既有删除模式/默认收藏夹测试通过。

## Task 3: 为详情远端删除弹窗写失败测试（R001、R003、R005）

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx:1710-1761`

- [x] **Step 1: 修改范围测试，要求复选框只在弹窗内。**

  点击详情页“从 B 站 bilimi 收藏夹删除”后，断言页面外找不到 `同时从其他 bilimi 工作夹移除`；在名为“确认从 B 站 bilimi 收藏夹删除”的初始弹窗内断言该复选框存在。勾选后点击“继续”，再断言预览调用接收两个工作夹 ID。

- [x] **Step 2: 添加无实际目标测试。**

  使用 `pending-reconcile` 工作夹和空远端观察位置，断言详情页远端删除按钮未禁用；点击后直接显示“当前没有实际 B 站 bilimi 收藏夹，无法执行删除。”，且未调用预览、确认或执行 API。

- [x] **Step 3: 添加核验异常测试。**

  让 `previewFavoriteLibraryManagedPlacementRemoval` reject；在初始弹窗点击“继续”后，断言同一弹窗显示“暂时无法核验 B 站收藏夹，请稍后重试”，不显示“确认删除 B 站 bilimi 归属”，也未调用确认或执行 API。

- [x] **Step 4: 运行定向测试并确认 RED。**

  Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

  Expected: 当前按钮会被禁用、范围控件在页面外且预览异常写入外部错误，因此新断言失败。

## Task 4: 实现单一详情远端删除弹窗并确认 GREEN（R001、R003、R005）

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:489-508,1348-1391,1797-1803,2440-2459`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 增加只服务详情页远端删除的弹窗阶段状态。**

  使用 `remoteUnfavoriteDialog` 表达 `choice`、`missing-target`、`unverified` 和关闭状态。按钮点击先基于现有详情快照识别确定的无远端目标并打开 `missing-target`；其余情况打开 `choice`。不修改批量远端删除状态与本地删除状态。

- [x] **Step 2: 将范围选择搬到 `choice` 弹窗。**

  详情页外只保留 B 站删除按钮。`choice` 弹窗中沿用现有 `removeManagedOtherFolders` 字段和“同时从其他 bilimi 工作夹移除”文案；“继续”调用既有预览逻辑。关闭任一详情远端弹窗时清除范围选择。

- [x] **Step 3: 区分无目标与核验失败。**

  `beginRemoteUnfavorite` 对确定无远端位置只切换到 `missing-target`，不再 `setError('收藏未同步')`；预览调用抛错时捕获并切换到 `unverified`，不向 `runDetailAction` 冒泡。两个提示阶段均只有关闭/重试入口，没有确认删除按钮，也不刷新或写数据。

- [x] **Step 4: 保留既有确认语义。**

  预览成功后使用现有 `remoteUnfavoritePreview` 内容和 `confirmRemoteUnfavorite`；将范围复选框及解释置于该弹窗内，确认/执行/回收站语义不改。批量远端删除和从收藏库删除的弹窗不改。

- [x] **Step 5: 运行定向测试并确认 GREEN。**

  Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

  Expected: 新弹窗分支和既有详情/批量删除回归均通过。

## Task 5: 集成验证、账本核对与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-deletion-mode-visual-state.md`
- Verify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Verify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 运行两份定向测试和类型构建。**

  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

  Run: `npm run build`

  Expected: 两项均 exit 0。

- [ ] **Step 2: 真实 Electron 验收。**

  在开发版依次验证：正常模式未变；进入删除模式文字红且框不动；选中一张卡片只有红框；取消删除模式后颜色与选择恢复；详情页外没有范围复选框；无目标与预览故障分别显示正确弹窗且不可确认；有目标可在弹窗内勾选范围并走到既有确认页。记录截图或无法运行的具体原因至 `.codex-artifacts/`。

- [x] **Step 3: 按 I001-I008 填写账本证据并检查工作树。**

  Run: `git diff --check; git diff --stat; git status --short`

  Expected: 仅本计划列出的代码、测试、样式、账本和计划文件改动；无空白错误。

- [x] **Step 4: 创建本地 main 提交。**

  Run: `git add docs/requirement-ledgers/2026-08-15-deletion-mode-visual-state.md docs/superpowers/plans/2026-08-15-deletion-mode-and-remote-deletion-dialog-plan.md src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/styles.css && git commit -m "feat: refine deletion mode and remote removal dialog"`

  Expected: 一个只包含本轮主题的本地 `main` 提交；不 push、不 merge。

## 自检

- 覆盖：I001-I004 由 Task 1-4 覆盖；I005 明确不做；I006-I008 由 Task 3-4 覆盖。
- 边界：未修改批量远端删除、收藏库本地删除、默认收藏夹/备册/绑定规则，也未触碰上一轮未绑定状态持久化主题。
- 风险：详情远端删除以新阶段状态控制渲染，必须保留成功预览后的既有确认与执行路径；右侧仅添加临时 DOM/CSS 状态，不能写入 `onSaveLedgers`。

## 执行记录

- Task 5 / Step 2 未完成真实 Electron 界面验收：账号无效且 SSL 握手失败；两次窗口激活均返回 `foreground window did not report a process id`。已停止 UI 注入，详见 `.codex-artifacts/2026-08-15-deletion-mode-electron-verification.md`。
