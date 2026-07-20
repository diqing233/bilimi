# 整理旧藏受控核心验收记录

最后更新：2026-07-20

## 已自动验证

- 正式“整理旧藏”入口只使用 `old-favorite-workspace-v1` 受控快照与命令；生产构建不暴露旧 session、runtime、scan 或 workspace IPC/API。
- 扫描先落盘轻量工作区标记，概览保留普通收藏夹和数量为 0 的 Bilimi 工作夹；渲染层只读取当前分段。
- 工作区按账号隔离。扫描、来源选择、推荐、自动分类、DeepSeek 整批历史、人工调整及多步撤销/恢复可在重启后恢复。
- 默认增量轮保护已成功整理内容；显式“全部重新整理”清除保护并用新的扫描 lease 取代正在进行的增量扫描。扫描中断恢复后，用户可显式重新扫描以建立新 lease。
- 一次 B 站确认会冻结跨分段去重、容量规划和物理分卷绑定后的计划；执行使用检查点，未知结果必须经受控页面绑定和对账后继续。
- 主进程完整路径回归覆盖：扫描、来源选择、推荐、自动分类、DeepSeek、人工调整、撤销/恢复、重启、冻结执行、完成及受保护的下一轮增量扫描。

## 自动化命令

```powershell
npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "keeps one remote organization round coherent"
npm test
npm run build
git diff --check
```

## 尚需人工验收

真实 B 站页面和 Windows 安装包不能由 mock 回归替代。准备打包或发布时，必须按 `docs/release-checklist.md` 在 dev、preview 和已安装 Windows 包中分别完成：登录后的扫描、来源/推荐/预览调整、一次 B 站同步、结果未知对账、切页恢复、重启恢复与收藏库窗口检查。

没有实际开始发布时，不运行 `npm run dist:win`，也不把开发构建结果当作安装包验收。
