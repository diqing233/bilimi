# 旧收藏本轮标签总数设计

## 目标

本轮总览中的标签补取统计必须使用整轮口径，而不是只显示当前处于 `tagging` 状态的批次。当前数据应显示总数 2552、已补取 1370、待补取 1182；当前批次视图继续显示 500、370、130。

## 数据口径

1. 优先读取 `snapshot.tagEnrichment.scopes.wholeRun`，与扫描概览下方的整轮标签进度保持同一权威来源。
2. 没有范围统计时，回退到 `snapshot.tagEnrichment` 顶层统计，兼容较早快照。
3. 没有标签补取快照时，回退到全部 `snapshot.segments` 的 `itemCount`、`completedTagItemCount` 和 `pendingTagItemCount` 之和，兼容旧草稿。
4. 不修改当前批次视图、协调器统计、持久化格式或扫描流程。

## 验证

- 组件测试覆盖 6 批、整轮 2552 条、已完成 1370 条、待处理 1182 条。
- 确认旧的当前批次统计仍由 `OldFavoriteScanOverviewStep` 的 `currentSegment` 范围提供。
- 运行收藏整理相关渲染器测试和 Git 差异检查。

