# Screeps World 当前交接

- 唯一源码：`/Users/zmy/screepsworld/new-colony`；账号 AdamZmy，shard1，活动分支 `frontier24`，主房 W21N26，辅房 W23N26。
- 当前发布：game `2026-09-28.6`，版本代码已由 API 上传并逐模块回读；最近备份：`new-colony/backups/api-deploy-20260928T040645.480163Z/remote-code.json`。
- 17 个受管模块全部 `all_match=true`；GitHub 主分支最新提交 `94f3dd0`。
- 用户要求暂停的 `screeps-world` automation 继续保持 `PAUSED`，不得因发布自动恢复。

## 本轮已完成

- 按已确认设计拆分 Colony、Mining、Development、Logistics、Workforce、Defense、Links、Movement 等职责；统一出生、施工、资源意图和异常隔离。
- Hauler 仅使用 `memory.haul.state = idle | pickup | deliver`，任务包含 source、destination、amount、pickupAmount、priority、expires 和本 tick intent；旧 `loaded/haulPickup/haulDelivery/withdrawnFrom` 迁移后不再保留。
- 物流使用共享 tick board、双端数量预约、货物优先、Storage 普通来源、完整两段路线、卸货口租约和下一 tick 实际库存核对。
- Workforce 统一 spawnCreep、岗位/slot 去重、期限与等待、关键出生保护和多 Spawn 共享能源；Development 统一施工入口、维修优先和 overflowUpgrade 无停车位回归。
- 共享查询、路径/路由、身体候选、物流目标和卸货几何均有边界缓存；空车无任务时跳过 no-op 执行，但新 sink/source 会使 fixture 快照失效并重新分配。

## 验证与线上状态

- `npm test` 全部通过：game、layout、API、operations、diagnostics、policy；Node 语法及 diff 检查通过。
- 线上 .6 模块错误为空。状态快照显示主房 RCL5、辅房 RCL2，升级和运输仍在运行；Hauler 线上状态为 idle/pickup/deliver，旧标记为 0。
- .6 性能窗口 `73991822–73991840` 收到 17/20 个样本，平均 `19.5677`、峰值 `23.1396` CPU/tick、bucket `14`。存在缺测，因此只记录为部分窗口，不宣称长期稳定性能。
- 运行日志：`operations/inspections/2026-09-28/2026-09-28T03-15-24Z-hauler-d79b92fba8c0.json`；Issue #13 为已完成的本轮重构记录。

## 后续边界

- 长期 CPU、能源利用率、源侧积压和扩张经济性继续由既有巡检问题跟踪；不要用短窗口替代完整 300/1500/6000 tick 证据。
- 不修改已审核布局、Rampart 停建策略、Ledger 历史口径或 automation 调度，除非用户另行要求。
