# 重启后采用标签失败回传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复多批草稿重启后“采用当前标签”误报分段不可用，并让已持久化的采用失败快照返回确认界面，避免要求用户重新整理。

**Architecture:** 分段描述符是完整本轮范围的唯一来源；重算逐批从持久化分段文件加载项目，不依赖重启后只含当前批的内存工作区。采用命令若在主进程已写入失败状态，IPC 返回新快照，渲染器沿用既有快照投影显示真实阻塞原因。

**Tech Stack:** Electron 主进程 TypeScript、React、Vitest。

---

### Task 1: 锁定重启后的多批重算范围

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] **Step 1: 写红灯测试。** 在现有“完整标签截止版本重启恢复”用例旁新增两批测试：用 `segmentSize: () => 500` 建立 501 条项目、配置 `classifyCurrentItems`、完成扫描后重启协调器并调用`acceptCurrentTags`。断言采用完成、不抛`segment is unavailable`、两个分段均进入采用后的完整分类范围。

- [x] **Step 2: 运行红灯。** 已运行目标用例；新用例因第二批未出现在重启后的`workspace.segments`而失败，错误为`Old favorite workspace segment is unavailable.`。

- [x] **Step 3: 最小实现。** 在`autoClassifySegmentsUnsafe`用`segmentDescriptors`（回退到未重启时的`workspace.segments`）查找每个待重算分段；每个分段仍通过`workspaceStore.loadSegment`读取，分类 journal 记录该描述符 ID。缺少描述符才报告无效分段，不能改变当前批选择、人工分类、推荐、保存或同步逻辑。

- [x] **Step 4: 运行绿灯。** 目标用例和完整协调器测试文件均通过。

### Task 2: 锁定已持久化采用失败的 IPC 快照回传

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`

- [x] **Step 1: 写红灯测试。** 构造“本次采用失败已持久化”标记的`acceptCurrentTags`拒绝、`getSnapshot`返回同账户且含`tagAdoption: { status: 'failed', failureCode: 'classification-recompute-failed' }`的协调器；调用`accept-current-tags`命令，断言 IPC resolve 到该快照。另构造旧失败快照加本次普通存储异常，断言 IPC 仍拒绝该新异常且不在异常后再次读取旧快照。

- [x] **Step 2: 运行红灯。** 已运行目标用例；当前 IPC 直接传播采用异常，符合预期失败。

- [x] **Step 3: 最小实现。** 协调器只在本次采用失败状态成功持久化后随原错误附加私有标记；`accept-current-tags` IPC 只识别该标记后再次读取`getSnapshot(accountMid)`，并在快照为非恢复状态且`tagAdoption.status === 'failed'`时返回该快照，否则保留原异常。不得吞掉未持久化或无关错误、不得显示内部`failureDetail`、不得发起任何写入命令。

- [x] **Step 4: 运行绿灯。** 目标用例和完整 IPC 测试文件均通过。

### Task 3: 回读契约、回归和提交

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-17-tag-adoption-ui-stale.md`
- Create: `docs/superpowers/plans/2026-08-18-tag-adoption-restart-failure.md`

- [x] **Step 1: 回读 R001/R002。** 项目书已写明持久化完整分段、失败快照回传、用户可读失败文案、保留草稿与“已分类/未扫描”独立语义；账本已补记实际代码位置、测试名称和结果。

- [x] **Step 2: 执行验证。** 最终运行相关主进程/IPC 测试（345/345）、确认区组件测试（37/37）和`npm run build`，均退出码 0；提交前再运行`git diff --check`。不对真实账号执行采用、保存、同步、重扫或重新整理。

- [x] **Step 3: 单次本地提交。** 验证通过且仅包含本轮 7 个文件后，已创建本地 `main` 提交`978b15f7 fix: recover tag adoption after restart`；未执行 merge、push、rebase 或真实账号操作。
