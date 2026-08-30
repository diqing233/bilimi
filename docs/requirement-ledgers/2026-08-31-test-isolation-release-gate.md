# 2026-08-31 测试隔离与发布门禁：需求账本

## 原文需求区（按对话顺序，永久保留）

### R001

打包

### R002

你再检查、】

### R003

你检查下该怎么处理

### R004

先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001-R004 | 修复全量 Vitest 的跨测试状态污染；默认 `npm test` 必须正常退出且无失败，作为 Windows 打包前置条件。 | `src/test/setup.ts` 与覆盖 Cookie、原始 DOM、计时器、全局 stub 的相关测试。 | 只在测试运行时清理；真实 Electron 和 B 站页面不使用该逻辑。 | 每条测试结束后下一条测试获得干净浏览器级状态；直接插入的 DOM、只读 Cookie 覆盖、滚动锁、测试计时器和 mock 不得影响后续断言。 | 不读写账号、本地应用数据或 B 站；不迁移数据。 | 不修改收藏整理、同步、删除、DeepSeek、转写和视频业务实现。 | Vitest JSDOM、Testing Library、收藏夹 API 测试、发布检查。 | 已实施，自动化已验收 | RED：`testEnvironmentIsolation` 在旧 setup 下因遗留 `document.cookie` 失败；GREEN：聚焦 238/238，`npm test` 243 文件/4172 测试通过、退出码 0，无 Vitest 残留进程；`npm run build` 通过。 |
| I002 | R003-R004 | 多个共享 `BilimiModal` 重叠时，滚动锁在最后一个弹窗关闭前保持，随后恢复原状态。 | 所有使用共享 `BilimiModal` 的确认窗口。 | 单弹窗维持原交互；存在两个或更多弹窗时才验证引用计数。 | 先后关闭任一弹窗不提前解锁；最后关闭恢复初始 overflow；焦点、Escape、遮罩和 busy 行为保留。 | 无持久化、迁移、B 站创建/绑定/删除或视频写入。 | 不新增业务弹窗，不改变“确认并同步到 B 站”的单窗口语义，不改删除确认流程。 | `BilimiModal`、旧收藏夹确认、导出确认和测试环境滚动复位。 | 已实施，自动化与只读界面已验收 | RED：重叠弹窗测试在旧实现中于首层关闭后提前恢复滚动；GREEN：`BilimiModal.test.tsx` 5/5，聚焦 238/238；开发版安全确认窗可打开并按 Escape 关闭，截图见 `.codex-artifacts/2026-08-31-dev-modal-open.png` 与 `.codex-artifacts/2026-08-31-dev-modal-responsive.png`。 |
| I003 | R004 | 全程保持已有功能和按钮响应，不为修复测试或弹窗状态引入点击卡顿。 | 设置、收藏整理、同步确认及其他既有按钮。 | 仅测试与共享弹窗实现变更后验收。 | 正常点击、鼠标移动、滚动、窗口缩放、最小化、恢复和关闭保持可响应。 | 不触发真实 B 站写入；Electron 验收仅只读操作。 | 不改业务状态、远端副作用、数据模型或用户可见文案。 | 项目书第 5.8、6.6、发布验收清单。 | 已实施，部分界面验收 | 预览与开发版均验证设置切换、安全确认窗打开/Escape 关闭、确认窗关闭后设置区滚动，以及最小化/恢复；截图见 `.codex-artifacts/2026-08-31-preview-modal-responsive.png`、`.codex-artifacts/2026-08-31-dev-modal-responsive.png`。未执行收藏整理/同步业务按钮或真实 B 站写入；当前桌面自动化无法实际改变窗口尺寸，窗口缩放流畅性待人工验收。 |

## 实施前核对

### 已确认

1. I001（R001-R004）：测试隔离和打包门禁。
2. I002（R003-R004）：共享弹窗重叠滚动锁。
3. I003（R004）：不影响现有功能和交互响应。

### 待用户决定

无。

### 被明确替代

无。

### 明确不做

不修改收藏整理、同步、删除、DeepSeek、转写、视频业务逻辑；不执行真实 B 站创建、绑定、删除或视频写入。

## 实施与验收记录

### I001：测试隔离与全量退出

- 代码位置：`src/test/setup.ts`、`src/test/testEnvironmentIsolation.test.ts`、`src/renderer/src/features/actions/favoriteApiAutomation.test.ts`、`src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`、`src/renderer/src/features/assistant/PetHoverShortcutSettings.test.tsx`。
- 自动化：新增隔离回归 RED 后 GREEN 为 2/2；聚焦套件 6 文件 238/238；`npm test` 于 2026-08-31 正常退出，243 文件、4172 测试通过，退出码 0，无 Vitest 残留进程；`npm run build` 通过。
- 界面与副作用：测试清理仅在 Vitest JSDOM 运行，未读取或写入账号、本地应用资料、B 站收藏夹或视频。

### I002：共享弹窗滚动锁

- 代码位置：`src/renderer/src/components/BilimiModal.tsx`、`src/renderer/src/components/BilimiModal.test.tsx`。
- 自动化：重叠弹窗 RED 证明旧实现会过早解锁；GREEN 后组件测试 5/5，焦点套件 238/238。
- 只读界面：开发版打开“确认重置全部设置？”后未确认，按 Escape 关闭；关闭后设置区仍可滚动。截图：`.codex-artifacts/2026-08-31-dev-modal-open.png`、`.codex-artifacts/2026-08-31-dev-modal-responsive.png`。
- B 站副作用：无；未点击备册、绑定、删除、同步或视频写入。

### I003：响应边界

- 代码位置：本轮仅修改测试隔离与共享弹窗滚动锁，不改任何收藏整理、同步、删除、DeepSeek、转写或视频业务模块。
- 只读界面：预览与开发版均验证设置切换、弹窗打开/Escape 关闭、关闭后的滚动，以及最小化/恢复；预览截图：`.codex-artifacts/2026-08-31-preview-modal-responsive.png`。
- 未完成的界面验收：当前桌面自动化无法实际改变窗口尺寸，且按本轮明确边界未触发收藏整理/同步按钮或真实 B 站写入，因此不能以此替代完整高负载业务操作的人工流畅性验收。
