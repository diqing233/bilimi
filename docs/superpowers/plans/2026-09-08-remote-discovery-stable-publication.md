# 远端发现提示稳定发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 远端观察草稿只在启动、显式备册和已确认的 B 站收藏夹变更后，经完整目录复核后一次性发布。

**Architecture:** 将规则状态核验与远端观察发现拆成同一目录读取的两个模式。常规快照、编辑、保存、勾选和整理只核验已有规则；三类获准事件显式打开发现模式。备册执行脚本不再提前返回或持久化远端草稿，备册收束后由同一完整复核通道提交唯一最终投影。

**Tech Stack:** Electron、React、TypeScript、Vitest。

---

### Task 1: 写出远端发现模式的失败测试

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 为非发现状态读取写失败测试**

调用 `buildFavoriteLedgerStatusScript([savedLedger], [], [], [], false)`，模拟目录含一个无本地规则的 `bilimi·远端夹`，断言结果不含对应 `custom-remote-*` 且 `remoteOnlyDraftLedgerIds` 为空。

- [x] **Step 2: 运行并确认失败**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "does not project an unknown remote folder during a status-only read"`

Expected: FAIL；当前状态脚本无论触发来源都会投影远端草稿。

- [x] **Step 3: 为备册中间结果不发布草稿写失败测试**

模拟备册脚本返回一个远端草稿、随后的完整状态复核不含该草稿，断言所有 `savePreferences` 参数与最终运行时返回均不含该草稿。

- [x] **Step 4: 运行并确认失败**

Run: `npm test -- src/renderer/src/App.test.tsx -t "publishes only the final remote-discovery projection after backup"`

Expected: FAIL；当前备册会先保存脚本返回的草稿、再做状态读取。

- [x] **Step 5: 为 B 站已确认变更触发发现写失败测试**

向收藏页 webview 发送已确认 `create` 信号，断言页面刷新之后状态脚本的 payload 含发现模式，并且最终才保存对应草稿。

- [x] **Step 6: 运行并确认失败**

Run: `npm test -- src/renderer/src/App.test.tsx -t "reconciles remote discovery after a confirmed favorite-space mutation"`

Expected: FAIL；当前确认信号只刷新 B 站页面、不做完整远端发现复核。

### Task 2: 给目录状态脚本增加显式发现模式

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: 实现最小模式参数**

给 `buildFavoriteLedgerStatusScript()` 增加最后一个 `includeRemoteOnlyDrafts` 参数；参数为 `false` 时仍读取完整 B 站目录并同步已保存规则状态，但跳过 `appendRemoteOnlyDrafts()`、返回空 `remoteOnlyDraftLedgerIds`。

- [x] **Step 2: 运行状态脚本测试**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: PASS。

### Task 3: 将 App 的发现触发限制为三类事件

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 实现单飞的完整发现复核**

扩展 `readFavoriteLedgerStatus()` 的 options 为 `includeRemoteOnlyDrafts`。只有该选项为真时才传给状态脚本；强制读取、完整复核、验证成功后才写入 React 状态和持久化规则。为每账号复用进行中的发现 Promise，避免一次 B 站变更重复发布。

- [x] **Step 2: 实现三类允许入口**

每账号启动后的第一次运行时快照请求、`saveFavoriteLedgers()` 备册完成收束、`handleFavoriteSpaceMutationConfirmed()` 的页面刷新后均使用 `includeRemoteOnlyDrafts: true`。其余读取保持默认 false。

- [x] **Step 3: 阻止备册原始脚本提前投影**

给 `buildSaveFavoriteLedgersScript()` 增加 `includeRemoteOnlyDrafts` 选项。App 的备册调用固定传 false，使中间备册返回不能写入或显示草稿；只以备册后的完整发现复核更新本地状态和返回结果。

- [x] **Step 4: 运行 App 定向测试**

Run: `npm test -- src/renderer/src/App.test.tsx -t "remote-discovery|confirmed favorite-space mutation|final remote-discovery projection"`

Expected: PASS。

### Task 4: 更新契约、回归并提交

**Files:**

- Modify: `docs/contracts/favorites.md`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-remote-draft-duplicate.md`
- Test: `src/renderer/src/App.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: 更新远端发现契约**

记录允许触发的三类入口、完整复核后单次发布、其余路径的只读状态核验，以及发现不产生 B 站写入的边界。

- [x] **Step 2: 运行定向回归与构建**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx`

Run: `npm run build`

Expected: 两条命令 exit 0。

- [x] **Step 3: 按账本回读并记录验收**

只记录 R003、R006 的实现文件、自动化证据和仍待 Electron 真实账号界面验收项；R001、R004、R005 保持未实施。

- [x] **Step 4: 完整性检查与提交**

Run: `git diff --check`

Run: `git status --short`

提交允许的代码、测试、契约、计划和本轮账本，提交说明：`fix: stabilize remote favorite discovery`。

### Review follow-up: 全量备册入口

- [x] 独立审查发现 `ensureFavoriteLedgersForAccount()` 没有关闭中间草稿投影，也没有在备册后执行最终发现复核。
- [x] 新增失败回归：全量`ensure-ledgers`的中间远端草稿不写入偏好、不经绑定注册、不作为运行时结果发布。
- [x] 全量备册脚本改为`includeRemoteOnlyDrafts: false`，只在持久化操作结果后走`readRemoteFavoriteDiscovery()`，再单次通知快照。
- [x] B 站成功信号的页面刷新返回`pending`或抛错时不读取远端目录；仅返回`idle`后才发起发现，避免发布旧页面目录。
