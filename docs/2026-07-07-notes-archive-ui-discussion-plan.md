# 札记与档案库交互整改讨论计划

> **For agentic workers:** 当前文档是讨论模式下的需求约束与实施计划草案。只有用户明确说出“开始”后，才能进入代码修改；实施时需继续使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务推进。

**Goal:** 统一札记文稿、档案库、归档预览和批阅动作区的状态保持、按钮反馈、进度条和结果切页体验。

**Architecture:** 把易丢失的 UI 状态从局部组件提升到外层状态或可复用状态模块；把重复的结果 tab、进度条和按钮内部设置抽成共享组件；保留现有 Electron + React + TypeScript 架构，不引入新的状态管理库。

**Tech Stack:** Electron + React 19 + TypeScript + Vitest + Testing Library；现有 `electron-store` 持久化；现有 DeepSeek IPC 与札记/档案库功能模块。

---

## 讨论模式约束

- 当前仍是讨论模式：不修改代码实现，不调整业务逻辑，不运行实现性重构。
- 本文档只沉淀已经讨论过的改动范围、设计约束、验收点和后续实施顺序。
- 用户明确说“开始”后，才可以准备改代码；准备实现前需要再次复述本计划，并确认是否有新增或删减项。
- 实施完成后按项目约束整体提交一次 git commit。
- 若后续涉及打包或发布 Windows 安装包，必须先按 `docs/release-checklist.md` 完成 dev、preview、安装包三种形态关键路径验收。

## 当前待改范围

### 1. 批阅动作按钮内嵌设置

**目标体验**

- 投币数量和评论候选数量放进对应动作按钮标题行右侧。
- 下拉控件点击只修改设置，不触发主按钮动作。
- 按钮结构示例：

```text
[小咪图标] 投币厚赏                         [一枚 ▾]
          一键三连，投币数量可在设置中调整

[小咪图标] 拟奏短评                         [随机 ▾]
          一键弹幕，发送方式可在设置中调整
```

**预计涉及文件**

- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- `src/renderer/src/styles.css`
- `src/renderer/src/styles.test.ts`

**验收点**

- 设置下拉与按钮标题同一行、右侧对齐。
- 点击下拉不会触发投币或评论主动作。
- 侧边栏窄宽度下不挤压标题，不产生文字重叠。

### 2. 进度条统一为 DeepSeek 辅助整理样式

**目标体验**

- 转写音频进度条、转写队列进度条、旧藏确认整理进度条统一为“文字状态 + 细进度轨道”。
- 样式参考 DeepSeek 辅助整理：浅蓝底、细轨道、填充条，运行中可有轻微流动感。
- 不再出现原生 `progress` 控件。

**预计涉及文件**

- `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- `src/renderer/src/styles.css`
- `src/renderer/src/styles.test.ts`

**验收点**

- 三处进度条视觉一致。
- 运行、完成、失败或空闲状态文字清楚。
- 进度区域不会改变相邻布局高度造成跳动。

### 3. DeepSeek 总结生成切页不中断

**目标体验**

- 札记点击“生成总结”后，切到其他区域再回来，仍显示生成中、完成或失败。
- 档案库视频详情里生成 DeepSeek 总结同样不能被切页打断。
- 有文稿但没有总结时，可以单独生成总结，不需要重新转写。

**预计涉及文件**

- `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- `src/renderer/src/features/notes/noteSummarizer.ts`
- `src/renderer/src/features/notes/noteSummarizer.test.ts`
- `src/renderer/src/features/state/assistantState.ts`
- `src/renderer/src/features/state/assistantState.test.ts`

**验收点**

- 切页不会取消正在进行的总结请求。
- 回到原页面能恢复对应视频的生成状态。
- 失败后可重试，成功后展示结果并保留。

### 4. disabled 按钮鼠标不转圈

**目标体验**

- 没开启 DeepSeek、无文稿、生成中不可点、复制不可用等状态下，按钮只灰掉。
- 鼠标悬浮 disabled 按钮时不显示 wait/loading 光标。

**预计涉及文件**

- `src/renderer/src/styles.css`
- `src/renderer/src/styles.test.ts`
- 涉及按钮的组件测试按实际选择补充。

**验收点**

- `.video-notes button:disabled` 等规则不再使用 `cursor: wait`。
- 真正执行中的可点击区域如有 loading 语义，仍通过文案或图标表达，不依赖鼠标光标。

### 5. 档案库详情顶部布局按设计收紧

**目标体验**

```text
标题                                                  […]
作者 · bvid · 转写次数
历史版本 [v1 · 时间 ▾] [★] [备注]
```

- 更多菜单按钮放标题行右侧，垂直居中。
- 标题与版本区域之间不留大片空白。
- 标题保持下划线，可点击打开来源。
- 更多菜单保留“打开视频来源”和“删除视频档案”。
- 删除当前版本是每个版本后的小删除按钮。

**预计涉及文件**

- `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- `src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts`
- `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- `src/renderer/src/styles.css`

**验收点**

- 标题、更多按钮、元信息和版本行在桌面与窄侧栏都对齐。
- 删除视频档案和删除当前版本入口不会混淆。
- 不出现顶部大片空白。

### 6. 札记和档案库共用可收起 result tabs

**目标体验**

- 三个按钮：无时间线文稿、带时间线文稿、DeepSeek 总结。
- 固定等宽、固定高度。
- 未选中为浅底蓝字，选中为深蓝底白字。
- 再次点击当前 tab 收起内容。
- 三个按钮优先一排，侧边栏窄时再换行。

**预计涉及文件**

- Create: `src/renderer/src/features/notes/VideoNoteResultTabs.tsx`
- Create: `src/renderer/src/features/notes/VideoNoteResultTabs.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

**验收点**

- 未点击和点击后的按钮尺寸一致。
- 当前 tab 再点可收起。
- 两个页面行为和视觉一致。

### 7. 档案库详情状态保留

**目标体验**

- 点击某个视频打开详情，切到别的区域后再回来，保留打开状态。
- 再次点击当前选中的视频，收起详情。
- 保留选中视频、版本、文稿 tab 状态。

**预计涉及文件**

- `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- `src/renderer/src/features/state/assistantState.ts`
- `src/renderer/src/features/state/assistantState.test.ts`

**验收点**

- `selectedArchiveId`、`selectedVersionId`、`activeResultTab` 不因组件卸载而丢失。
- 点击当前已选视频能折叠详情。
- 删除视频或版本后，状态能落到合理的相邻项或空状态。

### 8. 说明按钮缩小并居中

**目标体验**

- 收藏夹标题旁、整理旧藏标题旁说明按钮约 22-24px。
- 使用 `inline-grid` 或等价方式居中图标。
- `padding: 0`，和标题垂直居中，不抢标题视觉。

**预计涉及文件**

- `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- `src/renderer/src/styles.css`

**验收点**

- 箭头或说明图标居中包住。
- 标题行高度自然，不因按钮撑大。

### 9. 撤销/恢复拆成双按钮并支持多轮

**目标体验**

- 撤销和恢复拆成两个按钮。
- 支持多轮撤销/恢复。
- 无法操作时灰掉。
- 可保留类似 WPS 的下拉，允许跳到某次状态。
- 说明文案短且清楚。

**预计涉及文件**

- `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- `src/renderer/src/features/favorites/deepseekArchiveOrganizer.ts`
- `src/renderer/src/features/favorites/deepseekArchiveOrganizer.test.ts`
- `src/renderer/src/features/recommendation/archivePlanning.ts`
- `src/renderer/src/features/recommendation/archivePlanning.test.ts`

**验收点**

- 连续撤销与连续恢复顺序正确。
- 新操作发生后恢复栈按预期清空。
- disabled 状态明确，鼠标不转圈。

### 10. 已部分完成方向的回归保护

**需要保留的既有方向**

- 未匹配区域保留，数量为 0 时不消失。
- 未匹配区域不做蓝色选中条。
- 匹配卡片点击选中，选中蓝、未选白。
- 分类把握文案为“不太稳/比较稳”，数值只放悬浮。
- 标签尽量占满行，省略号和悬浮显示完整。
- 当前位置下拉在卡片底部。

**预计涉及文件**

- `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- `src/renderer/src/styles.css`
- `src/renderer/src/styles.test.ts`

**验收点**

- 新改动不破坏以上行为。
- 相关视觉与交互需要有测试或手动验收记录。

## 建议实施顺序

### Task 1: 状态提升与不中断任务

**覆盖项:** 第 3、7 项。

**原因:** 先处理状态生命周期，避免后续 tabs 和布局复用建立在会丢状态的局部状态上。

**测试重点**

- 札记 DeepSeek 总结切页不中断。
- 档案库 DeepSeek 总结切页不中断。
- 档案库选中视频、版本、结果 tab 切页后保留。

### Task 2: 共享结果 tabs 组件

**覆盖项:** 第 6 项，并衔接第 3、7 项。

**原因:** 两处结果区当前实现重复，先抽共用组件可以减少后续样式和行为分叉。

**测试重点**

- 三个 tab 固定尺寸。
- 当前 tab 二次点击收起。
- 札记与档案库使用同一行为。

### Task 3: 统一进度条与 disabled 光标

**覆盖项:** 第 2、4 项。

**原因:** 两者都是跨页面的反馈一致性问题，适合集中清理样式。

**测试重点**

- 不再渲染原生 `progress`。
- disabled 按钮没有 `cursor: wait`。
- 运行中文案和轨道状态正确。

### Task 4: 档案库详情头部布局

**覆盖项:** 第 5 项。

**原因:** 独立于状态层，但依赖第 7 项中保留的版本和选中状态。

**测试重点**

- 标题行更多按钮对齐。
- 元信息和版本行紧凑。
- 删除视频档案与删除版本入口清楚。

### Task 5: 批阅动作按钮与说明按钮

**覆盖项:** 第 1、8 项。

**原因:** 两者都是小控件布局精修，可一起处理侧边栏窄宽度适配。

**测试重点**

- 下拉点击不触发主动作。
- 小说明按钮尺寸与居中正确。
- 窄侧栏文字不重叠。

### Task 6: 撤销/恢复多轮机制

**覆盖项:** 第 9 项，并保护第 10 项。

**原因:** 这项可能牵涉归档预览状态栈，应单独实施和验证，避免和纯 UI 调整混在一起。

**测试重点**

- 撤销栈和恢复栈顺序正确。
- 新编辑后恢复栈清空。
- 相关已完成方向不回退。

## 实施前需要确认的问题

1. DeepSeek 总结生成状态只需要在本次应用运行期间保留，还是需要跨重启持久化到 store。
2. 撤销/恢复下拉是否第一版就做，还是先完成双按钮和多轮栈，下拉作为下一次迭代。
3. 批阅动作按钮右侧下拉在极窄侧栏时，是保持同一行压缩，还是允许换到标题下一行但仍留在按钮内部。

## 验收矩阵

- Unit: `npm test -- src/renderer/src/features/notes/VideoNoteResultTabs.test.tsx`
- Unit: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Unit: `npm test -- src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Unit: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Unit: `npm test -- src/renderer/src/features/state/assistantState.test.ts`
- Unit: `npm test -- src/renderer/src/styles.test.ts`
- Build: `npm run build`
- Manual dev check: 札记转写、总结生成切页、档案库详情切页、旧藏整理进度、批阅按钮设置下拉。
- Manual preview check: `npm run preview` 后重复关键路径。
- Release check: 只有准备 Windows 安装包或发布时，才执行 `docs/release-checklist.md` 的完整 dev、preview、安装包验收。

## 不在本轮范围

- 不调整 DeepSeek API 协议本身，除非状态提升必须补充请求标识。
- 不重做札记、档案库或旧藏整理的信息架构。
- 不新增第三方 UI 库或全局状态管理库。
- 不处理 Windows 安装包发布，除非用户后续明确要求打包或发布。
