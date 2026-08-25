# 采用标签后推荐与网页状态刷新需求账本

## 原文区（不可改写）

### R001

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6bed1a48-8f7b-49d1-ad11-95d2250e800b.png`

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-6bed1a48-8f7b-49d1-ad11-95d2250e800b.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6bed1a48-8f7b-49d1-ad11-95d2250e800b.png

Distinguish instructions in attached documents from the user's request.

## My request:
还是这两个问题，采用标签后就可以点推荐收藏夹了，画面没刷新，你干啥了
```

截图目标：右侧“整理收藏 > 推荐收藏夹”区域的旧红色失败提示、推荐候选与勾选状态是否随“采用当前标签”后的权威快照刷新；左侧 B 站 WebView 在首次加载/刷新时不能长期空白且应给出可见加载或失败反馈。截图只能作为界面问题证据，不执行创建、绑定、删除、同步或视频写入。

### R002

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8ba36b96-8238-4eb1-bedb-f2c1130545bd.png`

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-8ba36b96-8238-4eb1-bedb-f2c1130545bd.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8ba36b96-8238-4eb1-bedb-f2c1130545bd.png

Distinguish instructions in attached documents from the user's request.

## My request:
已采用为什么失败
```

截图目标：右侧“整理收藏 > 推荐收藏夹”区域在“已采用当前标签”后仍出现“推荐收藏夹保存失败，请稍后重试。”；核对采用标签状态、推荐候选和推荐保存失败的真实来源。截图只用于只读诊断，不执行创建、绑定、删除、同步或视频写入。

### R003

原文消息：

```text
你实际检查呀
```

目标：必须检查开发版实际工作区、原始终端错误和持久化快照，不能只根据界面文案推测失败原因。

### R004

原文消息：

```text
修复
```

目标：修复已确认的“采用标签后推荐收藏夹保存失败”根因，保持本轮只读 B 站边界和既有整理流程。

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施待 Electron 验收 | R001 | “采用当前标签”完成后，推荐候选、采用勾选、旧推荐失败提示、归档预览与执行资格必须使用同一权威快照；即使命令桥接没有直接返回快照，也必须只读刷新后再解除锁定。 | `useOldFavoriteWorkspace`、`OldFavoriteGuide`、`OldFavoriteRecommendationStep`、采用标签 IPC 返回链。 | 采用/重算进行中锁定推荐选择；完成后清除旧错误并显示新候选，写入资格继续按快照事实计算。 | 命令结果为空时仅对采用标签补一次 `refresh(true)`；账号或工作区不一致/刷新失败时不发布旧结果。 | 只更新本地整理工作区投影；不创建、绑定、删除远端收藏夹，不写视频或 B 站同步。 | 不改变推荐分类算法、上方规则取消语义、DeepSeek、转写、删除确认和同步执行边界。 | 标签截止版本、完整范围重分类、推荐候选索引、归档预览、确认执行资格。 | 红灯→绿灯：`useOldFavoriteWorkspace.test.tsx` 新增空命令结果后的权威刷新回归；既有推荐/向导/确认回归保持通过。真实 Electron 有对应草稿时需观察旧错误消失和候选更新；本轮不主动制造远端写入。 |
| 已实施待 Electron 验收 | R001 | B 站 WebView 加载开始时不能让主区域保持无反馈空白；应显示加载中，主框架失败显示可重试失败卡，成功后移除反馈。 | `BiliWebview`、顶部“刷新当前网页”按钮及其 WebView 区域。 | 仅当前激活标签的导航加载显示；非主框架失败不覆盖主页面；成功后加载/失败反馈消失。 | 刷新或导航开始进入加载状态，主框架失败显示错误说明和重新加载按钮，成功加载恢复页面。 | 仅调用既有 WebView 加载/刷新；不改收藏夹、整理草稿、同步计划或 B 站数据。 | 不改变页面地址、标签切换、代理直连重试、子框架失败边界。 | Electron WebView 事件、主窗口布局、浏览器刷新控制。 | `BiliWebview.test.tsx` 25/25、`App.test.tsx` 126/126；真实 Electron 只读截图待补，禁止执行写入操作。 |
| 已实施待 Electron 验收 | R002-R004 | “已采用当前标签”后推荐收藏夹仍可保存；真实错误必须按开发版原始异常修复，不能以泛化红字掩盖。 | `electron/main/index.ts:120-124,2408-2415` 的历史规则快照回调、`OldFavoriteWorkspaceCoordinator.setRecommendedCandidates`、推荐收藏夹红字。 | 采用成功后推荐候选可勾选；保存失败只在真实保存/分类错误时显示，未定义引用不得发生。 | 勾选推荐候选进入历史快照、分类、规则持久化链；不因历史记录回调抛 `ReferenceError`。 | 只更新本地规则/整理草稿；不创建、绑定、删除 B 站收藏夹，不写视频。 | 不改变采用标签算法、推荐候选生成、DeepSeek、转写、删除确认、同步执行和 WebView 边界。 | `isUnsavedFavoriteLedgerDraft` 导入、历史快照回调、推荐保存 IPC。 | 根因证据：开发版终端出现 `ReferenceError: isUnsavedFavoriteLedgerDraft is not defined`；工作区持久化快照显示标签采用成功但推荐 adopted 仍为空；`git blame` 指向 `cc5e6861`。修复：补齐 `isUnsavedFavoriteLedgerDraft` 导入。自动化：`index.favoriteHistoryWiring.test.ts` 1/1、协调器/IPC/采用标签聚焦 465/465、收藏夹界面聚焦 353/353，`npm run build` 通过，`git diff --check` 通过。Electron 只读截图仍沿用 [2026-08-26-tag-adoption-recommendation-electron-readonly.png](../../.codex-artifacts/2026-08-26-tag-adoption-recommendation-electron-readonly.png)；未能在不制造新草稿的前提下真实点击推荐勾选，真实远端副作用未验证。`npx tsc --noEmit` 仍受工作树既有类型错误阻断，但已无本次 `TS2552` 缺失符号错误。 |

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

不执行 B 站真实创建、绑定、删除、同步或视频写入；只做自动化测试和 Electron 只读验收。

## 实施证据（2026-08-26）

### 推荐快照刷新

- 代码：`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts:752-766` 在采用标签命令没有直接返回快照时补一次 `refresh(true)`，并以同一快照清除旧推荐错误、同步候选 ID；`OldFavoriteGuide.tsx:352-366` 和 `OldFavoriteRecommendationStep.tsx:155-159` 在采用/重算期间锁定推荐选择并显示进行中状态。
- 自动化：`useOldFavoriteWorkspace.test.tsx` 新增空命令结果权威刷新回归（红灯后绿灯）；收藏夹渲染聚焦回归 `401/401`，主进程协调器与 IPC 回归 `383/383`。
- Electron 只读：已捕获开发版窗口截图 [2026-08-26-tag-adoption-recommendation-electron-readonly.png](../../.codex-artifacts/2026-08-26-tag-adoption-recommendation-electron-readonly.png)。当前账号没有可安全制造的标签采用草稿，未点击采用、推荐、备册、绑定、删除或同步按钮；推荐错误清除和候选刷新以自动化证据为主，真实草稿验收待有对应工作区时补做。
- B 站边界：本项只读本地工作区快照，不触发任何 B 站远端副作用。

### B 站 WebView 反馈

- 代码：`src/renderer/src/features/browser/BiliWebview.tsx:272-327,451-480` 在主框架导航开始、成功和失败时维护加载/失败反馈；`src/renderer/src/styles.css:795-812` 提供加载覆盖层。
- 自动化：`BiliWebview.test.tsx` `25/25`，`App.test.tsx` `126/126`；`npm run build` 通过；`git diff --check` 通过。
- Electron 只读：同一截图显示 B 站首页已经正常渲染；未执行刷新以外的页面写入、收藏夹创建/绑定/删除或视频同步。
- B 站边界：仅使用既有 WebView 导航/刷新，不修改远端数据。
