# 收藏库菜单初始化竞态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止收藏库首次打开 bilimi 工作夹内单个工作夹三点菜单时，被首次初始化 effect 关闭，同时保持 UID 切换和工作夹折叠时关闭菜单的既有行为。

**Architecture:** `FavoriteLibraryNavigation` 已以一个共享的 `managedMenu` state 和 Portal 表示单个工作夹菜单。新增的挂载前 UID ref 只区分“首次挂载”和“实际 UID 变化”：首次不关闭，UID 变化才调用既有 `closeManagedMenu`。不改变 Portal、菜单动作、删除确认或数据命令。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron renderer。

---

## 文件职责与改动边界

| 文件 | 职责 | 本轮改动 |
| --- | --- | --- |
| `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx` | 收藏库左侧导航、菜单 Portal 与账号切换的渲染契约。 | 先添加首次初始化和 UID 切换的确定性回归测试。 |
| `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx` | 左侧导航的共享受管工作夹菜单状态。 | 仅让 UID effect 跳过首次挂载。 |
| `docs/项目功能项目书.md` | 唯一日常维护的全项目产品行为基准。 | 以当前 `main` 和本轮完整验证更新历史测试基线记录。 |
| `docs/requirement-ledgers/2026-08-16-managed-menu-initialization-race.md` | 本轮用户原文、范围和逐项验收审计。 | 追加实际代码位置和验证证据。 |

### Task 1: 锁定首次初始化与账号切换的菜单契约

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`

- [x] **Step 1: 先写失败测试**

在现有“closes the shared managed-folder portal when the account changes”测试附近添加一个不经 Testing Library `act` 自动冲洗 effect 的同步挂载场景。渲染后立刻点击 `one 菜单`，断言真实 Portal `role=menu` 仍可见；随后将 `uid` 从 `100` 重渲染为 `200`，断言菜单关闭。

```tsx
const root = createRoot(container)
flushSync(() => root.render(<FavoriteLibraryNavigation {...props} uid="100" />))
fireEvent.click(within(container).getByRole('button', { name: 'one 菜单' }))
expect(screen.getByRole('menu', { name: 'one 操作' })).toBeInTheDocument()
flushSync(() => root.render(<FavoriteLibraryNavigation {...props} uid="200" />))
expect(screen.queryByRole('menu', { name: 'one 操作' })).not.toBeInTheDocument()
```

- [x] **Step 2: 运行 RED**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`

Expected: 新测试在旧实现上失败，因为首次 `useEffect` 调用 `closeManagedMenu()` 并使菜单缺失；现有测试不应成为失败原因。

### Task 2: 实现最小 UID 变化保护

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx:93-101`

- [x] **Step 1: 增加挂载时 UID ref**

在局部折叠和选择状态旁添加 `const previousUidRef = useRef(uid)`。不增加全局 store、不改菜单 state 类型。

- [x] **Step 2: 只在 UID 真正变化时关闭菜单**

将无条件 effect 替换为：

```tsx
useEffect(() => {
  if (previousUidRef.current === uid) return
  previousUidRef.current = uid
  closeManagedMenu()
}, [closeManagedMenu, uid])
```

这样首次 mount 退出，后续真正 UID 变化会关闭共享 Portal。工作夹折叠继续由 `toggleGroup` 中现有的 `closeManagedMenu()` 处理。

- [x] **Step 3: 运行 GREEN**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`

Expected: 所有导航契约测试通过，新测试同时证明首次点击保留和 UID 切换关闭。

### Task 3: 更新产品书和审计记录

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-16-managed-menu-initialization-race.md`

- [x] **Step 1: 更正历史基线表述**

将项目书中的 `8baa0c11` 和“当前 7 项失败”改为历史基线事实，说明后续 `main` 已修复该七项；把本轮菜单竞态列为当前独立修复，只有完整 `npm test` 全绿后才标记自动验证。

- [x] **Step 2: 回填按项证据**

记录代码位置、定向测试、完整测试、仍需的 Electron 验收和无 B 站副作用边界。不得把测试通过泛化为 B 站或 Electron 实机验收。

### Task 4: 完整验证、提交和快进合并

**Files:**

- Modify: 仅 Task 1-3 中列出的文件。

- [x] **Step 1: 完整测试**

Run: `npm test`

Expected: 测试文件与断言均为 0 失败；本轮开始前在全量套件中偶发的“找不到删除菜单项”不得再出现。

- [x] **Step 2: Git 完整性检查**

Run: `git status --short && git diff --stat && git diff --check`

Expected: 只有代码、测试、项目书和本轮/既有项目书主题账本文档；不得出现根目录 `overview-recommendation-projection` 文件。

- [ ] **Step 3: 本地提交和合并**

在 `codex/project-book` 仅暂存本轮代码/测试/账本文档与三个项目书文档后创建单次提交；根目录 `main` 保留其不相关未跟踪文件，用 `git merge --ff-only codex/project-book` 合并。合并后再次运行 `git diff --check` 和 `npm test`。
