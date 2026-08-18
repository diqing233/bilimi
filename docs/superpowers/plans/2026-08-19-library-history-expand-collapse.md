# 收藏库分类调整记录展开折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让收藏库详情中的“查看完整记录”支持懒加载、展开、折叠和缓存复用。

**Architecture:** 继续使用现有详情级 React 状态和分类调整 IPC。按钮只负责切换展开状态或在没有缓存时触发首次读取；列表和分页按钮由展开状态控制，视频切换时沿用既有清理逻辑。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron 开发版。

---

### Task 1: 为展开/折叠契约补充失败测试

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` 分类调整记录测试

- [x] **Step 1: 扩展现有测试断言**

在 `shows the latest classification adjustment and loads older adjustments only after expansion` 测试中，初始按钮断言 `aria-expanded="false"`；首次点击后断言按钮名称为“收起完整记录”、`aria-expanded="true"`、列表可见；再次点击后断言按钮恢复“查看完整记录”、`aria-expanded="false"`，完整记录与“加载更早记录”隐藏，并断言 IPC 仍只调用一次。

- [x] **Step 2: 运行聚焦测试确认旧实现失败**

运行：`npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "shows the latest classification adjustment"`

预期：新增的折叠和重复请求断言失败，证明测试捕获当前缺陷。

### Task 2: 实现分类调整记录展开/折叠和缓存复用

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:1294-1325,2465-2468`

- [x] **Step 1: 添加详情级切换处理函数**

使用以下逻辑：展开状态为真时设置为假；已存在 `classificationAdjustments` 时只设置为真；没有缓存时调用现有 `loadClassificationAdjustments`。不改变加载函数的 IPC 参数、错误处理或分页追加逻辑。

```tsx
const toggleClassificationAdjustments = () => {
  if (classificationAdjustmentsOpen) {
    setClassificationAdjustmentsOpen(false)
    return
  }
  if (classificationAdjustments) {
    setClassificationAdjustmentsOpen(true)
    return
  }
  void loadClassificationAdjustments()
}
```

- [x] **Step 2: 更新按钮和条件渲染**

按钮使用 `onClick={toggleClassificationAdjustments}`、`aria-expanded={classificationAdjustmentsOpen}`，文案按状态显示“查看完整记录”或“收起完整记录”。完整列表和“加载更早记录”继续由 `classificationAdjustmentsOpen` 控制；加载成功仍设置展开状态。

- [x] **Step 3: 运行聚焦测试确认通过**

运行：`npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "shows the latest classification adjustment"`

预期：测试通过，且已有视频切换清理测试不回归。

### Task 3: 更新账本并完成验证

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-19-library-history-expand-collapse.md`
- Verify: `docs/项目功能项目书.md`, `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`, `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 回读账本并记录实现证据**

在 I001 的状态和验收证据中补入实际代码位置、聚焦测试结果、全量测试结果和开发版三态验收；无法验证的条件必须明确列出。

- [x] **Step 2: 运行项目验证**

依次运行：

```text
npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
npm test
npm run build
git diff --check
git status --short --branch
```

预期：聚焦测试、全量测试和构建成功；差异无空白错误；工作树只包含本轮项目书、账本、设计/计划、组件和测试文件。

- [x] **Step 3: 开发版界面验收**

启动 `npm run dev`，在收藏库打开一个有分类调整记录的视频：确认默认只显示最近调整；点击后显示完整列表且按钮变为“收起完整记录”；再次点击后列表和分页按钮隐藏；再次展开不重复调用读取；切换视频后恢复默认折叠。

- [x] **Step 4: 创建本地提交**

```text
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-19-library-history-expand-collapse.md docs/superpowers/specs/2026-08-19-library-history-expand-collapse-design.md docs/superpowers/plans/2026-08-19-library-history-expand-collapse.md src/renderer/src/features/favorites/FavoriteLibraryApp.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
git commit -m "fix: allow library history details to collapse"
```
