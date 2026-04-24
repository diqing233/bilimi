# Bilimi MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Bilimi 第一阶段可运行 MVP：Electron 内嵌 B 站浏览、右下角印玺入口、展开后的案头奏折助手，以及 `赏 / 赐 / 表 / 阅` 的主链路。

**Architecture:** 使用 `electron-vite + React + TypeScript` 搭建桌面壳。渲染层用 React 在内嵌 `webview` 之上叠加古风助手 UI；自动化层优先通过 `webview.executeJavaScript()` 操作页面 DOM，并将本地偏好与专用收藏夹信息通过 preload 暴露给渲染层。

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, Testing Library, electron-store

---

## File Structure

### Root

- `package.json`
  - Node 脚本、依赖和开发命令
- `tsconfig.json`
  - TypeScript 总配置
- `electron.vite.config.ts`
  - Electron 主进程、preload 和渲染层打包配置
- `vitest.config.ts`
  - 测试配置

### Electron runtime

- `electron/main/index.ts`
  - 创建 BrowserWindow，打开渲染层，启用 `webviewTag`
- `electron/preload/index.ts`
  - 通过 `contextBridge` 暴露本地存储 API
- `electron/main/store.ts`
  - `electron-store` 封装，保存偏好与 Bilimi 专用收藏夹信息

### Shared

- `src/shared/constants.ts`
  - 应用标题、Bilibili 起始地址、持久会话 partition、默认收藏夹名
- `src/shared/types.ts`
  - 助手动作、推荐类别、评论草稿等共享类型

### Renderer

- `src/renderer/index.html`
  - Electron 渲染入口
- `src/renderer/src/main.tsx`
  - React 挂载入口
- `src/renderer/src/App.tsx`
  - 主界面布局：`webview` + 助手覆盖层
- `src/renderer/src/styles.css`
  - 全局和案头奏折主题样式

### Browser feature

- `src/renderer/src/features/browser/browserSurfaceModel.ts`
  - 生成 `webview` 需要的 `src`、`partition` 等配置
- `src/renderer/src/features/browser/BiliWebview.tsx`
  - 渲染 Bilibili `webview`
- `src/renderer/src/features/browser/browserSurfaceModel.test.ts`
  - `webview` 配置测试

### Assistant UI

- `src/renderer/src/features/assistant/AssistantOverlay.tsx`
  - 收起印玺、悬停提示、展开奏折三态切换
- `src/renderer/src/features/assistant/SealButton.tsx`
  - 小印玺入口
- `src/renderer/src/features/assistant/MemorialPanel.tsx`
  - 展开奏折主界面
- `src/renderer/src/features/assistant/CoinPrompt.tsx`
  - `赐` 动作前的 1 币 / 2 币 / 取消选择
- `src/renderer/src/features/assistant/CommentChooser.tsx`
  - `表` 动作的 3 条候选评论选择器
- `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
  - 收起到展开的交互测试

### Recommendation and copy

- `src/renderer/src/features/recommendation/recommendationRules.ts`
  - 按内容类型生成 `可赏 / 可阅 / 慎入 / 请陛下过目`
- `src/renderer/src/features/recommendation/recommendationRules.test.ts`
  - 推荐语规则测试
- `src/renderer/src/features/comments/commentComposer.ts`
  - 生成三条奏折腔评论
- `src/renderer/src/features/comments/commentComposer.test.ts`
  - 评论生成测试

### State and actions

- `src/renderer/src/features/state/assistantState.ts`
  - 助手 UI 状态与偏好更新
- `src/renderer/src/features/state/assistantState.test.ts`
  - 本地状态与偏好更新测试
- `src/renderer/src/features/actions/pageAutomation.ts`
  - 页面 DOM 自动化脚本封装
- `src/renderer/src/features/actions/actionExecutor.ts`
  - `赏 / 赐 / 表 / 阅` 行为编排
- `src/renderer/src/features/actions/actionExecutor.test.ts`
  - 动作执行逻辑测试

### Test setup

- `src/test/setup.ts`
  - jsdom 测试环境初始化

---

### Task 1: 初始化 Electron + React + Test Workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/constants.test.ts`

- [ ] **Step 1: 写基础配置和一个会失败的常量测试**

```json
{
  "name": "bilimi",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "electron-store": "^10.1.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.15.3",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "electron": "^35.1.4",
    "electron-vite": "^3.0.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.1.2"
  }
}
```

```ts
// src/shared/constants.test.ts
import { describe, expect, it } from 'vitest'
import {
  APP_TITLE,
  BILIBILI_HOME_URL,
  BILIMI_FAVORITES_NAME,
  BILIMI_SESSION_PARTITION
} from './constants'

describe('shared constants', () => {
  it('defines the Bilimi shell defaults', () => {
    expect(APP_TITLE).toBe('Bilimi')
    expect(BILIBILI_HOME_URL).toBe('https://www.bilibili.com')
    expect(BILIMI_SESSION_PARTITION).toBe('persist:bilimi')
    expect(BILIMI_FAVORITES_NAME).toBe('Bilimi 内库')
  })
})
```

- [ ] **Step 2: 安装依赖并运行测试，确认先失败**

Run:

```bash
npm install
npm run test -- src/shared/constants.test.ts
```

Expected:

```text
FAIL  src/shared/constants.test.ts
Error: Failed to resolve import "./constants"
```

- [ ] **Step 3: 写最小实现和测试基础配置**

```ts
// src/shared/constants.ts
export const APP_TITLE = 'Bilimi'
export const BILIBILI_HOME_URL = 'https://www.bilibili.com'
export const BILIMI_SESSION_PARTITION = 'persist:bilimi'
export const BILIMI_FAVORITES_NAME = 'Bilimi 内库'
```

```ts
// electron.vite.config.ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()]
  }
})
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["electron", "src", "vitest.config.ts", "electron.vite.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts']
  }
})
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: 重新运行测试，确认通过**

Run:

```bash
npm run test -- src/shared/constants.test.ts
```

Expected:

```text
PASS  src/shared/constants.test.ts
1 passed
```

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json electron.vite.config.ts vitest.config.ts src/test/setup.ts src/shared/constants.ts src/shared/constants.test.ts
git commit -m "chore: bootstrap Bilimi workspace"
```

---

### Task 2: 建立 Electron 窗口和 B 站内嵌浏览面

**Files:**
- Create: `electron/main/index.ts`
- Create: `electron/preload/index.ts`
- Create: `src/shared/types.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/styles.css`
- Create: `src/renderer/src/features/browser/browserSurfaceModel.ts`
- Create: `src/renderer/src/features/browser/browserSurfaceModel.test.ts`
- Create: `src/renderer/src/features/browser/BiliWebview.tsx`

- [ ] **Step 1: 先写 `webview` 配置测试**

```ts
// src/renderer/src/features/browser/browserSurfaceModel.test.ts
import { describe, expect, it } from 'vitest'
import { createBrowserSurfaceModel } from './browserSurfaceModel'

describe('createBrowserSurfaceModel', () => {
  it('returns the persistent Bilimi Bilibili surface config', () => {
    expect(createBrowserSurfaceModel()).toEqual({
      src: 'https://www.bilibili.com',
      partition: 'persist:bilimi',
      allowpopups: 'true'
    })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/features/browser/browserSurfaceModel.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/browser/browserSurfaceModel.test.ts
Error: Failed to resolve import "./browserSurfaceModel"
```

- [ ] **Step 3: 写 Electron 壳、React 入口和 `webview` 最小实现**

```ts
// src/shared/types.ts
export type AssistantAction = '赏' | '赐' | '表' | '阅'

export type BrowserSurfaceModel = {
  src: string
  partition: string
  allowpopups: 'true'
}
```

```ts
// src/renderer/src/features/browser/browserSurfaceModel.ts
import { BILIBILI_HOME_URL, BILIMI_SESSION_PARTITION } from '@shared/constants'
import type { BrowserSurfaceModel } from '@shared/types'

export function createBrowserSurfaceModel(): BrowserSurfaceModel {
  return {
    src: BILIBILI_HOME_URL,
    partition: BILIMI_SESSION_PARTITION,
    allowpopups: 'true'
  }
}
```

```tsx
// src/renderer/src/features/browser/BiliWebview.tsx
import { createBrowserSurfaceModel } from './browserSurfaceModel'

export function BiliWebview() {
  const model = createBrowserSurfaceModel()

  return (
    <webview
      id="bilimi-webview"
      className="browser-surface"
      src={model.src}
      partition={model.partition}
      allowpopups={model.allowpopups}
    />
  )
}
```

```tsx
// src/renderer/src/App.tsx
import { BiliWebview } from './features/browser/BiliWebview'

export default function App() {
  return (
    <div className="app-shell">
      <BiliWebview />
    </div>
  )
}
```

```tsx
// src/renderer/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

```html
<!-- src/renderer/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bilimi</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
  </html>
```

```css
/* src/renderer/src/styles.css */
html,
body,
#root {
  margin: 0;
  width: 100%;
  height: 100%;
}

body {
  overflow: hidden;
  background: #1f140f;
  font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
}

.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
}

.browser-surface {
  width: 100%;
  height: 100%;
}
```

```ts
// electron/preload/index.ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0'
})
```

```ts
// electron/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: '#1f140f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../../renderer/index.html'))
  }
}

app.whenReady().then(createMainWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: 运行测试和构建，确认基础壳可编译**

Run:

```bash
npm run test -- src/renderer/src/features/browser/browserSurfaceModel.test.ts
npm run build
```

Expected:

```text
PASS  src/renderer/src/features/browser/browserSurfaceModel.test.ts
electron-vite v3 build completed successfully
```

- [ ] **Step 5: 提交**

```bash
git add electron/main/index.ts electron/preload/index.ts src/shared/types.ts src/renderer/index.html src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/styles.css src/renderer/src/features/browser/browserSurfaceModel.ts src/renderer/src/features/browser/browserSurfaceModel.test.ts src/renderer/src/features/browser/BiliWebview.tsx
git commit -m "feat: add Electron shell and embedded browser surface"
```

---

### Task 3: 实现小印玺与展开后的案头奏折 UI

**Files:**
- Create: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Create: `src/renderer/src/features/assistant/SealButton.tsx`
- Create: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Create: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 先写展开交互测试**

```tsx
// src/renderer/src/features/assistant/assistantOverlay.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { AssistantOverlay } from './AssistantOverlay'

describe('AssistantOverlay', () => {
  it('opens the memorial panel from the folded seal', () => {
    render(<AssistantOverlay />)

    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText('赏')).toBeInTheDocument()
    expect(screen.getByText('赐')).toBeInTheDocument()
    expect(screen.getByText('表')).toBeInTheDocument()
    expect(screen.getByText('阅')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/assistantOverlay.test.tsx
Error: Failed to resolve import "./AssistantOverlay"
```

- [ ] **Step 3: 实现收起印玺、展开奏折与页面挂载**

```tsx
// src/renderer/src/features/assistant/SealButton.tsx
type SealButtonProps = {
  onOpen: () => void
}

export function SealButton({ onOpen }: SealButtonProps) {
  return (
    <button className="seal-button" type="button" onClick={onOpen} aria-label="开折批阅">
      <span className="seal-button__hint">掌印官请旨：是否开折批阅？</span>
      <span className="seal-button__face">玺</span>
    </button>
  )
}
```

```tsx
// src/renderer/src/features/assistant/MemorialPanel.tsx
type MemorialPanelProps = {
  onClose: () => void
}

export function MemorialPanel({ onClose }: MemorialPanelProps) {
  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
        <div className="memorial-panel__header">
          <span>今日所陈</span>
          <h2>御前待阅折</h2>
          <span>司礼监掌印官谨呈</span>
        </div>
        <div className="memorial-panel__body">
          <aside className="memorial-panel__meta">
            <p>题名：早八生存实录</p>
            <p>类目：解闷小品</p>
            <p>时长：07:24</p>
          </aside>
          <div className="memorial-panel__copy">
            <p>臣谨以此物进呈陛下。此条出自民间嬉笑之作，虽非正经章奏，却颇能消烦。</p>
            <p>其人言辞轻快，笑机来得突兀，然未流于鄙俗，尚称解闷之具。</p>
            <p>若陛下今日案牍稍繁，欲暂歇心神，可先阅此一则，再决其是否入册。</p>
          </div>
          <aside className="memorial-panel__verdict">
            <h3>朱批</h3>
            <p>此物可先过目，不必骤然重赐。</p>
          </aside>
          <div className="memorial-panel__actions">
            <button type="button">赏</button>
            <button type="button">赐</button>
            <button type="button">表</button>
            <button type="button">阅</button>
          </div>
        </div>
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          合折
        </button>
      </div>
    </section>
  )
}
```

```tsx
// src/renderer/src/features/assistant/AssistantOverlay.tsx
import { useState } from 'react'
import { MemorialPanel } from './MemorialPanel'
import { SealButton } from './SealButton'

export function AssistantOverlay() {
  const [open, setOpen] = useState(false)

  return (
    <div className="assistant-overlay">
      {open ? <MemorialPanel onClose={() => setOpen(false)} /> : <SealButton onOpen={() => setOpen(true)} />}
    </div>
  )
}
```

```tsx
// src/renderer/src/App.tsx
import { AssistantOverlay } from './features/assistant/AssistantOverlay'
import { BiliWebview } from './features/browser/BiliWebview'

export default function App() {
  return (
    <div className="app-shell">
      <BiliWebview />
      <AssistantOverlay />
    </div>
  )
}
```

```css
/* append to src/renderer/src/styles.css */
.assistant-overlay {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 20;
}

.seal-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border: none;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, #743720, #3a1b12 72%);
  color: #f3dfbc;
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.28);
  cursor: pointer;
}

.seal-button__hint {
  position: absolute;
  right: 90px;
  bottom: 18px;
  display: none;
  white-space: nowrap;
  padding: 8px 12px;
  border: 1px solid rgba(113, 81, 48, 0.24);
  background: #fbf4e7;
  color: #6a4a2b;
}

.seal-button:hover .seal-button__hint {
  display: block;
}

.seal-button__face {
  font-size: 28px;
}

.memorial-panel {
  width: min(980px, calc(100vw - 72px));
}

.memorial-panel__paper {
  border: 1px solid rgba(113, 81, 48, 0.3);
  background: linear-gradient(180deg, #f4ead4 0%, #ece0c7 100%);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.34);
  padding: 28px;
}

.memorial-panel__header,
.memorial-panel__body {
  display: grid;
  gap: 16px;
}

.memorial-panel__header {
  grid-template-columns: 110px 1fr 220px;
  align-items: center;
  color: #714f30;
}

.memorial-panel__body {
  margin-top: 20px;
  grid-template-columns: 180px 1fr 220px 96px;
}

.memorial-panel__copy,
.memorial-panel__meta,
.memorial-panel__verdict {
  color: #4b3321;
  line-height: 2;
}

.memorial-panel__actions {
  display: grid;
  gap: 12px;
}

.memorial-panel__actions button,
.memorial-panel__close {
  border: 1px solid rgba(113, 81, 48, 0.32);
  background: #fbf4e8;
  color: #6d4c2d;
  font: inherit;
  padding: 10px 12px;
  cursor: pointer;
}

.memorial-panel__close {
  margin-top: 18px;
}
```

- [ ] **Step 4: 重新运行测试**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/assistantOverlay.test.tsx
1 passed
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/SealButton.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: add Bilimi seal and memorial overlay"
```

---

### Task 4: 实现推荐判断规则与奏折腔评论生成

**Files:**
- Create: `src/renderer/src/features/recommendation/recommendationRules.ts`
- Create: `src/renderer/src/features/recommendation/recommendationRules.test.ts`
- Create: `src/renderer/src/features/comments/commentComposer.ts`
- Create: `src/renderer/src/features/comments/commentComposer.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 先写推荐规则和评论生成的失败测试**

```ts
// src/renderer/src/features/recommendation/recommendationRules.test.ts
import { describe, expect, it } from 'vitest'
import { describeRecommendation } from './recommendationRules'

describe('describeRecommendation', () => {
  it('marks funny content as 可赏', () => {
    expect(describeRecommendation('funny')).toEqual({
      badge: '可赏',
      summary: '此物颇能解闷，失仪而不鄙。'
    })
  })

  it('marks suspicious content as 慎入', () => {
    expect(describeRecommendation('suspicious')).toEqual({
      badge: '慎入',
      summary: '此条市气过浓，疑有商贩夹带。'
    })
  })
})
```

```ts
// src/renderer/src/features/comments/commentComposer.test.ts
import { describe, expect, it } from 'vitest'
import { composeMemorialComments } from './commentComposer'

describe('composeMemorialComments', () => {
  it('returns three memorial-style options for knowledge content', () => {
    const drafts = composeMemorialComments('knowledge', '如何高效背单词')

    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toContain('如何高效背单词')
    expect(new Set(drafts).size).toBe(3)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/features/recommendation/recommendationRules.test.ts src/renderer/src/features/comments/commentComposer.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/recommendation/recommendationRules.test.ts
FAIL  src/renderer/src/features/comments/commentComposer.test.ts
```

- [ ] **Step 3: 实现推荐规则和评论生成器**

```ts
// append to src/shared/types.ts
export type RecommendationKind = 'funny' | 'knowledge' | 'story' | 'suspicious'

export type RecommendationLabel = {
  badge: '可赏' | '可阅' | '请陛下过目' | '慎入'
  summary: string
}
```

```ts
// src/renderer/src/features/recommendation/recommendationRules.ts
import type { RecommendationKind, RecommendationLabel } from '@shared/types'

const MAP: Record<RecommendationKind, RecommendationLabel> = {
  funny: {
    badge: '可赏',
    summary: '此物颇能解闷，失仪而不鄙。'
  },
  knowledge: {
    badge: '可阅',
    summary: '此条可增广见闻，宜列案头。'
  },
  story: {
    badge: '请陛下过目',
    summary: '此段剧情渐起，不敢先泄其机。'
  },
  suspicious: {
    badge: '慎入',
    summary: '此条市气过浓，疑有商贩夹带。'
  }
}

export function describeRecommendation(kind: RecommendationKind): RecommendationLabel {
  return MAP[kind]
}
```

```ts
// src/renderer/src/features/comments/commentComposer.ts
import type { RecommendationKind } from '@shared/types'

export function composeMemorialComments(kind: RecommendationKind, title: string): string[] {
  if (kind === 'knowledge') {
    return [
      `此条《${title}》颇可增识，臣已列案头，敬呈陛下过目。`,
      `臣观《${title}》言之有据，可资见闻，不敢私藏，谨呈御览。`,
      `《${title}》条理尚明，足供一阅，臣特录此札，恭请圣裁。`
    ]
  }

  if (kind === 'funny') {
    return [
      `此条《${title}》颇能解闷，臣观后险些失仪，特请陛下同览。`,
      `《${title}》虽轻，却不至鄙，臣谨以此物进呈陛下。`,
      `臣不敢独享《${title}》这点笑意，特备薄礼，恭呈御览。`
    ]
  }

  if (kind === 'suspicious') {
    return [
      `《${title}》似有市气，臣先加红签，谨请陛下慎入。`,
      `臣观《${title}》略带夹带之意，先行呈报，以候圣断。`,
      `此条《${title}》疑似商贩借路入殿，臣不敢擅断，谨请御览。`
    ]
  }

  return [
    `《${title}》铺陈渐稳，臣不敢泄机，谨请陛下亲览。`,
    `此条《${title}》尚有后劲，臣先呈折，不敢多言。`,
    `臣谨录《${title}》于案头，后文如何，仍待陛下自断。`
  ]
}
```

- [ ] **Step 4: 重新运行测试**

Run:

```bash
npm run test -- src/renderer/src/features/recommendation/recommendationRules.test.ts src/renderer/src/features/comments/commentComposer.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/recommendation/recommendationRules.test.ts
PASS  src/renderer/src/features/comments/commentComposer.test.ts
3 passed
```

- [ ] **Step 5: 提交**

```bash
git add src/shared/types.ts src/renderer/src/features/recommendation/recommendationRules.ts src/renderer/src/features/recommendation/recommendationRules.test.ts src/renderer/src/features/comments/commentComposer.ts src/renderer/src/features/comments/commentComposer.test.ts
git commit -m "feat: add recommendation and memorial comment rules"
```

---

### Task 5: 实现本地状态、偏好记录与专用收藏夹配置存储

**Files:**
- Create: `electron/main/store.ts`
- Create: `src/renderer/src/features/state/assistantState.ts`
- Create: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: 先写状态更新测试**

```ts
// src/renderer/src/features/state/assistantState.test.ts
import { describe, expect, it } from 'vitest'
import { createInitialAssistantState, reduceAssistantState } from './assistantState'

describe('assistant state', () => {
  it('records funny likes into local preferences', () => {
    const next = reduceAssistantState(createInitialAssistantState(), {
      type: 'record-feedback',
      kind: 'funny',
      action: '赏'
    })

    expect(next.preferenceCounts.funny).toBe(1)
    expect(next.lastAction).toBe('赏')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/features/state/assistantState.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/state/assistantState.test.ts
Error: Failed to resolve import "./assistantState"
```

- [ ] **Step 3: 实现状态 reducer 和本地存储桥**

```ts
// electron/main/store.ts
import Store from 'electron-store'

type PersistedAssistantState = {
  favoritesFolderName: string
  preferenceCounts: Record<string, number>
}

export const desktopStore = new Store<PersistedAssistantState>({
  defaults: {
    favoritesFolderName: 'Bilimi 内库',
    preferenceCounts: {}
  }
})
```

```ts
// src/renderer/src/features/state/assistantState.ts
import type { AssistantAction, RecommendationKind } from '@shared/types'

export type AssistantState = {
  lastAction: AssistantAction | null
  preferenceCounts: Record<RecommendationKind, number>
}

export type AssistantStateEvent = {
  type: 'record-feedback'
  kind: RecommendationKind
  action: AssistantAction
}

export function createInitialAssistantState(): AssistantState {
  return {
    lastAction: null,
    preferenceCounts: {
      funny: 0,
      knowledge: 0,
      story: 0,
      suspicious: 0
    }
  }
}

export function reduceAssistantState(
  state: AssistantState,
  event: AssistantStateEvent
): AssistantState {
  if (event.type === 'record-feedback') {
    return {
      lastAction: event.action,
      preferenceCounts: {
        ...state.preferenceCounts,
        [event.kind]: state.preferenceCounts[event.kind] + 1
      }
    }
  }

  return state
}
```

```ts
// electron/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences'),
  savePreferences: (preferenceCounts: Record<string, number>) =>
    ipcRenderer.invoke('assistant:save-preferences', preferenceCounts)
})
```

- [ ] **Step 4: 重新运行测试**

Run:

```bash
npm run test -- src/renderer/src/features/state/assistantState.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/state/assistantState.test.ts
1 passed
```

- [ ] **Step 5: 提交**

```bash
git add electron/main/store.ts electron/preload/index.ts src/renderer/src/features/state/assistantState.ts src/renderer/src/features/state/assistantState.test.ts
git commit -m "feat: add local assistant state and preference persistence"
```

---

### Task 6: 实现 `赏 / 赐 / 表 / 阅` 自动化编排与页面操作层

**Files:**
- Create: `src/renderer/src/features/actions/pageAutomation.ts`
- Create: `src/renderer/src/features/actions/actionExecutor.ts`
- Create: `src/renderer/src/features/actions/actionExecutor.test.ts`
- Create: `src/renderer/src/features/assistant/CoinPrompt.tsx`
- Create: `src/renderer/src/features/assistant/CommentChooser.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`

- [ ] **Step 1: 先写动作执行测试**

```ts
// src/renderer/src/features/actions/actionExecutor.test.ts
import { describe, expect, it, vi } from 'vitest'
import { executeAssistantAction } from './actionExecutor'

describe('executeAssistantAction', () => {
  it('runs 点赞 + 收藏 for 赏', async () => {
    const runScript = vi.fn().mockResolvedValue({ ok: true, steps: ['like', 'favorite'] })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'Bilimi 内库'
    })

    expect(runScript).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['like', 'favorite'])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/features/actions/actionExecutor.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/actions/actionExecutor.test.ts
Error: Failed to resolve import "./actionExecutor"
```

- [ ] **Step 3: 实现自动化脚本封装、动作编排和两个弹层组件**

```ts
// src/renderer/src/features/actions/pageAutomation.ts
import type { AssistantAction } from '@shared/types'

export function buildAutomationScript(
  action: AssistantAction,
  favoritesFolderName: string,
  coinCount?: 1 | 2
): string {
  return `
    (() => {
      const steps = [];
      if ('${action}' === '赏' || '${action}' === '赐') steps.push('like');
      if ('${action}' === '赏' || '${action}' === '赐') steps.push('favorite');
      if ('${action}' === '赐') steps.push('coin:${coinCount ?? 1}');
      return { ok: true, steps, favoritesFolderName: '${favoritesFolderName}' };
    })();
  `
}
```

```ts
// src/renderer/src/features/actions/actionExecutor.ts
import type { AssistantAction } from '@shared/types'
import { buildAutomationScript } from './pageAutomation'

type ExecuteAssistantActionArgs = {
  action: AssistantAction
  favoritesFolderName: string
  runScript: (script: string) => Promise<{ ok: boolean; steps: string[] }>
  coinCount?: 1 | 2
}

export async function executeAssistantAction(args: ExecuteAssistantActionArgs) {
  if (args.action === '阅') {
    return { ok: true, steps: [] }
  }

  const script = buildAutomationScript(args.action, args.favoritesFolderName, args.coinCount)
  return args.runScript(script)
}
```

```tsx
// src/renderer/src/features/assistant/CoinPrompt.tsx
type CoinPromptProps = {
  onChoose: (coinCount: 1 | 2) => void
  onCancel: () => void
}

export function CoinPrompt({ onChoose, onCancel }: CoinPromptProps) {
  return (
    <div className="assistant-dialog">
      <p>陛下意欲赐几枚铜钱？</p>
      <button type="button" onClick={() => onChoose(1)}>赐一枚</button>
      <button type="button" onClick={() => onChoose(2)}>赐两枚</button>
      <button type="button" onClick={onCancel}>暂缓</button>
    </div>
  )
}
```

```tsx
// src/renderer/src/features/assistant/CommentChooser.tsx
type CommentChooserProps = {
  drafts: string[]
  onSelect: (draft: string) => void
  onCancel: () => void
}

export function CommentChooser({ drafts, onSelect, onCancel }: CommentChooserProps) {
  return (
    <div className="assistant-dialog">
      <p>臣已拟好三条，请陛下择其一。</p>
      {drafts.map((draft) => (
        <button key={draft} type="button" onClick={() => onSelect(draft)}>
          {draft}
        </button>
      ))}
      <button type="button" onClick={onCancel}>朕再想想</button>
    </div>
  )
}
```

```tsx
// modify the action area inside src/renderer/src/features/assistant/MemorialPanel.tsx
<div className="memorial-panel__actions">
  <button type="button" data-action="赏">赏</button>
  <button type="button" data-action="赐">赐</button>
  <button type="button" data-action="表">表</button>
  <button type="button" data-action="阅">阅</button>
</div>
```

- [ ] **Step 4: 重新运行测试**

Run:

```bash
npm run test -- src/renderer/src/features/actions/actionExecutor.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/actions/actionExecutor.test.ts
1 passed
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/features/actions/pageAutomation.ts src/renderer/src/features/actions/actionExecutor.ts src/renderer/src/features/actions/actionExecutor.test.ts src/renderer/src/features/assistant/CoinPrompt.tsx src/renderer/src/features/assistant/CommentChooser.tsx src/renderer/src/features/assistant/MemorialPanel.tsx
git commit -m "feat: add assistant action execution flow"
```

---

### Task 7: 将推荐、评论、动作和本地状态接入主界面

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Create: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: 先写应用级整合测试**

```tsx
// src/renderer/src/App.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'

describe('App integration', () => {
  it('opens the memorial panel and shows the recommendation summary', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText(/此物颇能解闷/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
npm run test -- src/renderer/src/App.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/App.test.tsx
TestingLibraryElementError: Unable to find an element with the text /此物颇能解闷/
```

- [ ] **Step 3: 完成主界面 wiring**

```tsx
// src/renderer/src/features/browser/BiliWebview.tsx
import { useMemo, useRef } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'

export function BiliWebview() {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const model = useMemo(() => createBrowserSurfaceModel(), [])

  return (
    <webview
      ref={(node) => {
        ref.current = node
      }}
      id="bilimi-webview"
      className="browser-surface"
      src={model.src}
      partition={model.partition}
      allowpopups={model.allowpopups}
    />
  )
}
```

```tsx
// src/renderer/src/features/assistant/AssistantOverlay.tsx
import { useMemo, useState } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { executeAssistantAction } from '../actions/actionExecutor'
import { describeRecommendation } from '../recommendation/recommendationRules'
import { MemorialPanel } from './MemorialPanel'
import { SealButton } from './SealButton'

const CURRENT_KIND = 'funny' as const
const CURRENT_TITLE = '早八生存实录'

export function AssistantOverlay() {
  const [open, setOpen] = useState(false)
  const recommendation = useMemo(() => describeRecommendation(CURRENT_KIND), [])
  const commentDrafts = useMemo(() => composeMemorialComments(CURRENT_KIND, CURRENT_TITLE), [])

  return (
    <div className="assistant-overlay">
      {open ? (
        <MemorialPanel
          recommendation={recommendation}
          commentDrafts={commentDrafts}
          onAction={async (action) =>
            executeAssistantAction({
              action,
              favoritesFolderName: 'Bilimi 内库',
              runScript: async () => ({ ok: true, steps: [] })
            })
          }
          onClose={() => setOpen(false)}
        />
      ) : (
        <SealButton onOpen={() => setOpen(true)} />
      )}
    </div>
  )
}
```

```tsx
// src/renderer/src/features/assistant/MemorialPanel.tsx
import type { AssistantAction, RecommendationLabel } from '@shared/types'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  onAction: (action: AssistantAction) => Promise<unknown>
  onClose: () => void
}

export function MemorialPanel({ recommendation, onAction, onClose }: MemorialPanelProps) {
  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
        <div className="memorial-panel__header">
          <span>今日所陈</span>
          <h2>御前待阅折</h2>
          <span>司礼监掌印官谨呈</span>
        </div>
        <div className="memorial-panel__body">
          <aside className="memorial-panel__meta">
            <p>题名：早八生存实录</p>
            <p>类目：解闷小品</p>
            <p>签语：{recommendation.badge}</p>
          </aside>
          <div className="memorial-panel__copy">
            <p>{recommendation.summary}</p>
            <p>臣谨以此条进呈陛下，若准其留档，臣便代行轻赏。</p>
          </div>
          <aside className="memorial-panel__verdict">
            <h3>朱批</h3>
            <p>此物可先过目，不必骤然重赐。</p>
          </aside>
          <div className="memorial-panel__actions">
            {(['赏', '赐', '表', '阅'] as const).map((action) => (
              <button key={action} type="button" onClick={() => void onAction(action)}>
                {action}
              </button>
            ))}
          </div>
        </div>
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          合折
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 跑完整测试并构建**

Run:

```bash
npm run test
npm run build
```

Expected:

```text
All tests passed
electron-vite v3 build completed successfully
```

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/browser/BiliWebview.tsx
git commit -m "feat: wire Bilimi MVP experience together"
```

---

## Self-Review Notes

### Spec coverage check

1. Electron 外壳、内嵌浏览、会话 partition：Task 1, Task 2
2. 收起印玺、展开奏折：Task 3
3. 推荐标签与轻量偏好：Task 4, Task 5, Task 7
4. `赏 / 赐 / 表 / 阅`：Task 6, Task 7
5. Bilimi 专用收藏夹名与专用归档：Task 1, Task 6
6. 本地状态与本地持久化：Task 5
7. 第一阶段不做周报月报：本计划未纳入

### Placeholder scan

已检查本计划，无 `TODO`、`TBD`、`later`、`implement later` 一类占位内容。

### Type consistency check

共享类型集中在 `src/shared/types.ts`，动作名统一为 `赏 / 赐 / 表 / 阅`，推荐类别统一为 `funny / knowledge / story / suspicious`。
