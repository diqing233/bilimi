# 整理旧藏受控核心验收记录

最后更新：2026-08-05

## 已自动验证

- 正式“整理旧藏”入口只使用 `old-favorite-workspace-v1` 受控快照与命令；生产构建不暴露旧 session、runtime、scan 或 workspace IPC/API。
- 扫描先落盘轻量工作区标记，概览保留普通收藏夹和数量为 0 的 Bilimi 工作夹；渲染层只读取当前分段。
- 工作区按账号隔离。扫描、来源选择、推荐、自动分类、DeepSeek 整批历史、人工调整及多步撤销/恢复可在重启后恢复。
- 默认增量轮保护已成功整理内容；显式“全部重新整理”清除保护并用新的扫描 lease 取代正在进行的增量扫描。扫描中断恢复后，用户可显式重新扫描以建立新 lease。
- 一次 B 站确认会冻结跨分段去重、容量规划和物理分卷绑定后的计划；执行使用检查点，未知结果必须经受控页面绑定和对账后继续。
- 收藏库中“仅从本地删除”不写入 B 站；删除 Bilimi 逻辑工作夹时会持久忽略已绑定的远程 ID 以及待对账分卷的所有 `knownRemoteFolderIds`，防止下次账号打开时恢复投影将工作夹重建。
- 主进程完整路径回归覆盖：扫描、来源选择、推荐、自动分类、DeepSeek、人工调整、撤销/恢复、重启、冻结执行、完成及受保护的下一轮增量扫描。面板回归另覆盖扫描入口和预览阶段各控件仅发送受控命令。
- 收藏生命周期迁移会保留完整扫描的权威状态与 observation epoch，但不会导出设备绑定的远端实体 ID；旧快照仍可兼容导入，导入预览不触发远端动作。
- 普通 B 站收藏夹支持复制、刷新、重新整理、札记/档案和仅本地删除；仍禁止移动普通来源、修改普通远端收藏关系或删除普通远端收藏夹。
- 回收、仅本地删除和工作夹删除不会级联删除札记历史版本、转写、备注、星标或外部档案。

## 自动化命令

```powershell
node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "keeps one remote organization round coherent"
node_modules\.bin\vitest.cmd run --maxWorkers=2 --exclude scripts/packaging-config.test.mjs
node_modules\.bin\tsc.cmd --noEmit --pretty false
git diff --check
```

2026-08-05 本地集成验证：除 `scripts/packaging-config.test.mjs` 外，215 个测试文件、3263 项测试全部通过。完整运行仍有 67 条既有 React `act(...)` 警告和 1 条 `music` 重复测试夹具 key 警告，没有未处理测试错误。安装配置测试仍因当前 `package.json` 没有 `scripts`/`build` 而不能作为本轮通过项；本轮不恢复 `package.json`、不打包。`tsc` 仍有 216 条历史基线诊断，与保存基线按去除行列号的错误签名比较，新增和缺失均为 0。

## 面板完整流程回归

`ControlledFavoriteLedgerPanel.test.tsx` 覆盖受控面板从入口到完成的状态与命令边界：扫描和来源选择、推荐、自动分类、DeepSeek、人工调整、撤销/恢复、分段切换、一次 B 站确认、执行、对账、完成态与下一轮受保护的增量扫描。测试只断言 `old-favorite-workspace-v1` 快照和受控命令；收藏库入口仍独立打开三栏窗口，不能改写向导工作区。

关键回归命令：

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteLegacyBoundary.test.ts
```

## 尚需人工验收

真实 B 站页面和 Windows 安装包不能由 mock 回归替代。2026-08-05 的开发版无写入验收覆盖四个助手页签互斥、收藏库普通来源操作入口、详情展开/收起列数、迁移页面、侧栏缩放恢复和窗口最小化恢复；没有触发真实扫描、备册、删除、同步或 DeepSeek。准备打包或发布时，仍必须按 `docs/release-checklist.md` 在 dev、preview 和已安装 Windows 包中分别完成：登录后的扫描、来源/推荐/预览调整、一次 B 站同步、结果未知对账、切页恢复、重启恢复与收藏库窗口检查。

没有实际开始发布时，不运行 `npm run dist:win`，也不把开发构建结果当作安装包验收。
