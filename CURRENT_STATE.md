# Screeps World 当前交接

- 唯一源码：`/Users/zmy/screepsworld/new-colony`；账号 AdamZmy，shard1，活动分支 `frontier24`，主房 W21N26，辅房 W23N26。
- 当前发布：game `2026-09-28.7`，版本代码已由 API 上传并逐模块回读；本轮改动提交 `7a7d953`。
- 17 个受管模块全部 `all_match=true`；本轮增加有界 Hauler 静态路线缓存、delivery port 短租约保留、`reusePath:50`，空车无货等待仍按用户要求暂缓。
- 用户要求暂停的 `screeps-world` automation 继续保持 `PAUSED`，不得因发布自动恢复。

## 本轮已完成

- 按已确认设计拆分 Colony、Mining、Development、Logistics、Workforce、Defense、Links、Movement 等职责；统一出生、施工、资源意图和异常隔离。
- Hauler 仅使用 `memory.haul.state = idle | pickup | deliver`，任务包含 source、destination、amount、pickupAmount、priority、expires 和本 tick intent；旧 `loaded/haulPickup/haulDelivery/withdrawnFrom` 迁移后不再保留。
- 物流使用共享 tick board、双端数量预约、货物优先、Storage 普通来源、完整两段路线、卸货口租约和下一 tick 实际库存核对。
- Workforce 统一 spawnCreep、岗位/slot 去重、期限与等待、关键出生保护和多 Spawn 共享能源；Development 统一施工入口、维修优先和 overflowUpgrade 无停车位回归。
- 共享查询、路径/路由、身体候选、物流目标和卸货几何均有边界缓存；空车无任务时跳过 no-op 执行，但新 sink/source 会使 fixture 快照失效并重新分配。

## 验证与线上状态

- `npm test` 全部通过：game、layout、API、operations、diagnostics、policy；Node 语法及 diff 检查通过。
- 线上 .7 远端哈希全部匹配。状态快照显示主房 RCL5、辅房 RCL3，升级和运输仍在运行；Hauler 线上状态为 pickup/deliver，旧标记为 0。
- 切换后的快照已报告 `pathSearches` 1.1429/t、`haulRouteCacheHits` 0.0714/t、`portCacheHits` 9.3571/t；监控 Tick 在短观察期间未推进，长窗口 CPU 对比暂不下结论。
- .6 性能窗口 `73991822–73991840` 收到 17/20 个样本，平均 `19.5677`、峰值 `23.1396` CPU/tick、bucket `14`。存在缺测，因此只记录为部分窗口，不宣称长期稳定性能。
- 运行日志：`operations/inspections/2026-09-28/2026-09-28T03-15-24Z-hauler-d79b92fba8c0.json`；Issue #13 为已完成的本轮重构记录。

## 后续边界

- 长期 CPU、能源利用率、源侧积压和扩张经济性继续由既有巡检问题跟踪；不要用短窗口替代完整 300/1500/6000 tick 证据。
- 不修改已审核布局、Rampart 停建策略、Ledger 历史口径或 automation 调度，除非用户另行要求。
