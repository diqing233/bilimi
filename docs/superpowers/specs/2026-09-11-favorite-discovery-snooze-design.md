# 收藏夹发现提示“暂不提醒”设计

## 目标

在右侧 bilimi 掌库的只读发现提示中，在“查看详情”旁增加“暂不提醒”。用户点击后，当前 B 站账号的该类发现汇总提示持久隐藏；下一次收藏夹相关操作成功完成新的只读目录读取后，解除隐藏并显示最新结果。

## 行为

- 提示文案和“查看详情”保持现有行为；“暂不提醒”只隐藏汇总提示，不删除 `remoteObservations` 或 `boundRenameCandidates`。
- 隐藏状态按 B 站账号保存，写入现有 `favoriteAccountPreferences`。切换账号互不影响，应用重启后保持。
- 有效唤醒包括新建、重命名、删除、收藏夹页刷新和备册。只有对应流程成功取得并发布新的已验证只读目录结果时，才清除当前账号的隐藏标记。
- 刷新失败、非收藏夹页、账号不匹配、目录读取失败或未验证时不清除标记；失败也不重新显示旧提示。
- 清除标记与发布新发现结果在同一个成功发布点完成，避免出现空提示或旧结果闪现。
- 不改变 B 站写入、精确 ID 绑定、备册期间未绑定汇总隐藏、远端发现详情弹窗和现有远端草稿“不再提醒”机制。

## 代码边界

- `src/shared/types.ts`：为 `FavoriteAccountPreferences` 增加可选账号级隐藏字段。
- `src/renderer/src/features/state/assistantState.ts`：归一化该字段，兼容旧偏好。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：接收隐藏状态与回调，控制提示显示，并渲染“暂不提醒”。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`、`FloatingAssistantApp.tsx`：透传状态与回调。
- `src/renderer/src/App.tsx`：在手动发现成功发布和备册成功刷新点解除隐藏；提供账号级偏好保存回调。
- 对应单元、组件和 App 集成测试；需求账本记录代码位置、自动化证据与真实 Electron 待验收项。

## 数据流

1. App 从当前账号偏好读取 `favoriteDiscoveryNoticeDismissed`。
2. 发现状态存在且未隐藏时，掌库渲染浅蓝汇总提示。
3. 用户点击“暂不提醒”后，面板回调更新本地偏好并通过现有偏好 patch 持久化。
4. `publishManualFavoriteDiscovery` 或成功备册后的有效只读发现得到 `verified` 结果后，App 清除该账号字段、持久化并发布快照。

## 失败与兼容

旧版本没有字段时按 `false` 处理。持久化失败时保留当前 UI 隐藏状态并通过已有偏好保存错误路径处理，不触发 B 站操作；下一次完整偏好加载以持久化结果为准。

## 验收

- 自动化：组件显示/点击/隐藏、账号隔离、重启归一化、成功发现唤醒、失败不唤醒、备册成功唤醒均有测试。
- 真实 Electron：验证提示出现后重启仍隐藏；分别执行新建、重命名、删除、刷新、备册成功后重新出现最新提示；失败刷新不恢复旧提示；“查看详情”仍可用。
