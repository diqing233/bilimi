# B 站页面刷新反馈需求账本

## 原文区

### R001

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-317105e5-073f-4ec9-887b-b7deb353d351.png`

```text
？？？
```

截图目标：主页面区域在刷新后保持空白，用户无法判断页面是否仍在加载；顶部刷新按钮点击后没有可见反馈。

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / B 站副作用 | 明确不改的边界 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 刷新或导航开始后，当前激活 B 站页面显示明确的加载状态；成功加载后消失，主框架失败后显示可重试错误卡。 | 顶部当前网页 WebView 区域。 | 仅当前激活标签加载时显示；非激活标签不显示覆盖层；代理失败继续显示原代理错误卡。 | 刷新按钮仍只刷新当前 WebView；导航开始进入加载状态，成功/失败结束加载状态；错误卡可重新加载。 | 不修改本地收藏夹、同步计划或任何 B 站远端数据；只调用既有 WebView reload。 | 不改变标签切换、网页地址、代理直连重试和子框架失败边界。 | 已实施待真实 Electron 验收 | `BiliWebview.test.tsx` 25/25；`App.test.tsx` 126/126；`npm run build` 通过。真实 Electron 截图待补。 |

## 实施位置

- `src/renderer/src/features/browser/BiliWebview.tsx`：新增导航加载状态及主框架失败状态。
- `src/renderer/src/styles.css`：新增加载状态覆盖层样式。
- `src/renderer/src/features/browser/BiliWebview.test.tsx`：覆盖加载开始、成功、刷新后再次加载和失败卡路径。
