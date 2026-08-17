# 本轮总览标签进度对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在多批整理的当前批次与本轮总览中，以各自权威 scope 显示同级的两条横向进度，并保持总览文字摘要。

**Architecture:** `OldFavoriteScanOverviewStep` 已拥有当前批与整轮的标签 scope 快照，因而在这个共同的扫描进度区投影第二行；`OldFavoriteWholeRunOverview` 保持其文字摘要职责而不承担重复的进度条或操作按钮。样式只调整四列进度行的弹性分配：横条是唯一可收缩列，数值和状态作为不可截断内容保留。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、CSS Grid。

---

## 已确认需求与排除项

- R001、R002、R003：当前批次和本轮总览都显示扫描进度与标签补取横条；当前批使用 `currentSegment` scope，总览使用 `wholeRun` scope；总览已有“标签补取中 …”文字汇总保留。
- R003：进度行优先为“标签 + 横条 + 范围计数 + 状态”单行；横条优先收缩，数量和状态不截断，确无空间时才换行。
- 无待用户决定、无被替代项、无明确不做项。
- 不修改标签补取任务、采用、暂停、保存、同步、DeepSeek 或 B 站副作用；不复制当前批专属操作控件。

## 文件边界

- 修改：`docs/项目功能项目书.md` — 第 5.2 与 5.4 的进度展示设计。
- 修改：`src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx` — 扫描概览的 current/all scope 回归测试。
- 修改：`src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx` — 同一进度区渲染标签 scope 行。
- 修改：`src/renderer/src/styles.css` — 进度行四列且窄栏优先收缩横条。
- 修改：`docs/requirement-ledgers/2026-08-17-overview-tag-progress-parity.md` — R001–R003 的实现、测试和界面验收证据。

### Task 1: 为两种 scope 写出失败的扫描概览测试

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [x] **Step 1: 在既有多批、标签补取中的快照旁新增测试**

  ```tsx
  it('projects tag progress with the selected current or whole-run scope', () => {
    const { rerender } = render(<OldFavoriteScanOverviewStep snapshot={snapshot} viewScope="current" {...props} />)

    expect(screen.getByLabelText('当前批次标签进度')).toHaveAttribute('max', '2000')
    expect(screen.getByLabelText('当前批次标签进度')).toHaveAttribute('value', '176')
    expect(screen.getByText('当前批 176 / 2000 条')).toBeInTheDocument()
    expect(screen.getByText('补取中')).toBeInTheDocument()
    expect(screen.queryByLabelText('本轮标签进度')).not.toBeInTheDocument()

    rerender(<OldFavoriteScanOverviewStep snapshot={snapshot} viewScope="all" {...props} />)

    expect(screen.getByLabelText('本轮标签进度')).toHaveAttribute('max', '2873')
    expect(screen.getByLabelText('本轮标签进度')).toHaveAttribute('value', '176')
    expect(screen.getByText('本轮 176 / 2873 条')).toBeInTheDocument()
    expect(screen.queryByText('当前批 176 / 2000 条')).not.toBeInTheDocument()
    expect(screen.getByText('标签补取中 2873 条 · 已补取 176 条 · 待补取 2697 条')).toBeInTheDocument()
  })
  ```

- [x] **Step 2: 运行单文件测试并确认因总览横条尚未渲染而失败**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 新测试因找不到 `本轮标签进度` 或 `本轮 176 / 2873 条` 失败；现有测试仍可运行。

### Task 2: 在共同扫描进度区投影所选标签 scope

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:150-245`

- [x] **Step 1: 为多批 selected scope 建立单一展示模型**

  ```tsx
  const showScopedTagProgress = hasMultipleSegments && Boolean(scopedTagEnrichment)
  const scopedTagProgressLabel = viewScope === 'all' ? '本轮' : '当前批'
  const scopedTagProgressAriaLabel = viewScope === 'all' ? '本轮标签进度' : '当前批次标签进度'
  const scopedTagProgressStatus = viewScope === 'current'
    ? currentSegmentSummary?.readiness === 'waiting' ? '等待扫描'
      : currentSegmentSummary?.readiness === 'tagging' ? '补取中'
      : currentSegmentSummary?.readiness === 'saved' ? '已保存' : '可整理'
    : tagEnrichment?.status === 'running' ? '补取中'
      : tagEnrichment?.status === 'paused' ? '已暂停'
      : tagEnrichment?.status === 'accepted' ? '已采用' : '已完成'
  ```

- [x] **Step 2: 以一个 scope 行替换仅 current 的标签进度分支**

  ```tsx
  {showScopedTagProgress ? <div>
    <span>标签补取</span>
    <progress aria-label={scopedTagProgressAriaLabel}
      max={Math.max(scopedTagEnrichment!.totalItemCount, 1)}
      value={scopedTagEnrichment!.completedItemCount} />
    <span>{scopedTagProgressLabel} {scopedTagEnrichment!.completedItemCount} / {scopedTagEnrichment!.totalItemCount} 条</span>
    <strong>{scopedTagProgressStatus}</strong>
  </div> : null}
  ```

- [x] **Step 3: 运行单文件测试并确认测试转绿**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 退出码 0；新测试证明 current 与 all 分别读取 2000 与 2873，而不是互相污染。

### Task 3: 让四段进度内容在窄侧栏中优先压缩横条

**Files:**

- Modify: `src/renderer/src/styles.css:6072-6090`

- [x] **Step 1: 将进度行从三列改为标签、弹性横条、数值、状态四列**

  ```css
  .favorite-ledger-panel__scan-progress > div {
    grid-template-columns: max-content minmax(2.75rem, 1fr) max-content max-content;
  }
  .favorite-ledger-panel__scan-progress > div > span,
  .favorite-ledger-panel__scan-progress strong {
    white-space: nowrap;
  }
  ```

  保留 `progress { width: 100%; min-width: 0; }`，使横条成为唯一优先收缩部分；不为状态添加省略号。

- [x] **Step 2: 重跑扫描概览测试并执行类型/构建验证**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx && npm run build`

  Expected: 两命令退出码均为 0。

### Task 4: 需求逐项核验、界面验收与提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-17-overview-tag-progress-parity.md`

- [x] **Step 1: 再次全文通读账本原文和索引，并按 R001、R002、R003 核对**

  检查总览条的 `aria-label` 和数值来自 `wholeRun`、当前批条来自 `currentSegment`、总览文字摘要仍在、没有新增操作控件或命令调用。

- [x] **Step 2: 在 Electron 开发版手工检查宽、窄侧栏**

  Run: `npm run dev`

  在多批标签补取期间切换“当前批次 / 本轮总览”：两视图各有两条进度；收窄助手侧栏时横条缩短而数值/状态完整；极窄宽才允许整行受控换行。确认切换不触发暂停、采用、保存或同步。

- [x] **Step 3: 记录每条 R 编号的代码位置、自动测试和真实界面验收**

  在账本索引的验收证据填入组件、样式、测试命令和截图/手测结果；若 Electron 环境无法启动，标记“待真实界面验收”，不得把自动测试当作截图验收。

- [x] **Step 4: 执行提交前检查并仅提交本轮文件**

  Run: `git diff --check && npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx && npm run build && git status --short && git diff --stat`

  Expected: 格式检查、相关测试、构建均退出码 0；状态仅包含项目书、计划、账本、进度组件、样式和测试。随后创建一个本地 `main` 提交，提交信息：`fix: align whole-run tag progress`。

## 自检

- R001/R002 的总览缺少横条由 Task 1–2 覆盖；R003 的当前批/整轮数字口径、单行优先与文字汇总保留分别由 Task 1–3 覆盖。
- 计划不改工作区命令、任务状态、持久化、DeepSeek 或 B 站层；这些边界在 Task 4 逐项复查。
- 已检查无 `TBD`、`TODO` 或省略性实施步骤；测试中的 2000、2873、176、2697 是明确的 current/whole-run 对照数据，不等同于用户截图中任一实时数字。
