# 远端收藏夹检测提示：去重与可操作详情实施计划

> 范围：2026-09-09 的 `remote-detection-notice-dedup-and-immediate-dialog` 需求账本。
>
> 工作树：本地 `main`；允许修改本计划、对应需求账本、收藏夹面板组件和其测试。不得修改既有未提交的其他主题文档，也不修改 B 站远端数据。

## 需求核对

### 已确认

1. `I001`（`R001`）：右侧“小咪收藏库”收藏夹区域只保留上方远端检测提示，移除下方“部分 Bilimi 收藏夹尚未备册。”重复提示。
2. `I002`（`R001`、`R003`、`R005`、`R006`、`R007`、`R008`）：手动 B 站 `create` / `rename` 成功后的既有只读检测，需将两类结果合并显示在上方同一提示中；展开后两类项目分别可点击，打开各自既有弹窗；改名检测不自动弹窗；备册弹窗打开时不增设队列或额外点击逻辑。
3. `I003`（`R004`）：本计划和需求账本属于本轮 Git 跟踪内容，最终仅与本主题改动一起提交。

### 待用户决定

无。

### 被明确替代／明确不做

无。

## 实施批次

### 1. 建立红灯测试

- 覆盖：`I001`、`I002`。
- 可修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`。
- 用例：
  - 在 `missingLedgerIds` 非空且存在远端检测结果时，仍只显示上方汇总，且不显示下方重复文案。
  - 展开详情后，疑似收藏夹与已绑定改名各是可访问的按钮；点击疑似项只打开“发现疑似 bilimi 收藏夹”，点击改名项只打开“确认修改 B 站收藏夹名称”。
  - 仅打开这些弹窗不得调用 `onSaveLedgers` 或 `onSyncLedgers`；点击改名提示不得自动打开弹窗。
- 回归风险：测试不能混淆“打开弹窗”和“在弹窗内确认副作用”。
- 验收：运行该测试文件，确认变更前因无按钮和重复文案预期而失败。

### 2. 最小组件实现

- 覆盖：`I001`、`I002`。
- 可修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`；如现有按钮样式不足以保持文本可读，再最小增补 `src/renderer/src/styles.css`。
- 数据与 UI：保留既有顶部汇总和“查看详情/收起”；将每个详情由静态段落改为按钮。疑似项调用既有 `showRemoteObservationDialog('save', [observation], [])`；改名项将对应逻辑收藏夹的完整候选写入既有 `boundRenameCandidates` 状态，并清除错误。删除下方 `missingLedgerIds` 重复告警。
- 副作用边界：渲染、展开和点击只更新本地 React 状态；不新建远端写入路径，不修改 `App.tsx` 的已存在的手动 mutation 只读检测，不改变备册预检/确认链路。
- 回归风险：复用的疑似收藏夹弹窗必须维持保存后不自动备册的 `save` 模式；改名弹窗必须保留精确 remote ID 的既有确认数据。
- 验收：定向测试转绿；既有备册发现及改名确认测试仍通过。

### 3. 验证、界面检查与提交

- 覆盖：`I001`、`I002`、`I003`。
- 可修改：需求账本索引中的实施证据与状态。
- 自动验证：定向 Vitest，相关 App/收藏夹回归测试，`npm run build`，以及可行时完整 `npm test`。
- 界面验收：在 Electron 开发版仅检查右侧收藏夹区域的单一提示、展开和两个弹窗入口；不确认任何远端操作。截图和输出存入 `.codex-artifacts/`。
- 提交前：重新通读账本原文区与索引；执行 `git status --short`、`git diff --stat`、`git diff --check`；只暂存本计划、当前账本和本主题代码/测试，随后本地提交，不 push。

### 4. 修复全量测试阻断项

- 覆盖：`I004`（`R009`、`R011`、`R012`）。
- 可修改：`electron/main/oldFavoriteWorkspaceCoordinator.test.ts`、`src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`、`src/renderer/src/features/favorites/FavoriteLibraryDrawer.integration.test.tsx`、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`，以及本计划和需求账本的验证记录。
- 根因：零匹配参与规则的归档预览不应生成推荐候选；`886770ba` 已把备册后的完整发现刷新切换为 `readRemoteFavoriteDiscovery`；抽屉第二条提示计数是既有 UI 行为。三者均为过期或相互矛盾的测试预期，不改产品逻辑。完整套件在高负载下另有两个编辑菜单用例偶发在 portal 提交前查询菜单项；用例须先确认触发器的 `aria-expanded=true`，再查询可操作菜单项。
- 回归风险：不得为了测试转绿回退完整远端发现、隐藏抽屉的第二提示计数，或虚构零匹配推荐项；不得以测试稳定化改变菜单、编辑入口或 B 站副作用。
- 验收：先运行三个定向测试文件、编辑菜单定向测试和完整 `FavoriteLibraryApp` 测试文件，再运行完整 `npm test` 和 `npm run build`；仅在所有检查通过后，重新核对账本并暂存本轮范围的文件进行本地提交。

## 验证结果

- `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "zero-match saved ledger"`：1/1 通过。
- `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.ts -t "stale favorite status|duplicate status refresh"`：2/2 通过。
- `npm test -- src/renderer/src/features/favorites/FavoriteLibraryDrawer.integration.test.tsx -t "highest-priority reconciliation"`：1/1 通过。
- `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`：154/154 通过。
- `npm test -- src/renderer/src/App.test.tsx`：179/179 通过。
- 完整 `npm test`：251 个测试文件、4542/4542 通过。
- `npm run build`：通过。
