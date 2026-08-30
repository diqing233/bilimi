# 安装版新建收藏夹本地保存（2026-08-31）

## 原文区

### R001

附件截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d87e8eac-5c3d-4d97-b1a8-9e05b1068c5d.png`

截图中的用户原文（按可读取时间顺序）：

> 讨论为什么我新建收藏夹点击保存后会消失

> 你来抓取查清楚

> 我刚刚点了没用

> 已点击

截图目标：安装版右侧“新建收藏夹”编辑器。点击“保存”后编辑器关闭；随后检查安装版当前账号配置，仍只有原来的 8 个默认收藏夹，新规则没有持久化。

### R002

> 继续完成截图对话的修复

## 逐项索引

| 编号 | 状态 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | 已确认 / 实施中 | 安装版在右侧新建或编辑本地收藏夹时，点击`保存`必须持久化到当前账号规则目录；只有取得成功持久化回执后才关闭编辑器。保存失败、B 站页面不可用、未登录或回执`ok: false`时，规则不能消失，编辑器保留并显示真实失败原因。 | 右侧`收藏夹` → `新建收藏夹`/编辑器；`%APPDATA%\bilimi\config.json`的当前账号`favoriteAccountPreferences.<mid>.favoriteLedgers`。 | 普通本地保存始终可用，不受 B 站远端页面加载、Cookie 或目录读取影响；只有明确备册/同步/绑定操作才进入远端预检。 | 保存成功：关闭编辑器、刷新规则卡片并异步触发原有本地重分类；保存失败：保留编辑器与编辑内容，不关闭、不伪造成功。 | 普通保存仅写本地当前账号偏好；不读取、创建、绑定、删除、改名或写入 B 站收藏夹和视频。显式备册、绑定、同步和删除链路保持原样。 | 不修改 DeepSeek、转写、视频同步、删除模式、单个备册入口、正常规则勾选策略或无关 UI；不能因本修复增加点击卡顿。 | `FavoriteLedgerOverview`保存回执处理；`ControlledFavoriteLedgerPanel`重分类协调；`FloatingAssistantApp`→预加载→主进程 IPC→主窗口运行时→账户偏好持久化。 | 根因已确认：普通保存走`save-ledgers`远端运行时，先要求 B 站登录和页面脚本；`FavoriteLedgerOverview`只捕获 reject，不处理`ok: false`，因此关闭编辑器而没有写配置。安装版只读检查：当前账号配置为 8 个默认规则；自动化、Electron 和安装版回归待完成。 |

## 实施前核对

已确认：I001（R001、R002）。

待用户决定：无。

被明确替代：无。

明确不做：不执行真实 B 站创建、绑定、删除、移动或视频写入；不打包、不发布、不修改 DeepSeek、转写、视频同步、删除模式或单个备册入口。

## 实施计划

1. 为普通本地保存返回`ok: false`时编辑器不关闭、内容不丢失写 RED 回归；覆盖 `FavoriteLedgerOverview.tsx` 与其测试。
2. 为普通本地保存不调用 B 站页面脚本、直接持久化当前账号规则目录写 RED 回归；覆盖主窗口运行时与 `App.test.tsx`。
3. 将普通规则目录保存与显式备册/绑定/同步的远端链路分开，严格以账户偏好持久化回执更新渲染状态；保留现有异步重分类。
4. 运行聚焦测试、相关收藏夹回归、构建、Electron 只读验收和安装版构建版本核对，回填本账本后只提交本轮文件。

## 实施证据

### I001（R001、R002）

- 实际代码位置：`src/renderer/src/App.tsx` 的 `save-ledgers` 运行时分支；无远端选项时直接写当前账号 `favoriteAccountPreferences.<mid>.favoriteLedgers`，校验持久化回执后才返回成功。`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 保存处理识别 `ok:false`、异常和非成功回执，保留编辑器/输入并显示失败原因。`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` 仅在保存成功后触发既有异步重分类/刷新。
- 自动化验证：
  - `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx --reporter=dot`：249/249 通过。
  - `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot`：169/169 通过。
  - `npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --reporter=dot`：154/154 通过。
  - `npx vitest run src/renderer/src/App.test.tsx --reporter=dot`：128/128 通过。
  - `npm test`：243 个测试文件、4177 个测试全部通过（退出码 0）。
  - `npm run build`：退出码 0，Electron 主进程、preload 和 renderer 均成功构建。
  - `git diff --check`：无空白错误；仅有 Git 的 LF/CRLF 转换警告。
  - `npm run dist:win`：退出码 0，生成 `dist/bilimi.Setup.1.1.0.exe`（x64 NSIS）及对应 `.blockmap`、`latest.yml`。
- 真实界面验收：尚未完成安装版/开发版鼠标级验收；本轮未执行真实 B 站创建、绑定、删除、移动或视频写入。
- 结果：聚焦收藏夹行为已验证；普通本地保存不调用 `executeJavaScript`，`ok:false` 保持编辑器打开且输入不丢失。全量测试、生产构建和 Windows NSIS 打包均已通过；未执行安装版鼠标级验收，因此不把它写成已完成。
