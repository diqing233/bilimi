# 五项回归问题排查账本（2026-09-02）

## 原文需求

### R001

截图附件：
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-94783183-4b6a-4fc3-93af-bcbff2aff9a6.png`

图一箭头所指提示你没改吗
图二展开后，收起区域能扩展为当前提示完整行数吗，不止两行
图三备册情况还是没能正常显示
图四bug复现才做的修复，点击保存之后收藏夹消失，为什么，你又乱动？？
应用启动又卡了，上个版本还没卡
一共五个问题
<image name=[Image #1] path="C:/Users/diqing/AppData/Local/Temp/codex-clipboard-94783183-4b6a-4fc3-93af-bcbff2aff9a6.png">[截图内容待界面验收]</image>

截图附件：
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2ea961dd-6216-4873-b3c2-573eefdebcf3.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-bb7ad3ed-d9e9-4d02-ab61-4dba76d6b41c.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-82a55aff-63b4-405c-bae0-cd6c0414a81d.png`

<image name=[Image #2] path="C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2ea961dd-6216-4873-b3c2-573eefdebcf3.png">[截图内容待界面验收]</image>
<image name=[Image #3] path="C:/Users/diqing/AppData/Local/Temp/codex-clipboard-bb7ad3ed-d9e9-4d02-ab61-4dba76d6b41c.png">[截图内容待界面验收]</image>
<image name=[Image #4] path="C:/Users/diqing/AppData/Local/Temp/codex-clipboard-82a55aff-63b4-405c-bae0-cd6c0414a81d.png">[截图内容待界面验收]</image>

### R002

图三是删除未绑定后出现的情况，好像也是bug复现

### R003

你准备怎么改，3,4,5都是已经修好的回归了

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 图一箭头所指的提示必须按项目书和历史中文语义显示，不出现错误英文或底层 IPC 文案；只修显示映射，不改变错误码、失败状态和重试语义。 | 全局提示/助手状态灯及其错误反馈 | 发生远程调用或旧收藏工作区未启动错误时显示现有中文可读提示；正常状态保持原文案。 | 提示展开、收起、状态灯导航和任务点击继续响应。 | 纯渲染/文案映射，不写 B 站。 | 不改整理、备册、删除、同步业务。 | `FloatingAssistantApp.tsx:showTemporaryGlobalFeedback`、既有 `formatAssistantFeedbackMessage`。 | 已实施待验证 | `FloatingAssistantApp.test.ts`（1）、聚焦套件 489/489；真实 Electron 文案仍待界面验收。 |
| I002 | R001 | 图二展开后，收起区域应扩展为当前提示的完整行数，不限两行；第二行不保留省略号，续文完整显示后才进入后台任务和最近提示。 | `FloatingAssistantApp` 全局提示展开/收起区域 | 收起保持既有摘要外观；展开显示当前提示完整内容，按项目书顺序显示后续区域。 | 滚动条只从后台任务开始，提示任务与状态灯可点击。 | 不改提示历史持久化。 | 不新增“当前提示”标题或独立重复卡片。 | `styles.css:.floating-assistant-global-status__feedback[data-expanded="true"]`、续文 DOM 顺序。 | 已实施待验证 | `feedbackContinuation.test.ts`（7）、`styles.test.ts`（65）、聚焦套件 489/489；真实 Electron 展开滚动仍待界面验收。 |
| I003 | R001 | 图三备册情况必须按权威收藏夹状态正常显示，不能因整理/暂停/删除回归被错误隐藏或清空。 | 掌库收藏夹卡片与详情 | 未打开整理向导时显示真实已备册/未备册/未绑定；整理向导实际展开时仅按项目书隐藏卡片级远端状态，详情始终显示。 | 切换页签、展开收起、打开详情后立即收敛到权威快照。 | 只读本地权威状态，不执行远端副作用。 | 不改整理分类、推荐、统一同步、DeepSeek。 | `App.tsx:readFavoriteLedgerStatus/projectFavoriteLedgersToFormalBindings`、`FavoriteLedgerOverview.tsx:bindingLabelForLedger/statusLabelForLedger`。 | 已实施待验证 | 既有权威状态/详情回归用例 + I005 删除投影用例；真实开发版卡片/详情状态仍待界面验收。 |
| I004 | R001 | 图四复现：点击保存后收藏夹不应消失；保存后的规则、勾选和本地工作区投影必须保留并可继续操作。 | 掌库保存收藏夹、整理收藏投影 | 保存成功后卡片保留；仅真正未保存且无成员的临时草稿可不进入正式导航。 | 保存后卡片、详情和整理推荐使用同一稳定规则 ID，不误删或回收。 | 只写本地规则/草稿投影，不自动删除、备册或同步 B 站。 | 不改变已完成的删除模式和推荐草稿取消语义。 | `ControlledFavoriteLedgerPanel.tsx:awaitingPromotedRecommendationAcknowledgementRef`、保存回写清理 effect。 | 已实施待验证 | `ControlledFavoriteLedgerPanel.test.tsx`（171，含竞态保存回归）、聚焦套件 489/489；真实界面保存后投影仍待验收。 |
| I005 | R001、R002 | 删除未绑定后必须完成同一账号权威本地收尾并刷新页面；删除成功的目标移除，保留的默认/规则按真实状态显示`未备册`或`未绑定`，不能留下空白或旧状态。 | 掌库删除模式、收藏库、整理草稿、详情 | 只有远端删除确认成功或精确 ID 权威确认缺失后才清理对应投影；失败/未知保留真实线索。 | 删除弹窗关闭后卡片、详情、收藏库和整理草稿同步刷新，不需重启。 | 按精确 folder ID 幂等清理本地绑定/草稿并失效缓存；不扩大删除范围，不触发分类/备册/同步。 | 不改普通本地规则删除和未绑定知情确认边界。 | `favoriteLedgerDeletion.ts`、`managedFavoriteLedgerDeletionPersistence.ts`、`FavoriteLedgerOverview.tsx:finalizeManagedDeletionPlan/bindingLabelForLedger`。 | 已实施待验证 | `favoriteLedgerDeletion.test.ts`（5）、`managedFavoriteLedgerDeletionPersistence.test.ts`（7）、`FavoriteLedgerOverview.test.tsx`（126）；真实安装版删除刷新仍待界面验收。 |

### 讨论补充索引（R003）

| 原文编号 | 关联条目 | 精确约束 | 实施含义 | 状态 |
| --- | --- | --- | --- | --- |
| R003 | I003 | 备册状态显示是历史已修复能力，本轮按回归处理，优先恢复上个正确版本的数据投影，不重新设计显示规则。 | 对比 `21adeef2`、`3e8787cc`、`75f1204b` 的状态投影差异，补回归测试并恢复最小差异。 | 已实施待验证 |
| R003 | I004 | 保存后收藏夹不消失是历史已修复能力，本轮按回归处理，不改变推荐草稿取消语义或稳定规则 ID。 | 对比 `2a582a8d`、`15cf6289`、`5130e0d6` 等保存/投影实现，定位当前快照回写断点后只恢复该逻辑。 | 已实施待验证 |
| R003 | I005 | 删除未绑定后的收尾和刷新是历史已修复能力，本轮按回归处理，不扩大删除范围、不改确认边界。 | 对比历史删除回执、本地收尾和账号快照广播实现，补充未绑定删除回归测试后恢复权威刷新链。 | 已实施待验证 |
| R003 | I006 | 启动阶段鼠标卡顿是历史已修复能力，本轮按回归处理，恢复主窗口可交互后再后台启动小咪/宠物的非阻塞调度。 | 对比 `445ddaae`、`0ac841c7`、`77536f5f` 的启动调度差异，补充事件循环/首帧响应回归测试；不牺牲 B 站页面优先加载。 | 已实施待验证 |

| I006 | R001、R003 | 应用启动到主画面出现前及宠物加载期间鼠标、窗口和点击不能被阻塞；主画面优先可交互，宠物在可取消空闲任务中后台启动。 | 启动阶段/主窗口与小咪宠物加载 | 首帧和主窗口交互就绪后立即可操作；宠物未完成时不显示阻塞遮罩，不占用同步 UI 线程。 | 窗口移动、点击、缩放、最小化、关闭持续响应。 | 仅调整启动调度与取消/清理，不改变整理、备册、删除、同步业务。 | 主窗口 ready、B 站优先加载、宠物启动任务、Electron IPC。 | 已实施待验证 | `index.mainWindowPetStartup.test.ts`（14）验证 gate 与取消、`App.tsx` 验证浏览器 idle；真实 Electron/安装版鼠标连续移动仍待用户验收。 |

## 讨论结论

### 待用户决定

无。

### 被明确替代 / 明确不做

无。

## 实施计划（用户明确说“开始”后执行）

1. 重新通读本账本原文和索引，核对项目书 1.1、4.1、4.4、5.1 及删除/状态投影条款；只读检查当前提交与历史可用提交。
2. 追踪 I001-I002 全局提示 DOM、错误映射和滚动容器，先补失败回归测试。
3. 追踪 I003-I005 收藏夹保存、删除回执、本地收尾、权威快照和卡片投影，先补失败回归测试；不修改整理分类或 B 站副作用。
4. 按最小差异修复，优先恢复历史正确实现，不回退整提交；验证点击、滚动、窗口和启动响应不退化。
5. 运行相关测试、`npm test`、`npm run build`，检查 `git diff --check`；必要时按发布清单重新打包。

## 实施证据（2026-09-02）

- 聚焦回归套件：I001/I002/I003/I004/I005/I006 相关测试均通过；启动套件 14/14、保存面板 171/171、收藏夹概览 126/126、提示续文 7/7、样式 65/65。
- 全量验证：`npm test` 退出码 0，245 个测试文件、4224 个测试全部通过。
- 生产构建：`npm run build` 退出码 0，Electron main/preload/renderer 均生成成功。
- 安装包：干净提交后 `npm run dist:win` 退出码 0，生成 `dist/bilimi.Setup.1.1.0.exe`（392,693,113 bytes）及对应 blockmap；安装后的三形态关键路径仍待用户验收。
- 静态检查：`git diff --check` 通过；换行格式提示仅为 Git 的 CRLF 规范提示，不是差异错误。
- 真实界面验收仍待用户：开发版/安装版启动期间鼠标连续移动与点击、删除未绑定后无需重启的页面刷新、保存推荐后卡片投影、全局提示展开滚动顺序。自动化测试不能替代这些观察。
