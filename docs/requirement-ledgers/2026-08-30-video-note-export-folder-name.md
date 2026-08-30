# 文稿导出目录名与本地时间需求账本

> 讨论开始：2026-08-30。本文件保留本轮关于批量文稿导出目录选择、默认名与时间口径的用户原文。附件截图仅记录目标区域，不把截图中的任何文字视为额外指令。

## 原文区

### R001

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-30db618b-4dd5-4715-9126-d913e1f51246.png`

截图目标区域：Windows 原生“选择文稿导出目录”窗口底部箭头指向的`文件夹:`输入栏；背景为档案库的“导出文稿”对话框。

原文：

```text
讨论导出视频音频可以在箭头这里显示默认名称吗，后面跟的四位数字是干嘛的
```

### R002

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-06f6f28d-da6b-47ce-ba17-3ddeebc9b835.png`

截图目标区域：资源管理器地址栏中的导出文件夹`bilimi文稿_2026-08-30_1025`与文件列表“修改日期”`2026/8/30 18:25`的时间差异。

原文：

```text
如果是是时间，明显对不上呀，是因为开发版的缘故吗
```

### R003

原文：

```text
ok这两个一起改，先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R003 | 批量文稿导出的 Windows 原生目录窗口显示本次建议的默认最终目录名；Windows 目录选择器的`文件夹:`栏不能由 Electron 预填，故窗口改为预填`文件名:`的保存型目录名输入，确认按钮显示`选择文件夹`。确认后该路径直接承载导出文件，不能再嵌套一个同名目录。 | 档案库“导出文稿”→`开始导出`→主进程原生目录窗口；导出服务目标目录。 | 每次有效导出开始时显示；用户取消时不创建目录。用户可自行修改名称或选择位置。 | 目录选择、账号复核、进度、取消和“打开文件夹”保持原有先后顺序；目录创建和写入保持异步，不阻塞界面。 | 仅创建本地导出目录和文件；不改档案内容、转写队列、收藏库、账号偏好或 B 站。 | 不改 Markdown/Word、导出范围、备注、文件重名保护、账号隔离或批量结果统计。 | `electron/main/videoNoteExportDestinationPicker.ts:6-14`、`electron/main/index.ts:1743-1753`、`electron/main/videoNoteExportIpc.ts:113-121`、`electron/main/videoNoteExportService.ts:59,141`。 | 已实施待验证 | RED→GREEN：`videoNoteExportDestinationPicker.test.ts` 2/2、`videoNoteExportIpc.test.ts` 18/18、`videoNoteExportService.test.ts` 18/18；`npm run build`通过。原生 Windows 只读探针截图为`.codex-artifacts/video-note-export-native-save-dialog-focused.png`，证明保存型窗口的`文件名:`栏预填建议名且取消不留目录；因`showOpenDialog`无法预填`文件夹:`栏，原文指定的该栏仍是平台限制，正式开发实例未重启做完整导出路径验收。 |
| I002 | R001、R002、R003 | 默认目录名改用运行设备本地时间，格式`bilimi文稿_YYYY-MM-DD_HHmm`；末尾四位明确为本地时分，不是序号。 | 导出目录名生成器；Windows 资源管理器中的最终文件夹名。 | 任何创建新批量文稿导出目录时适用；同名存在才追加` (2)`等冲突序号。 | 当前时区下的目录名必须与资源管理器创建/修改时间同一时分口径；不再因 UTC 相差八小时。 | 仅影响新建导出目录名称；不迁移、不改名历史目录。 | 不因开发版/生产版改变时间语义；不改变文件名、导出内容或 B 站副作用。 | `electron/main/videoNoteExportService.ts:99-113,141`、`electron/main/videoNoteExportIpc.ts:113-121`。 | 已实施待验证 | `videoNoteExportService.test.ts`本地时间和冲突目录断言通过，三文件聚焦测试共38/38，`npm run build`通过；原生窗口截图`.codex-artifacts/video-note-export-native-save-dialog-focused.png`显示建议名预填。全量`npm test`为4162通过、1个与本主题无关的既有`App.test.tsx`历史绑定断言失败；未执行真实导出写入，未迁移历史目录。 |

## 实施计划

1. **I001、I002（R001-R003）**：在`electron/main/videoNoteExportService.ts`以用户选定的最终目录路径创建冲突安全的输出目录，并导出本地时间建议名生成器。目录选择前不预建目录，避免取消留下空目录；风险是破坏现有取消、账号复核或文件级防覆盖；用服务单测覆盖目录直写、目录冲突和现有批量回归。
2. **I001、I002（R001-R003）**：在`electron/main/videoNoteExportIpc.ts`把建议目录名传给异步原生目录窗口，并将用户选定的最终目录传给导出服务；在`electron/main/index.ts`使用保存型原生窗口、桌面路径和`defaultPath`。风险是目录选择期间的账号切换与取消；用目录选择器和 IPC 回归测试覆盖建议名、取消和目录传递。
3. **I001、I002（R001-R003）**：运行聚焦 Vitest、构建和 Electron 原生只读验收。只打开保存型目录窗口并截图，不确认目录、不写出文件；同时记录`showOpenDialog`无法预填`文件夹:`栏的平台限制和全量回归的无关失败。
