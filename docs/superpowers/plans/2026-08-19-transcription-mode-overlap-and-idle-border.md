# 札记模式控件遮挡与静止边框修复计划

**需求覆盖：** 需求账本 `R008`、`R009`，索引 `I004`。

**范围：** 只调整札记“转写音频”卡片的模式小项 CSS，并在既有样式测试中锁定布局契约。不修改批阅按钮、模式状态、分 P 读取、多 P 弹窗、队列、档案或 B 站操作。

1. [x] 在 `src/renderer/src/styles.test.ts` 先新增失败断言：模式小项使用能覆盖通用`.video-notes button`规则的具体选择器，静止边框/背景透明，主卡标题和说明为模式区预留右侧空间。
2. [x] 运行 `npm test -- src/renderer/src/styles.test.ts`，确认测试因现有通用按钮规则优先级和未预留文字区而失败。
3. [x] 在 `src/renderer/src/styles.css` 以最小改动修复具体选择器优先级，并仅给第一个转写主卡的标题/说明增加右侧预留。
4. [x] 运行聚焦样式和札记组件测试；在 Electron 开发版检查静止、悬停和焦点状态，以及长说明文字无覆盖。
5. [x] 回填账本验收证据，执行 `git diff --check`、相关测试和构建；仅提交本轮项目书、账本、计划、样式和样式测试。

验收记录：先新增断言并确认 `styles.test.ts` 因选择器优先级及文字未预留而红灯；CSS 修复后，`npm test -- src/renderer/src/styles.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx` 为117项通过，`npm run build`通过。Electron 开发版在现有多 P 视频页验证：静止无边框、悬停/点击仅当前项显示细边框且无阴影/位移、恢复默认单 P 后长说明在模式区左侧换行，未覆盖；批阅控件和转写主卡行为未改。
