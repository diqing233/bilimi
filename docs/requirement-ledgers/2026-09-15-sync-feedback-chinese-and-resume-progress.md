# 2026-09-15 同步提示中文化与恢复进度：需求账本

> 用户已在 R002 明确说“开始”。本文件保存本轮讨论原文与实施证据。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-06672f0d-6780-4fdb-8a06-5fa759472650.png`

截图目标区域：应用右侧“掌库 > 整理收藏 > 确认执行”卡片中的黄色错误提示区域。截图中的提示原文为：`Error invoking remote method 'old-favorite-workspace-v1:bilibili execution preflight': Error: Favorite repository remote folder inventory is unavailable.`。

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-94f9004e-615b-4c91-a27e-6f24f31704c4.png`

截图目标区域：应用右侧“掌库 > 整理收藏 > 确认执行”卡片。用户说明在中途停止后点击继续恢复，画面仍停留在此确认执行界面，没有同步进度条，但实际同步仍在进行。

用户原文：

```text
没网的时候点击同步，提示图一，检查下整个项目还有哪些英文提示，全部改成中文
图二中途停止点继续恢复，画面一直卡在这里没有进度条，但实际仍在同步中
```

### R002（2026-09-15）

用户原文：

```text
开始
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 断网点击同步时，不向用户暴露 Electron IPC 包装和英文底层错误；全项目其余用户可见英文提示也全部改为中文。 | 整理收藏确认执行错误卡片及全项目产品界面、弹窗、错误反馈。 | 所有 bilimi 自己渲染的成功、失败、空态、加载、按钮、辅助提示均不应显示英文技术文案；日志、源代码标识、开发者调试信息和 B 站网页正文不在本项范围内。 | 错误需按根因显示可执行中文提示；未知错误也应有安全的中文兜底。 | 不改变远端请求、同步、绑定、删除、文件或本地数据行为。 | 不翻译 B 站网页内容、模型名、品牌/API 专名或仅用于测试/开发的字符串，除非其会显示给用户。 | IPC 错误映射、各功能域反馈层、模态框/Toast/状态卡片。 | 已实施待真实界面验收 | 根因已确认：`ControlledFavoriteLedgerPanel.tsx` 的 B 站执行前置核验 `catch` 直接将 IPC 原始 `error.message` 写入确认执行卡片，绕过 `useOldFavoriteWorkspace.ts` 的中文 `executionFailureMessage`。实际实现：新增 `userVisibleErrorMessage.ts`，去除 Electron IPC 包装，映射收藏夹目录、网络、HTML/登录页等已知错误；未知英文一律使用调用方中文兜底。已接入确认同步、收藏工作区、悬浮助手、转写模型、B 站加载、札记、批量导出、收藏 API 脚本和 preload 运行时兜底等用户出口。`ControlledFavoriteLedgerPanel.test.tsx` 覆盖断网预检 IPC 错误仅显示“无法读取 B 站收藏夹列表，请检查网络并保持已登录的 B 站页面打开后重试。”且不含 `Error invoking remote method`；`userVisibleErrorMessage.test.ts` 覆盖网络、HTML、中文业务消息与未知英文兜底。2026-09-15 当前验证：`npm test` 为 261 文件、4731 用例通过；`npm run build` 退出码 0。开发版、预览版 Electron 均成功启动；当前桌面自动化通道因认证错误无法取得应用窗口，尚待真实断网界面复验。 |
| I002 | R001 | 中途停止后点击继续恢复时，如果同步实际已继续，界面必须立即进入同步中的正确状态并显示进度条，不得停在确认执行页。 | 整理收藏确认执行视图、恢复/继续同步命令、同步运行状态与进度发布链路。 | 恢复后的工作区若为 `executing`，立即显示“正在同步到 B 站”及已完成/总数进度条；暂停、完成、失败、待核对各自显示真实状态。 | 恢复草稿后按刚读取的真实 snapshot 选择向导页；后台同步进度沿现有工作区 snapshot 更新，不重复发起同步。 | 不新增 B 站写入、不重复执行已完成项、不改变暂停/恢复语义。 | 不用定时盲轮询掩盖状态断点；不能只做视觉假进度。 | IPC 命令返回、主进程同步服务、工作区 snapshot、渲染端 hook 与确认执行组件。 | 已实施待真实界面验收 | 根因已确认：`ControlledFavoriteLedgerPanel.tsx` 在 `selectRecoveryDecision('merge-latest')` 完成并读到恢复快照后，无条件 `setStep('scan')`。`OldFavoriteGuide.tsx` 因步骤优先级继续渲染扫描概览，即便 snapshot 已是 `executing`，从而把现有 `OldFavoriteConfirmationStep.tsx` 的同步进度分支挡在外面。实际实现：新增 `guideStepForRecoveredSnapshot()`；`scanning` 与可编辑的 `previewing` 维持原有扫描概览入口，`frozen`、`executing`、`reconciling`、`completed` 进入确认执行。没有新建远端读取、同步调用、定时器或 B 站写入，进度仍使用既有活动工作区 snapshot。`ControlledFavoriteLedgerPanel.test.tsx` 用恢复后的 `executing` 快照验证当前步骤为“确认执行”，进度条名称为“正在同步到 B 站”，数值为 1/3，并由全量测试覆盖。开发版、预览版 Electron 均成功启动；由于桌面自动化通道认证错误，尚待用户在真实暂停/恢复场景复验。 |
| I003 | R002 | 本轮实施授权。 | 本轮需求账本、计划、代码、测试和本地提交。 | 用户已明确说“开始”后生效。 | 允许仅对 I001、I002 范围实施。 | 不授权 push、发布、打包或远端数据操作。 | 不扩大本轮产品需求。 | I001、I002。 | 已实施 | 用户已在 R002 明确实施授权；本轮未执行 B 站同步、删除、push、发布或打包。 |
