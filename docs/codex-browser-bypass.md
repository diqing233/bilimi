# Codex 浏览器闪退绕过方案

## 背景

在本机调用 Codex 的 in-app browser/browser 插件做页面检查时，Codex 可能直接闪退。这个问题属于验收工具自身的不稳定，不应阻塞 bilimi 的功能开发和发布前验收。

## 默认规则

- 除非明确要排查 Codex 浏览器闪退，否则不要调用 Codex 的 in-app browser/browser 插件。
- UI、页面、发布或视觉验收优先使用应用自身窗口、外部浏览器、命令行截图、测试脚本或人工核验。
- 验收结论必须说明实际使用的形态和工具，例如 `npm run dev` 的 Electron 窗口、`npm run preview` 的 Electron 窗口、安装后的 Windows 应用、PowerShell 截图、外部 Playwright 等。
- 如果某项验收因为绕过 Codex 浏览器而不能自动完成，需要记录为人工验收项，不要把它误写成自动化已通过。

## 推荐验收方式

1. 开发版：运行 `npm run dev`，在 Electron 应用窗口中完成关键路径检查。
2. 生产预览版：先运行 `npm run build`，再运行 `npm run preview`，在 Electron 应用窗口中重复关键路径。
3. 用户安装版：运行 `npm run dist:win` 后安装 `dist/` 中的 Windows 安装包，用安装后的应用完成关键路径。
4. 需要静态确认时，优先用 `npm test`、`npm run build`、文件检查和样式测试覆盖可自动验证的部分。
5. 需要截图时，使用系统截图、外部浏览器或独立 Playwright 流程，不使用 Codex in-app browser。

## 什么时候才排查 Codex 浏览器

只有在明确目标是修复或诊断 Codex 浏览器闪退时，才重新触发相关能力。排查前先收集 Windows 事件查看器、Codex 日志、崩溃转储和最小复现步骤，避免在正常功能验收中反复触发闪退。
