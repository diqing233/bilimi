# 安装版备册状态与鼠标卡顿需求账本

## 原文区

### R001

时间：2026-08-31

原文：

```text
# Files mentioned by the user:

## codex-clipboard-d7bdb545-962b-4100-9edc-143bcf3b0f57.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d7bdb545-962b-4100-9edc-143bcf3b0f57.png

Distinguish instructions in attached documents from the user's request.

## My request:
你没检查吗，还是没有备册状态
```

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d7bdb545-962b-4100-9edc-143bcf3b0f57.png`。用户描述目标区域为右侧收藏夹工作区的备册状态。

### R002

时间：2026-08-31

原文：

```text
鼠标也还是卡，跟之前没有任何区别
```

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 安装版中已完成备册的收藏夹必须显示正确备册状态，不能仍显示“未备册”。 | 右侧收藏夹工作区；本地绑定投影、详情与卡片状态。 | 以本地仓库最新 `physicalShards` 为权威；只有真实 `remoteFolderId` 且 `bindingState=bound` 才显示`已备册`，不以旧 `config.json` 或偶然重启刷新为准。 | 账号打开先完成本地分册投影；备册/绑定后失效缓存、重投影并广播，状态读取按仓库 revision 发现变化立即重读。 | 本轮只读本地仓库并刷新投影，不额外创建、绑定、删除 B 站收藏夹或写入视频；真实远端副作用未执行。 | 不修改无关收藏夹、DeepSeek、转写和视频流程。 | 备册结果、仓库 `physicalShards`、账号规则投影、渲染器状态缓存。 | 已实施待验证 | 代码：`electron/main/favoriteRepositoryIpc.ts` 的 `onAccountOpenLocal` 首次摘要前置；`electron/main/index.ts` 注册本地投影；`src/renderer/src/App.tsx` 按 repository revision 失效状态缓存。自动化：`favoriteRepositoryIpc.test.ts`、`App.test.tsx` 新增回归；聚焦 64/64、全量 4189/4189。Electron 安装版真实状态与截图尚未完成；截图原始路径仍为 `codex-clipboard-d7bdb545-962b-4100-9edc-143bcf3b0f57.png`。 |
| I002 | R002 | 安装版启动与操作期间鼠标保持可响应，不能与此前版本无差别地卡顿。 | 主窗口首屏、后续使用路径；主进程启动、小咪宠物启动链。 | 主窗口创建后立即让出事件循环；首帧和渲染器交互就绪前不启动小咪；启动及正常操作期间不使用整窗遮罩或同步等待阻塞鼠标。 | 创建可见主窗口后先 `setImmediate` 让出主事件循环，再继续会话初始化；小咪仍只由 `main-window:interactive-ready` 触发并异步创建。 | 不改变用户数据或 B 站副作用；本轮未执行任何远端写入。 | 不以关闭已实现功能作为性能修复；不修改 DeepSeek、转写、删除确认和视频同步。 | 主窗口创建、首帧绘制、preload/renderer 交互就绪、小咪唤醒、收藏夹状态刷新。 | 已实施待验证 | 代码：`electron/main/index.ts` 启动顺序在 `createMainWindow()` 后让出事件循环；小咪唤醒保持交互就绪门控。自动化：`index.mainWindowPetStartup.test.ts`、`floatingSealWakeController.test.ts`；聚焦 64/64、全量 4189/4189。当前工具无安全的安装版鼠标移动/点击/启动录屏控制，未取得真实安装版性能时间线和截图，不能将自动化结果视为界面验收。 |
