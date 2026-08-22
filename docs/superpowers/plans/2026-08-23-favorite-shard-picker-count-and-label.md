# 收藏库物理分册选择器文案与统计 Implementation Plan

> **For agentic workers:** Use the existing TDD and verification skills. Steps use checkbox syntax.

**Goal:** 为物理分册选择器提供准确本地成员数、短触发器和完整展开菜单。

**Architecture:** 主进程摘要在不改变持久化模型的前提下，为每个物理分册投影当前本地成员数；渲染器以可访问的独立触发器/listbox 替代无法分离文案的原生 select。选择回调复用现有本地分页查询。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest。

---

### Task 1: RED — 摘要本地分册计数

**Files:**

- Modify: `electron/main/favoriteRepositoryService.test.ts`

- [ ] 写测试：远端 `remoteMemberCount: 0` 时，两个物理分册分别返回真实本地成员数，不把远端观察数当作本地数。
- [ ] 运行该测试并确认因摘要缺少 `localMemberCount` 失败。

### Task 2: RED — 短触发器和完整菜单

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] 写测试：折叠按钮显示 `分册 2（1）`，展开菜单显示完整 `分册 2 · 音乐·2（1）`，选择后仍按 shardNumber 查询。
- [ ] 运行该测试并确认当前原生 select 无法提供分离触发器而失败。

### Task 3: GREEN — 最小实现

**Files:**

- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`

- [ ] 在摘要物理分册投影增加 `localMemberCount`，按当前视频行和回收状态过滤本地 membership。
- [ ] 实现可访问的短触发器/listbox，保留全部、键盘和外部关闭语义。
- [ ] 用短触发器和完整菜单文案替换原生 select，并保持现有查询回调。

### Task 4: GREEN/回归与证据

- [ ] 重跑摘要与 FavoriteLibraryApp 聚焦测试。
- [ ] 运行 `git diff --check`，只读 Electron 验收并保存截图。
- [ ] 更新本账本 I001/I002 的代码位置、测试和截图证据；不声称未验证的远端副作用已验证。
