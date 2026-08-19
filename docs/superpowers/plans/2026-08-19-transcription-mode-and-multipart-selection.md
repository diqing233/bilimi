# 札记单 P / 多 P 模式与多 P 全选外观 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将札记转写卡片的单 P / 多 P 原生下拉改为并列点击切换，并把多 P 临时选择面板的全选改为可在“全选/取消全选”之间切换的 bilimi 风格按钮。

**Architecture:** 继续复用现有 `transcriptionMode` React 临时状态、当前视频主卡点击和多 P 临时选择清单，不改变队列、档案、DeepSeek、B 站或批阅按钮。模式控制改成两个带 `aria-pressed` 的小按钮；多 P 工具栏根据当前可加入项和已选项计算一个动作标签，动作只更新临时选择集合。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library、现有 CSS token。

---

## 需求覆盖与不变边界

- 覆盖需求账本 `R001`、`R002`、`R005`、`R006`、`R007`，索引 `I001`、`I002`、`I003` 及 R007 对 R006 的范围修正。
- 单 P / 多 P：默认单 P；点击只切换本次模式；无原生 `select`、无下拉箭头；静止无常驻边框；悬停或键盘聚焦时显示边框/焦点；保留两项说明。
- 多 P 弹窗：全选只选择可加入项；全部可加入项已选时显示并执行取消全选；没有可加入项时按钮置灰；已选数量和提交按钮状态同步。
- 明确不改：批阅中的`赐 / 表`及其一枚/两枚、随机/选择控件；合集批量转写；队列/档案/DeepSeek/B 站行为；多 P 每行状态、重新转写和入队边界。

## 文件职责

| 文件 | 责任 |
| --- | --- |
| `src/renderer/src/features/notes/VideoNotesPanel.tsx` | 渲染模式切换按钮、计算多 P 全选/取消全选动作并更新临时选择。 |
| `src/renderer/src/features/notes/VideoNotesPanel.test.tsx` | 模式点击行为、无下拉、默认单 P、主卡触发读取、多 P 全选/取消全选回归。 |
| `src/renderer/src/styles.css` | 小项静止/悬停/焦点/选中样式和多 P bilimi 工具按钮样式。 |
| `src/renderer/src/styles.test.ts` | 防止旧下拉样式或常驻边框回归，锁定新类名和状态选择器。 |
| `docs/项目功能项目书.md` | 已更新的功能事实；本轮只验证并与实现保持一致。 |
| `docs/requirement-ledgers/2026-08-19-multipart-transcription-selection-and-mode-appearance.md` | 原文、索引、实施位置和验收证据。 |

### Task 1: 先写模式与全选的失败回归

**Files:**

- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 将模式测试改为并列按钮契约**

在现有“keeps single-P mode...”测试中，把 `combobox` 断言改为：

```ts
expect(screen.queryByRole('combobox', { name: '转写模式' })).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: '单 P' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByRole('button', { name: '多 P' })).toHaveAttribute('aria-pressed', 'false')
fireEvent.click(screen.getByRole('button', { name: '多 P' }))
expect(readMultipartVideo).not.toHaveBeenCalled()
expect(screen.getByRole('button', { name: '多 P' })).toHaveAttribute('aria-pressed', 'true')
fireEvent.click(screen.getByRole('button', { name: /转写音频/ }))
await waitFor(() => expect(readMultipartVideo).toHaveBeenCalledOnce())
```

同时断言两个模式按钮带有非空 `title`，而主卡仍只在点击后读取分 P。

- [x] **Step 2: 添加全选/取消全选失败回归**

在多 P 弹窗测试中断言：

```ts
const selectAll = screen.getByRole('button', { name: '全选' })
fireEvent.click(selectAll)
expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()
expect(screen.getByRole('checkbox', { name: '选择 P2' })).toBeChecked()
fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
expect(screen.getByRole('button', { name: '全选' })).toBeInTheDocument()
expect(screen.getByRole('checkbox', { name: '选择 P2' })).not.toBeChecked()
```

保留已有 P1 忙碌不可选断言，并增加全选按钮只作用于可加入 P 的断言。

- [x] **Step 3: 添加无可加入项的禁用回归**

构造所有分 P 均忙碌或已归档的快照，断言唯一的`全选`按钮 `toBeDisabled()`，且不调用入队回调。

- [x] **Step 4: 运行红灯测试**

Run:

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/styles.test.ts
```

Expected: FAIL，因为当前实现仍渲染原生 `select`、只提供固定`全选`，并且没有新的模式/全选样式选择器。

### Task 2: 实现模式切换与多 P 动作状态

**Files:**

- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`

- [x] **Step 1: 用两个按钮替换原生 select**

保留父级阻止冒泡的 `label`，将 `select` 替换为：

```tsx
<div className="video-notes__transcription-mode" aria-label="转写模式">
  <button
    type="button"
    className="video-notes__transcription-mode-option"
    aria-pressed={transcriptionMode === 'single'}
    title="单 P：只将当前正在播放的这一 P 视频加入转写队列"
    disabled={generationBusy || enqueueingTranscription || multipartLoading}
    onClick={() => setTranscriptionMode('single')}
  >单 P</button>
  <span className="video-notes__transcription-mode-separator" aria-hidden="true">·</span>
  <button
    type="button"
    className="video-notes__transcription-mode-option"
    aria-pressed={transcriptionMode === 'multi'}
    title="多 P：先选择多个分 P，再批量加入转写队列"
    disabled={generationBusy || enqueueingTranscription || multipartLoading}
    onClick={() => setTranscriptionMode('multi')}
  >多 P</button>
</div>
```

按钮事件只设置 `transcriptionMode`；读取分 P 仍只由既有主卡 `handleGenerate()` 的多 P 分支触发。

- [x] **Step 2: 计算多 P 工具栏动作**

在 `renderMultipartDialog()` 现有 `selectableCount` 旁计算：

```ts
const selectableParts = multipartSnapshot?.parts.filter((part) => !partIsBusy(part) && !partIsArchived(part)) ?? []
const selectedAvailableCount = selectableParts.filter((part) => selectedMultipartParts.includes(part.number)).length
const allAvailableSelected = selectableParts.length > 0 && selectedAvailableCount === selectableParts.length
const multipartSelectionActionLabel = allAvailableSelected ? '取消全选' : '全选'
```

动作处理必须只增删 `selectableParts.map(part => part.number)`，不能清除已归档重转写选择以外的行状态，也不能改变队列或档案。

- [x] **Step 3: 运行绿灯测试**

Run:

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: 模式和全选行为测试通过；样式测试暂时仍可能失败，直到 Task 3 完成。

### Task 3: 实现 bilimi 小项视觉与回归样式

**Files:**

- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 添加模式小项样式**

将旧的 `.video-notes__transcription-mode select` 规则替换为：父级不显示常驻边框；option 使用透明背景和透明边框；`[aria-pressed="true"]` 使用主色和短下划线；`:hover`、`:focus-visible` 才显示轻量边框；separator 使用 muted 色且不参与交互。

- [x] **Step 2: 使用现有 bilimi 控件 token 样式全选按钮**

为多 P 工具栏按钮使用现有 porcelain primary/ice 色系和统一圆角、字体、焦点轮廓；状态只通过按钮文字切换，不增加第三个控件。

- [x] **Step 3: 锁定 CSS 契约并运行样式测试**

在 `styles.test.ts` 断言新类名、选中/悬停/聚焦选择器存在，并断言旧 `video-notes__transcription-mode select` 样式不再作为模式入口。

Run:

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/styles.test.ts
```

Expected: PASS。

### Task 4: 账本回填、全套验证与界面验收

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-19-multipart-transcription-selection-and-mode-appearance.md`
- No modification: `src/renderer/src/features/assistant/*` 批阅控件、合集批量转写相关代码、Electron 主进程队列。

- [x] **Step 1: 运行相关回归**

```powershell
npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/styles.test.ts src/renderer/src/features/notes/videoNoteMultipart.test.ts
npm run build
```

- [x] **Step 2: 做开发版界面验收**

在 Electron 开发版核对：札记转写卡片默认单 P；静止无箭头和常驻边框；点击多 P 只切换文字状态；鼠标悬停/键盘聚焦显示边框与提示；点击转写音频后才读取多 P；多 P 弹窗的全选/取消全选只影响可加入项；关闭弹窗或切换视频恢复单 P；批阅按钮外观和行为未变化。

- [x] **Step 3: 回填账本证据并检查范围**

逐条填写 `I001`、`I002`、`I003`、R005、R006、R007 的代码位置、自动化测试和界面结果；对 R007 明确记录批阅按钮和合集批量转写未修改。

- [x] **Step 4: 提交本轮**

只提交本轮项目书、当前需求账本、计划、札记组件/样式及对应测试；保留其他未跟踪主题账本，不纳入本次提交。
