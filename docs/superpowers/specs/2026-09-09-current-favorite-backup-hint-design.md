# 当前收藏夹备册提示设计

## 目标

当前视频卡片的“最佳匹配：分类（未备册）”只反映当前视频匹配到的收藏夹规则，不受其他收藏夹缺失状态影响。

## 方案

`FloatingAssistantApp` 已有当前分类结果 `currentKind`、当前账号启用规则 `activeFavoriteLedgers` 和 B 站状态快照 `favoriteLedgerStatus`。新增一个纯函数，根据 `currentKind` 找到对应规则，并仅在该规则被状态快照明确列入 `missingLedgerIds` 或 `unboundLedgerIds` 时返回缺失状态。状态快照为空或未验证时不显示“未备册”，避免未知状态误报。

不改变 B 站目录读取、绑定、备册、同步、持久化和其他页面的状态标签。

## 验收

- 当前规则已绑定、其他规则未备册时，不显示“（未备册）”。
- 当前规则列入 `missingLedgerIds` 或 `unboundLedgerIds` 时，显示“（未备册）”。
- 无状态快照或快照未验证时，不显示“（未备册）”。
- 相关单元测试与既有测试通过。
