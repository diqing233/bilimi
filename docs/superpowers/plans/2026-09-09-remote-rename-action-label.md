# 远端收藏夹改名提示文案与变更按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将远端改名检测详情改为不可点击的精确说明文案，并用行尾按钮打开既有改名确认弹窗。

**Architecture:** 保留疑似收藏夹的独立可点击行。已绑定改名候选改为说明文本和显式 `变更` 按钮的组合；按钮继续复用现有 `setBoundRenameCandidates`／`setBoundRenameError` 状态入口，因此不新增 B 站或持久化写入路径。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、CSS。

---

### Task 1: 锁定文案与按钮交互

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:19-96`

- [x] **Step 1: 写入失败的组件测试**

将当前“已绑定收藏夹名称已从……”按钮期望替换为以下断言：

```tsx
const renameText = screen.getByText('将b站收藏夹“bilimi·旧游戏”变更为“bilimi·游戏”')
expect(renameText.closest('button')).toBeNull()
expect(screen.getByRole('button', { name: '变更' })).toBeInTheDocument()
```

并让改名弹窗用例点击 `screen.getByRole('button', { name: '变更' })`。

- [x] **Step 2: 运行测试确认红灯**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "bound-rename|combined remote detection"`

Expected: FAIL，因为现有组件仍渲染可点击的“已绑定收藏夹名称已从……”整行，且没有 `变更` 按钮。

### Task 2: 最小实现和样式

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1863-1866`
- Modify: `src/renderer/src/styles.css:4900-4927`

- [x] **Step 1: 将改名候选改为文本加按钮**

每个 `shard` 渲染普通文本和按钮：

```tsx
<div className="favorite-ledger-panel__remote-rename-detail">
  <span>将b站收藏夹“{shard.currentRemoteTitle}”变更为“{shard.targetTitle}”</span>
  <button type="button" onClick={() => {
    setBoundRenameCandidates([candidate])
    setBoundRenameError(null)
  }}>变更</button>
</div>
```

- [x] **Step 2: 添加局部布局样式**

使用仅作用于 `.favorite-ledger-panel__remote-rename-detail` 的 flex 行布局与小间距，使按钮紧随文案；不复用疑似收藏夹行的下划线可点击样式。

- [x] **Step 3: 运行组件测试确认绿灯**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "bound-rename|combined remote detection"`

Expected: PASS；文案不是按钮，只有 `变更` 打开既有改名确认弹窗，保存／同步回调未被调用。

### Task 3: 回归验证与本地提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-09-remote-rename-action-label.md`
- Modify: `docs/superpowers/plans/2026-09-09-remote-rename-action-label.md`

- [x] **Step 1: 运行完整组件测试与构建**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx` and `npm run build`

Expected: 组件测试和构建均以 exit code 0 完成。

Result: `FavoriteLedgerOverview.test.tsx` 154/154 通过；`npm run build` exit 0（仅出现既有的 `FloatingAssistantApp.tsx` 动态／静态导入分包警告）。Computer Use 未发现可操作 Electron 窗口，真实开发版的正向命中排版待界面验收；没有执行确认操作或 B 站改名。

- [x] **Step 2: 记录验证结果并检查提交范围**

Run: `git status --short`, `git diff --check`, `git diff --cached --check`

Expected: 仅本轮账本、计划、组件、样式和测试处于暂存状态；无关文档不暂存。

- [x] **Step 3: 创建本地提交**

```powershell
git commit -m "fix: clarify remote favorite rename action"
```

Expected: 只产生本轮一个本地提交，不 push。
