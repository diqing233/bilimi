# 小咪悬浮说明 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小咪悬浮窗按钮提供可恢复、反映当前设置的对话框说明，并压缩对话发送区布局。

**Architecture:** 在 `PalaceMaidPetApp` 中新增独立的鼠标悬浮预览状态，使其优先于常驻宠物提示显示，离开时直接清除以恢复原状态。静态快捷项说明存放在共享快捷项定义中，投币和弹幕说明在渲染端结合当前偏好动态生成。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、CSS

---

### Task 1: 锁定悬浮说明行为

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`

- [ ] 添加测试，覆盖全部快捷项说明、投币数量、弹幕模式、菜单表情、尺寸按钮、小咪本体 5 秒提示和离开恢复。
- [ ] 运行 `npm test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`，确认因功能缺失而失败。

### Task 2: 实现可恢复悬浮预览

**Files:**
- Modify: `src/shared/petHoverShortcuts.ts`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`

- [ ] 为共享快捷项补充实际效果说明。
- [ ] 新增独立悬浮预览状态和 5 秒计时器。
- [ ] 为业务、菜单、尺寸和小咪本体按钮接入鼠标进入/离开处理，移除原生 `title` 与键盘聚焦提示。
- [ ] 运行组件测试并确认通过。

### Task 3: 调整发送区布局

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] 添加失败的样式与结构测试，要求输入框和紧凑发送按钮同排。
- [ ] 增加输入操作行容器并实现横向布局。
- [ ] 运行相关测试并确认通过。

### Task 4: 整体验证并提交

**Files:**
- Test: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Test: `src/renderer/src/styles.test.ts`

- [ ] 运行相关测试、完整测试和构建。
- [ ] 检查差异，不纳入用户已有的 `commentComposer` 修改。
- [ ] 将本需求的设计、实现与测试整体提交一次 Git commit。
