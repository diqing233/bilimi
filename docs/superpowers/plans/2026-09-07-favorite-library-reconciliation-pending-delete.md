# 收藏库远程待确认与详情删除修复实施计划

> **For agentic workers:** 本计划在当前分支内执行；所有步骤必须按需求账本 `docs/requirement-ledgers/2026-09-07-favorite-library-reconciliation-pending-delete.md` 逐项核对。

**目标：** 让收藏库详情页从 B 站 bilimi 收藏夹删除按真实远端成员事实收束，并消除重复待处理提示。

**架构：** 保留现有 managed-placement 删除、账号远端串行队列和收藏库 revision 模型。仅补齐结果未知后的精确物理分册成员回读、对账记录的 UI 暴露和回读成功后的本地投影刷新，不新增第二套删除事务。

**技术栈：** Electron 主进程、TypeScript、React、Vitest、Testing Library。

---

### 任务 1：项目书和账本基线

**文件：**
- 修改：`docs/项目功能项目书.md`
- 修改：`docs/requirement-ledgers/2026-09-07-favorite-library-reconciliation-pending-delete.md`
- 新建：本计划文件

- [x] 回读 `R001`、`R002`、`I001`、`I002`，保留“上一轮错误启动版本不改”和“不盲目重试未知远端操作”边界。
- [x] 在项目书中写明单一顶部入口、managed-placement 精确回读和三种结果收束。

### 任务 2：先写失败回归测试

**文件：**
- 修改：`electron/main/favoriteRepositoryBatchOperationService.test.ts`
- 修改：`electron/main/favoriteRepositoryService.test.ts`
- 修改：`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] 增加 managed-placement 结果未知后调用远端成员观察、确认已移除后记录成功并清理待处理的测试。
- [x] 增加远端仍存在时返回未删除/保留待处理的测试。
- [x] 增加收藏库标题栏只发布数量型同步待确认入口、不发布泛化远程入口的测试。
- [x] 新增回归测试已覆盖实现后的三态收束和单一入口；现有工作树已包含实现，未能回溯记录实现前红灯。

### 任务 3：实现主进程真实回读和收束

**文件：**
- 修改：`electron/main/favoriteRepositoryBatchOperationService.ts`
- 修改：`electron/main/index.ts`（如需注入真实受管分册观察器）

- [x] 为 managed-placement 对账复用现有页面桥接 `readMembers`，按操作记录的精确物理分册读取成员，不使用全局或名称猜测。
- [x] 远端已移除时写入成功记录、清除远端观察投影并返回 completed；仍存在时写入失败/未删除事实；读取未知时保留 reconciliation-required。
- [x] 保持普通来源、档案、转写、本地期望归属和未知结果边界不变。

### 任务 4：实现渲染器提示、对账入口和刷新

**文件：**
- 修改：`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] 移除重复的泛化“远程状态待确认/去待处理”提示，仅保留数量型同步待确认入口。
- [x] 对 managed-placement 待确认显示实际对账按钮或明确未删除结果，不能只导航到空待处理动作。
- [x] 删除确认、对账完成或失败后刷新同一账号摘要、当前页、选择和详情。

### 任务 5：验证与账本回填

**文件：**
- 修改：`docs/requirement-ledgers/2026-09-07-favorite-library-reconciliation-pending-delete.md`

- [x] 运行定向 Vitest、`npm test` 和 `npm run build`。服务 47/47、收藏库定向 313/313、App 集成 155/155、全量 249 文件 4468/4468、构建与 `git diff --check` 均已通过。
- [x] 运行 `git diff --check`，确认无无关文件和无未说明的用户数据改动。
- [x] 回填 I001/I002 的实际代码位置、自动化结果和未完成的真实 B 站界面验收条件。

### 任务 6：本地提交

- [x] 提交项目书、需求账本、计划、实现和测试为当前分支的一次本地 commit。（提交前最终差异核对完成。）
- [ ] 不合并、不推送、不修改本地 `main`。
