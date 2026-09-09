# 需求账本：已备册收藏夹显示未备册

> 状态：已实施待界面验收。

## 原文区

### R001（2026-09-09）

附件截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-999c3859-7478-486f-848f-3d81e80108fd.png`

截图目标区域：

- 右侧小咪面板“当前视频”卡片；显示“搞笑杂谈”和“最佳匹配：搞笑杂谈（未备册）”。
- 中央 B 站视频页“又被你们学到了”。

用户原文：

```text
# Files mentioned by the user:

## codex-clipboard-999c3859-7478-486f-848f-3d81e80108fd.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-999c3859-7478-486f-848f-3d81e80108fd.png

Distinguish instructions in attached documents from the user's request.
## My request:
这个已经备册了，为什么显示未备册，没有读取收藏夹实际情况吗
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-999c3859-7478-486f-848f-3d81e80108fd.png">
```

### R002（2026-09-09）

用户原文：

```text
最佳匹配：搞笑杂谈（未备册）  这里改成只读取当前收藏夹规则实际备册情况
```

## 逐项索引表

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | 查明当前视频“最佳匹配：搞笑杂谈（未备册）”与用户认为已备册的实际收藏夹状态为何不一致，并确认应用是否读取了 B 站实际收藏夹目录。 | 右侧小咪“当前视频”卡片、收藏夹状态快照、B 站 `created/list-all` 目录读取和分类匹配链路。 | 仅当截图所示提示出现时显示；需区分本地规则状态、远端目录事实、缓存/降级状态。 | 只读调查完成；未执行备册、同步、创建、改名、删除或绑定。 | 未写入本地偏好、收藏库或 B 站；未因排查自动修复绑定。 | 未改变正常批阅、备册、同步、整理、删除和收藏夹写入流程。 | `FavoriteLedgerStatus`、`buildFavoriteLedgerStatusScript`、`readFavoriteLedgerStatus`、`hasMissingFavoriteLedgers`、视频分类匹配。 | 已实施待界面验收 | 代码核对确认 B 站目录读取使用 `created/list-all`、`credentials: include`、`cache: no-store`；当前账号仓库快照确认 `entertainment` 无正式绑定，因此原提示有数据依据，但旧提示判定范围过宽。 |
| R002 | 将“最佳匹配：搞笑杂谈（未备册）”改为只依据当前视频匹配到的收藏夹规则的实际备册状态，不因其他收藏夹未备册而显示该提示。 | `FloatingAssistantApp.tsx` 当前视频卡片 `favoriteProvisioningHint`；当前匹配规则与 `FavoriteLedgerStatus` 的对应关系。 | 仅当当前匹配规则本身经已验证状态快照确认为未备册/未绑定时显示状态提示；当前规则已实际备册时隐藏“（未备册）”；未知或未验证状态不显示括号。 | 状态刷新后按当前规则 ID 重新计算；全局任意缺失规则不再污染当前视频提示。 | 不改变 B 站收藏夹内容、绑定、同步和其他收藏流程；仅调整提示判定。 | 不修改其他页面的收藏夹状态标签和既有备册流程。 | `videoCategory`、分类匹配结果、`hasMissingCurrentFavoriteLedgerBinding`、`FavoriteLedgerStatus.missingLedgerIds/unboundLedgerIds/verified`。 | 已实施待界面验收 | 自动化：新增精确规则判定测试；聚焦测试 16/16 通过；完整测试 251 文件、4543 测试通过。真实 Electron 界面验收尚未完成。 |

## 调查证据（只读）

- `src/renderer/src/features/favorites/favoriteLedgerApi.ts:139-150` 的 `buildFavoriteLedgerStatusScript` 使用 B 站 `created/list-all`，并以 `credentials: 'include'`、`cache: 'no-store'` 读取当前账号目录；因此设计上会读取实际远端目录，不是只看本地名称。
- 同文件 `:500-523` 先用目录响应执行 `syncLedgerFolderIds`，再把启用且 `bindingState !== 'bound'` 的规则加入 `missingLedgerIds`。远端同名/同 ID 存在但没有正式绑定时，不会直接算“已备册”。
- `src/shared/favoriteLedgerBindingProjection.ts:17-56` 明确规定 repository 的正式 `physicalShards` 是绑定权威；没有 `bindingState='bound'` 的物理分册时，会清除旧的账号级远端字段并回到 `bindingState='unbacked'`。
- 当前本地账号 `3706984597555811` 的 repository generation `73ec1d15-2a99-42a5-89f3-e5052cf6c673`、revision `308` 中，默认逻辑夹 `entertainment`（`bilimi·搞笑杂谈`）为 `pending-reconcile`，没有对应正式 `physicalShards`；同一 generation 仅保留三个非默认自定义规则的正式物理分册。历史命令记录显示 `entertainment` 的正式分册在 revision `279` 被移除，revision `289` 曾用另一个远端 ID `4089797711` 重新登记，revision `307` 又被移除。
- 同一 repository snapshot 仍有旧的 `bilibili:4032813811` 镜像条目，但它不是当前 `physicalShards` 中的正式绑定记录；这说明“远端镜像/目录条目存在”和“当前规则已正式绑定”是两层不同事实。
- 右侧提示来自 `src/renderer/src/features/assistant/FloatingAssistantApp.tsx:869-873,3787,5668`：视频分类先得到 `entertainment`，随后 `hasMissingFavoriteLedgerBindings(...)` 只要状态快照含该规则的 `missingLedgerIds`，就把 `最佳匹配：搞笑杂谈（未备册）` 传给当前视频卡片。这个文案描述的是“当前规则不能用于 B 站写入”，不是对 B 站是否存在同名文件夹的单独断言。

### 当前结论

应用确实会读取 B 站实际收藏夹目录，但“已备册”还要求本地 repository 中存在该精确远端 ID 的正式物理分册绑定。当前账号对 `搞笑杂谈` 的正式绑定已在本地权威仓库中不存在/处于待对账，因此即使 B 站页面仍能看到同名收藏夹，或旧镜像里还留有远端条目，当前视频仍会显示“未备册”。目前没有证据表明本轮状态提示漏读了目录；更准确的描述是“远端文件夹可能存在，但当前 Bilimi 正式绑定已丢失或被此前解绑操作移除”。
