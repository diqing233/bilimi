# 收藏库反馈、备册与权威刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复收藏库的归属事实、备册闭环、批量同步结果和跨页面权威刷新，使 R001 指出的操作可用且不牺牲 Electron 交互响应。

**Architecture:** Electron 主进程继续是规则、物理分册、成员和 revision 的唯一事实来源；renderer 只把主进程快照投影为列表、详情和标题反馈。复用现有备册、移动、同步、删除和订阅接口，修复错误状态映射、错误的局部刷新分支和缺失的确认闭环，不增加平行状态机或新的 B站写入路径。

**Tech Stack:** Electron、TypeScript、React 19、Vitest、现有 `FavoriteRepositoryService`/IPC/收藏库抽屉。

---

## 文件边界

- `docs/项目功能项目书.md`：R001 的最终产品规则，先于代码更新。
- `docs/requirement-ledgers/2026-09-05-favorite-library-followup.md`：R001-R004 原文、索引、实施与验收证据。
- `src/renderer/src/features/favorites/favoriteLibraryModel.ts`：归属一致性文案，不能借同步状态输出二值文案。
- `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`：归属状态映射的回归。
- `electron/main/favoriteRepositoryIpc.ts` 及绑定/删除服务和对应测试：绑定状态变更必须发布会刷新受影响收藏库页面的 revision。
- `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`：统一反馈槽、当前/批量备册闭环、批量同步进度、动作后有界刷新及订阅收敛。
- `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`：用户可见反馈、备册、同步、移动、解绑投影回归。

### Task 1: 恢复归属状态的独立语义（I002）

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts:171-178`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [x] **Step 1: 写失败回归测试**

```ts
it.each([
  ['aligned', true, '位置一致'],
  ['local-only-change', true, '归属不一致'],
  ['failed', true, '归属不一致'],
  ['aligned', false, '尚未扫描B站归属']
])('formats %s ownership without reusing sync wording', (state, hasRemoteMapping, expected) => {
  expect(formatFavoriteLibraryPositionStatus(state, hasRemoteMapping)).toBe(expected)
})
```

- [x] **Step 2: 验证该测试在现状失败**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: `aligned` 仍输出 `已同步` 或不一致状态仍输出 `未同步`，测试失败。

- [x] **Step 3: 最小实现**

```ts
export function formatFavoriteLibraryPositionStatus(state: string | undefined, hasRemoteMapping = true) {
  if (!hasRemoteMapping) return '尚未扫描B站归属'
  return state === 'aligned' ? '位置一致' : '归属不一致'
}
```

同步标签继续由 `formatFavoriteLibraryMirrorStatus` 输出 `已同步`/`未同步`；不要恢复写入回执的第三种用户同步状态。

- [x] **Step 4: 验证通过**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: exit code 0。

### Task 2: 保证绑定/解绑 revision 让当前收藏库页失效（I004）

**Files:**

- Modify: `electron/main/favoriteRepositoryIpc.ts` 及实际发出绑定、解绑、删除后 revision 的服务文件（只限由测试定位的文件）
- Modify: 对应 `electron/main/*.test.ts`

- [x] **Step 1: 写失败回归测试**

测试一个当前逻辑工作夹已绑定、解绑/删除收束后发布 revision 的场景；订阅该工作夹必须收到 `pageInvalidated: true`，而不是只收到摘要更新。测试同时断言快照中该工作夹不再以 `bound` 表示。

- [x] **Step 2: 验证失败**

Run: `npm test -- electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteRepositoryBindingService.test.ts`

Expected: 现状仅摘要更新或断言不成立。

- [x] **Step 3: 最小实现**

让生成新 binding 状态的主进程命令按受影响逻辑工作夹和成员发布 `pageInvalidated: true`；不改变删除确认、B站请求或成员删除语义。

- [x] **Step 4: 验证通过**

Run: `npm test -- electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteRepositoryBindingService.test.ts`

Expected: exit code 0。

### Task 3: 收藏库 renderer 的统一反馈、备册和批量同步（I001、I003、I005）

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:695-700, 1156-1177, 1337-1383, 1663-1735, 2279-2661`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 写失败回归测试**

分别覆盖：

```tsx
expect(screen.getByTestId('favorite-library-workspace-feedback')).toHaveTextContent('同步排队中')
expect(screen.queryByText('同步完成：0/1，失败 1')).not.toBeInTheDocument()
expect(window.bilimiDesktop.ensureFavoriteLedger).toHaveBeenCalledWith('bilimi-logical:game', { lightweightBackup: true, confirmCreateAndBind: true })
expect(screen.getByRole('complementary', { name: '视频详情' })).toHaveTextContent('归属状态：位置一致')
```

另写选择一项后点击“同步到B站”、本地删除、远端删除的测试：各动作保留既有确认/禁用边界，并调用既有 IPC。

- [x] **Step 2: 验证失败**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: 现状把 `queued` 计为失败、反馈分散、未绑定当前备册只预览后返回，测试失败。

- [x] **Step 3: 最小实现**

1. 以一个轻量 `workspaceFeedback` 派生当前操作文案，在标题中部渲染唯一的 `data-testid="favorite-library-workspace-feedback"`；把同一操作的顶部错误条、批量结果和备册结果从原位置移除，不删弹窗内提示与行内转写状态。
2. 未正式绑定的当前备册先使用现有候选确认弹窗；无候选时从该弹窗调用既有 `{ lightweightBackup: true, confirmCreateAndBind: true }` 闭环，不上传视频、不清空成员。工作夹批量备册沿用同一确认与刷新。
3. 批量同步中 `queued` 显示“同步排队中”并保留待处理，不增加失败；只有 `failed` 计失败，`result-unknown` 显示待对账。每项命令完成后沿用帧调度后的 `refresh`，不在进度 setState 时扫描仓库或同步阻塞渲染。
4. 本地删除、远端删除和同步按钮沿用既有执行条件和服务；没有远端受管证据的删除按钮显示既有禁用原因。

- [x] **Step 4: 验证通过**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: exit code 0。

### Task 4: 操作后与订阅后的有界权威刷新（I004、I006）

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:1156-1177, 1317-1338, 2580-2593`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 写失败回归测试**

```tsx
notify?.({ revision: 2, pageInvalidated: false })
await screen.findByText('未备册')
expect(loadFavoriteRepositoryLibraryPage).toHaveBeenCalledTimes(2)

fireEvent.click(screen.getByRole('button', { name: '移动至' }))
await waitFor(() => expect(screen.queryByText('源工作夹中的视频标题')).not.toBeInTheDocument())
expect(screen.getByText('目标工作夹（1）')).toBeInTheDocument()
```

- [x] **Step 2: 验证失败**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: `pageInvalidated: false` 只替换摘要，当前范围仍保留旧投影或移动后的源列表不收敛。

- [x] **Step 3: 最小实现**

当订阅 revision 超过当前摘要且当前范围可能包含逻辑工作夹、绑定状态或成员变更时，调度一次 `refresh()`；保持 scheduler 合并同帧的多个通知。`runAction` 的移动、复制、本地删除、远端删除、绑定、备册和同步收束后只触发已有单次 `refresh(accountMid)`，并依据新页清理失效选择/详情。不得全量预取所有页、循环刷新或在鼠标事件中执行 IPC。

- [x] **Step 4: 验证通过**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: exit code 0。

### Task 5: 集成、性能和项目书/账本回填（I001-I006）

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-05-favorite-library-followup.md`
- Verify: `docs/项目功能项目书.md`

- [x] **Step 1: 静态质量检查**

Run: `git diff --check`

Expected: exit code 0。

- [ ] **Step 2: 聚焦与全量自动化**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/favoriteLibraryModel.test.ts electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteRepositoryBindingService.test.ts && npm test`

Expected: 全部 exit code 0。

- [x] **Step 3: 构建**

Run: `npm run build`

Expected: exit code 0。

- [ ] **Step 4: 开发版真实 Electron 验收**

启动开发版，逐项验收 R001 四张截图对应的统一反馈、位置一致性、三按钮、解绑投影、两处备册和移动收敛；在批量同步、备册和移动时持续移动鼠标、滚动、缩放、最小化、恢复和关闭。记录未能在真实账号安全复现的 B站写入/删除项，不将 mock 结果表述为真实成功。

- [ ] **Step 5: 账本回填并单次提交**

为 I001-I006 写入实际代码位置、自动化命令结果、真实界面证据和未验证条件。确认仅包含本轮文档和收藏库相关改动后，执行：

```powershell
git status --short
git diff --stat
git diff --check
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-05-favorite-library-followup.md electron/main src/renderer/src/features/favorites
git commit -m "fix: restore favorite library feedback and refresh flows"
```

Expected: 一个仅包含本轮范围的本地 `main` 提交；不推送、不打包、不合并其他分支。
