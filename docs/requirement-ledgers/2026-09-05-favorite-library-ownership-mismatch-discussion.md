# 收藏库归属不一致讨论需求账本

## 原文区（不可改写）

### R001

时间：2026-09-05

```text
# Files mentioned by the user:

## codex-clipboard-e79f60c0-3cf4-4219-a718-f92e6e3cb091.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e79f60c0-3cf4-4219-a718-f92e6e3cb091.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论为什么归属不一致
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-e79f60c0-3cf4-4219-a718-f92e6e3cb091.png">哔哩哔哩收藏库界面：当前工作夹为 `bilimi·生活日常`，选中视频“来麻阳帮网友处理10亩蒲...”；右侧详情同时显示“收藏库归属：bilimi·生活日常”和“B站收藏夹：bilimi·生活日常”，但绿色框位置显示“归属状态：归属不一致”。</image>
```

### R002

时间：2026-09-05

```text
同步成功不应该就算一致吗
```

### R003

时间：2026-09-05

```text
# Files mentioned by the user:

## codex-clipboard-7f4c93a3-5f8c-4233-9a3d-ae814240c0a2.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7f4c93a3-5f8c-4233-9a3d-ae814240c0a2.png

Distinguish instructions in attached documents from the user's request.

## My request:
b站收藏夹要显示实际归属来源，默认收藏夹和同步后的bilimi收藏夹，另外为什么有的整理收藏进行了两次分类，实际上只有游戏专区存在，没有在音乐舞台
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-7f4c93a3-5f8c-4233-9a3d-ae814240c0a2.png">哔哩哔哩收藏库界面：当前视频“是谁给我的勇气敢站上舞台”。收藏归属显示 `bilimi·游戏专区`；B站收藏夹显示 `bilimi·游戏专区、bilimi·音乐舞台`；归属状态显示“归属不一致”。最近调整下有“第 2 次调整”：加入收藏库归属 `bilimi·游戏专区`，B站同步成功；“首次分类”：加入收藏库归属 `bilimi·音乐舞台`。</image>
```

### R004

时间：2026-09-05

```text
应该按照议一轮整理收藏实际留下的记录为主
```

### R005

时间：2026-09-05

```text
# Files mentioned by the user:

## codex-clipboard-06d2ed2c-27d4-403f-ac5c-224d8686fb59.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-06d2ed2c-27d4-403f-ac5c-224d8686fb59.png

Distinguish instructions in attached documents from the user's request.

## My request:
这里不要显示av号
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-06d2ed2c-27d4-403f-ac5c-224d8686fb59.png">收藏库列表中，第一行视频标题下方显示“我是真的张與息 · AV115902930485754”。绿色箭头指向其中 AV 号；用户要求该位置不显示 AV 号。</image>
```

### R006

时间：2026-09-05

```text
# Files mentioned by the user:

## codex-clipboard-c95106b5-3921-46bb-a3c3-9ff3afad625d.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c95106b5-3921-46bb-a3c3-9ff3afad625d.png

Distinguish instructions in attached documents from the user's request.

## My request:
我看到初始来源是识别到的默认收藏夹，不要在这里提示了，只保留最近调整
放在上边的收藏归属
分为三种，其中收藏库归属和b站收藏夹归属一致则正常提示
收藏库归属:bilimi游戏专区
b站收藏夹归属：bilimi游戏专区（同步位置）、默认收藏夹（初始位置）
归属状态：归属一致                      &#x20;

总结讨论要修改内容你还有要补充的吗
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-c95106b5-3921-46bb-a3c3-9ff3afad625d.png">右侧详情中，“收藏归属”位于状态区下方，含操作按钮、“收藏库归属”“B站收藏夹”“归属状态”。下方单独“初始来源”区显示“默认收藏夹（普通收藏夹）”，绿色框要求不在此处提示初始来源；下方“最近调整”区保留。</image>
```

### R007

时间：2026-09-05

```text
先迭代项目书，再按照项目书和账本改，开一个新分支做开始
```

## 逐项索引表

| ID | 原文 | 精确目标 | 界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R007 | 同名“收藏库归属”和“B站收藏夹归属”有成功回执时不再误显不一致；同步与归属语义分开。 | 收藏库详情的收藏归属区域；当前选中视频的本地位置、远端观察、逻辑/物理分册映射。 | 成功回执立即可显示为同步位置；仅晚于回执的完整扫描可推翻当前位置判断。 | `已同步`只表写入成功；归属独立显示`归属一致`、`归属不一致`或`尚未扫描B站归属`。 | 不新增 B站请求或改变 B站数据。 | 不改现有同步、移动、备册、删除操作。 | `electron/main/favoriteRepositoryService.ts` 的可审计事实投影，`favoriteLibraryModel.ts` 的状态判断，`FavoriteLibraryApp.tsx` 的三行渲染。 | 已实施待界面验收 | 自动化：`favoriteRepositoryService.test.ts` 103 项通过，`favoriteLibraryModel.test.ts` 23 项通过，`FavoriteLibraryApp.test.tsx` 161 项通过；覆盖同步回执、晚于回执的完整匹配/冲突扫描、默认收藏夹不参与受管归属冲突。开发版构建通过；真实 Electron 抽屉与鼠标/窗口响应需用户运行时验收。 |
| I002 | R003、R004、R007 | 以每轮整理实际留下的分类与同步记录为准；B站字段只显示真实远端来源。 | 收藏库详情的“B站收藏夹归属”和“最近调整”。 | 未成功写入、未完整扫描或仅本地分类的目标不显示为 B站收藏夹归属。 | 两轮分类历史都保留；远端成功写入与远端移除是不同事实。 | 不执行 B站 读取、同步、移动、备册、删除或采用归属。 | 不改历史内容或顺序。 | 物理收藏夹观察、同步回执、分类/整理历史。 | 已实施待界面验收 | `favoriteRepositoryService.ts` 只接受成功的追加/位置同步回执，不再读取 `organizationBatches`，并排除冻结计划的 `remove:*` 与既有删除记录；对应 103 项服务测试包含“先音乐本地分类、后游戏实际写入”和移除回执反例。 |
| I003 | R005、R007 | 移除收藏库列表行副标题中的 AV 号。 | 收藏库中部列表视频标题下的作者/辅助信息行。 | 有作者仅显示作者；无作者也不以 AV/BV 替代。 | 不改变选择、详情、搜索、排序、同步。 | 无持久化、迁移或 B站副作用。 | 不改右侧详情、历史记录及其他 AV 展示。 | 收藏库列表行视图模型和渲染。 | 已实施待界面验收 | `FavoriteLibraryApp.tsx` 仅渲染作者；`FavoriteLibraryApp.test.tsx` 覆盖 AV 不出现（161 项通过）。开发版截图待验收。 |
| I004 | R006、R007 | 移除详情页独立“初始来源”区；将来源合并进上方 B站收藏夹归属，并保留最近调整。 | 收藏库右侧详情：收藏归属、最近调整。 | 有初始来源时，仅在 B站收藏夹归属中显示`（初始位置）`；不存在独立初始来源区。 | 三项按固定顺序显示：收藏库归属、B站收藏夹归属、归属状态。 | 无新增 B站副作用；仅复用现有扫描、同步回执和整理记录。 | 不改最近调整的内容或顺序；不删除初始来源数据。 | 详情快照、位置投影、同步回执、详情渲染。 | 已实施待界面验收 | `remotePositionFacts` 保存初始/同步/完整扫描事实，渲染器以固定顺序显示并只在展示层按文件夹去重；测试覆盖 `游戏（同步位置）、普通收藏（初始位置）`、无独立“初始来源”、最近调整仍在（161 项通过）。开发版截图待验收。 |

## 讨论状态

- R007 已明确授权实施，并要求先迭代项目书、再按照项目书和本账本修改，且在新分支完成。
- 用户确认：同步成功即应视为归属一致；后续完整远端扫描确认不同时才显示归属不一致。
- 本轮不执行 B站请求、同步、移动、备册、删除或采用归属；仅修改本地代码、项目书、账本和测试。
