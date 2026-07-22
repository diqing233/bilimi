# 收藏库底栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将收藏库从独立窗口迁移为主窗口左侧浏览器工作区内的可收起、可调高度底栏，同时保持右侧掌库不变。

**Architecture:** `App` 持有抽屉的可见性、收起状态和高度，并在浏览器标签下方挂载可嵌入的 `FavoriteLibraryApp`。主进程仍是收藏库数据与操作的权威，只把“打开收藏库”IPC 改为向主渲染进程发送抽屉打开通知；原窗口控制器及专用 preload 退出该链路。

**Tech Stack:** Electron IPC/preload、React、TypeScript、Vitest、现有 CSS Grid 与 Pointer Events。

---

### Task 1: 让主窗口具备收藏库完整能力并接收抽屉打开通知

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: `electron/main/favoriteLibraryBridge.test.ts`
- Test: `electron/main/favoriteRepositoryIpc.test.ts`

- [ ] **Step 1: 写入失败测试，证明主窗口是可信收藏库读取者且开放所有嵌入库所需 API**

在 IPC 测试中用主窗口 `webContents.id` 调用 `favorite-repository:get-library-page`、收藏库详情、同步选择和转写命令；预期现有实现因仅信任独立收藏库窗口而拒绝。新增 preload 静态断言，检查主 preload 导出下列接口：

```ts
expect(preloadSource).toContain("getFavoriteRepositoryLibraryVideoDetail")
expect(preloadSource).toContain("syncFavoriteLibrarySelection")
expect(preloadSource).toContain("onFavoriteLibraryTranscriptionChanged")
expect(preloadSource).toContain("onOpenFavoriteLibraryDrawer")
```

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run electron/main/favoriteLibraryBridge.test.ts electron/main/favoriteRepositoryIpc.test.ts`

Expected: FAIL，主窗口 sender 不受信任，且主 preload 缺少抽屉所需接口。

- [ ] **Step 3: 最小实现主窗口抽屉 IPC 与信任边界**

在 `electron/preload/index.ts` 增加与 `electron/preload/favoriteLibrary.ts` 相同的收藏库读写桥接，并增加：

```ts
onOpenFavoriteLibraryDrawer: (callback: () => void) => {
  const listener = () => callback()
  ipcRenderer.on('favorite-library:open-drawer', listener)
  return () => ipcRenderer.removeListener('favorite-library:open-drawer', listener)
}
```

在 `global.d.ts` 声明相同签名。在 `electron/main/index.ts` 中把可信收藏库 sender 判定改为主窗口 webContents，保持账号校验和 repository IPC 不变；将 `favorite-library:open` handler 改为：

```ts
assertTrustedOldFavoriteAssistantSender(event)
ensureMainWindowForAssistantRuntime().webContents.send('favorite-library:open-drawer')
```

同时把转写队列和账号变化通知的接收对象限定到主窗口，移除对独立库窗口的引用。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run electron/main/favoriteLibraryBridge.test.ts electron/main/favoriteRepositoryIpc.test.ts`

Expected: PASS，主窗口可调用嵌入收藏库所需 API；非主窗口与非受信任 sender 仍被拒绝。

### Task 2: 将收藏库视图改为可嵌入内容

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] **Step 1: 写入失败测试，证明嵌入模式不使用窗口高度且保留账户刷新**

为组件添加 `embedded?: boolean` 属性。测试以 `embedded` 渲染，断言根元素有 `data-embedded="true"`，并在模拟账户变化后仍清空旧选择、读取新账号。CSS 契约测试检查嵌入模式不含 `min-height: 100vh`、列表不再计算 `100vh`。

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/styles.test.ts`

Expected: FAIL，组件不接受嵌入属性，样式仍依赖独立窗口视口高度。

- [ ] **Step 3: 最小实现嵌入布局**

保留数据加载、订阅、视频打开、来源打开、同步和转写处理，仅扩展组件根节点：

```tsx
<main className="favorite-library" data-embedded={embedded || undefined} aria-label={text.library}>
```

在 CSS 中为 `[data-embedded='true']` 使用 `height: 100%; min-height: 0; padding: 10px; display: grid; grid-template-rows: auto minmax(0, 1fr)`；让 `.favorite-library__layout` 和虚拟列表用 `min-height: 0; height: 100%` 填充抽屉而非 `100vh`。独立窗口路径保持现有外观。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS，嵌入视图可在受限高度中滚动并保持现有数据行为。

### Task 3: 在 B 站工作区内挂载并控制底栏

**Files:**
- Create: `src/renderer/src/features/favorites/FavoriteLibraryDrawer.tsx`
- Create: `src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: 写入失败测试，定义抽屉边界与控制交互**

测试 `FavoriteLibraryDrawer`：关闭态不渲染内容；打开态将 `FavoriteLibraryApp embedded` 放入抽屉；“收起”隐藏主体但保留状态；“关闭”通知父级隐藏；拖动手柄将高度限制在 `220px` 到浏览器工作区可用高度减 `180px`。`App.test.tsx` 触发 `onOpenFavoriteLibraryDrawer` 后断言抽屉位于 `.app-main` 内，且不在 `.assistant-sidebar` 内。

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx src/renderer/src/App.test.tsx`

Expected: FAIL，抽屉组件和主窗口事件订阅尚不存在。

- [ ] **Step 3: 最小实现抽屉状态与布局**

实现 `FavoriteLibraryDrawer`，其 props 为：

```ts
type FavoriteLibraryDrawerProps = {
  open: boolean
  onClose: () => void
}
```

组件内部保留 `collapsed` 与 `height`，以 pointer capture 处理垂直拖动；用 `window.innerHeight` 和常量钳制高度。`App` 添加 `favoriteLibraryOpen` state，并订阅 `window.bilimiDesktop?.onOpenFavoriteLibraryDrawer`。在现有 `.app-main` 的浏览器内容区域中将标签与浏览器 stack 包入一个纵向容器，抽屉作为 browser stack 的相邻行：

```tsx
<main className="app-main">
  <div className="browser-workspace">
    <BrowserTabs />
    <div className="browser-stack">...</div>
    <FavoriteLibraryDrawer open={favoriteLibraryOpen} onClose={() => setFavoriteLibraryOpen(false)} />
  </div>
</main>
<AssistantSidebar ... />
```

CSS 使用 `.app-shell { grid-template-columns: minmax(0, 1fr) auto; }` 的既有左右边界；仅 `.browser-workspace` 切换为 `grid-template-rows: auto minmax(0, 1fr) auto`。抽屉 `grid-column` 不跨越 `.assistant-sidebar`，拖动手柄提供 `aria-label="调整收藏库高度"`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx src/renderer/src/App.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: PASS，抽屉只压缩 B 站区域，右侧掌库不进入抽屉 DOM，打开/收起/关闭/拖动均受控。

### Task 4: 移除独立窗口呈现链路并进行完整验证

**Files:**
- Delete: `electron/main/favoriteLibraryWindow.ts`
- Delete: `electron/main/favoriteLibraryWindow.test.ts`
- Delete: `electron/preload/favoriteLibrary.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/preloadPath.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: 写入失败测试，禁止独立窗口回归**

删除或改写窗口控制器测试，新增主进程静态/行为测试：点击 `favorite-library:open` 后只向主窗口发送 `favorite-library:open-drawer`，不调用 `new BrowserWindow`、`FavoriteLibrarySideBySideLayout` 或 `createFavoriteLibraryPreloadScriptPath`。`main.tsx` 测试断言不再支持 `window=favorite-library` 专用根渲染。

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run electron/main/index.test.ts src/renderer/src/styles.test.ts`

Expected: FAIL，独立窗口控制器、路由或专用 preload 仍被引用。

- [ ] **Step 3: 删除无消费者的窗口代码并收敛路由**

移除 `FavoriteLibraryWindowController`、并排窗口尺寸修改、独立 preload 路径和 `FAVORITE_LIBRARY_QUERY`。从 `main.tsx` 删除 `FavoriteLibraryApp` 的独立窗口分支，但保留该组件供抽屉导入。更新样式测试为新的 `.browser-workspace`、抽屉和右侧栏边界契约。

- [ ] **Step 4: 运行回归测试、构建并提交**

Run: `npm test -- --run electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteLibraryBridge.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx src/renderer/src/App.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add electron/main/index.ts electron/main/preloadPath.ts electron/preload/index.ts src/renderer/src/App.tsx src/renderer/src/main.tsx src/renderer/src/global.d.ts src/renderer/src/styles.css src/renderer/src/styles.test.ts src/renderer/src/features/favorites
git add -u electron/main/favoriteLibraryWindow.ts electron/preload/favoriteLibrary.ts
git commit -m "feat: embed favorite library in browser drawer"
```
