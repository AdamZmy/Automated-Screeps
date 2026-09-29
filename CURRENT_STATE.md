# Screeps World 当前交接

- 唯一源码：`/Users/zmy/screepsworld/new-colony`；账号 AdamZmy，shard1，活动分支 `frontier24`，主房 W21N26，辅房 W23N26。
- 当前发布：game `2026-09-29.2` / v0.6.2；API部署verified、17模块code-check all_match，真实运行tick74026440。本地代码2a46ae6/c0d9e68保留并提交此前已部署worker-pool改动。GitHub未推送，自动审批拒绝本轮诊断公开内容，待用户授权。
- Worker口径：两房workerWorkTarget/workerWork均20（74026400）；只统计升级/建设/维修worker，不含矿工。W21新鲜身体8+8+4=20，W23旧11个碎片worker合20，续代按缺口自然收敛，不suicide。
- 用户要求暂停的 `screeps-world` automation 继续保持 `PAUSED`，不得因发布自动恢复。

## 本轮已完成

- 按已确认设计拆分 Colony、Mining、Development、Logistics、Workforce、Defense、Links、Movement 等职责；统一出生、施工、资源意图和异常隔离。
- Hauler 仅使用 `memory.haul.state = idle | pickup | deliver`，任务包含 source、destination、amount、pickupAmount、priority、expires 和本 tick intent；旧 `loaded/haulPickup/haulDelivery/withdrawnFrom` 迁移后不再保留。
- 物流使用共享 tick board、双端数量预约、货物优先、Storage 普通来源、完整两段路线、卸货口租约和下一 tick 实际库存核对。
- Workforce 统一 spawnCreep、岗位/slot 去重、期限与等待、关键出生保护和多 Spawn 共享能源；Development 统一施工入口、维修优先和 overflowUpgrade 无停车位回归。
- 共享查询、路径/路由、身体候选、物流目标和卸货几何均有边界缓存；空车无任务时跳过 no-op 执行，但新 sink/source 会使 fixture 快照失效并重新分配。
- 本轮稳定任务直接复用、每房一次物理核对；同tick容量/货源/紧急优先仍核验。精确可达性heap缓存按结构身份/坐标/通行失效；卸货口共享占位/近场租约，占口试备用，idle仍让路。
- 标准Hauler保持半房容量/CARRY:MOVE=1:1；未来CARRY与串并行Spawn期限续代，仅实际期限到且标准买不起才应急。无主动淘汰。.2确认真实卸空后结束旧趟，不继承小订单（L008）。
- performance.logistics有8个嵌套self-time分项，roles/stages仍inclusive；20tick/60history不变。诊断工件已存本地，haulerProbe/haulerProfiler/apiSnapshot已清理且回读null。

## 验证与线上状态

- `npm run test:hauler`7组、missions/movement/planning、API23项与diff通过；独立审视复核.1/.2和5个结算边界通过。完整npm test仍有.7已有builder/upgrader旧oracle未迁移，不能记全绿。
- .7基线74026101–120（20样本/8车）：role2.5757、prepare0.7883、总16.1732CPU/t；.1首同8车窗role3.2531、prepare1.0739、总17.9207，没有验收性能收益。其后续代/补给与worker缺能外出改变负载，18/19样本和诊断窗排除。
- .2冷启仅9样本mean24.3173；最新74026422–440仍19样本mean18.2340、Hauler2.7885、prepare0.8936、bucket1。缺测且未低于基线，不能宣称CPU恢复；W21/W23升级19/14.4、stalled0。最新upgrader5.7329、Memory2.3602、ledger1.3128CPU/t，未扩大本轮修改范围。
- 运行日志：`operations/inspections/2026-09-28/2026-09-28T03-15-24Z-hauler-d79b92fba8c0.json`；Issue #13 为已完成的本轮重构记录。
- 本轮日志`operations/inspections/2026-09-29/2026-09-29T21-48-32Z-hauler-cpu-b61a8e5a6624.json`；报告`operations/diagnostics/2026-09-29-hauler-cpu-fix.md`；Issue5继续verifying（本地，未远程同步）。
- root01a0eb3c-2aea-77b0-b28c-69f63e2cc893；reviewer01a0ef23-5507-7c93-a6ac-7e6dc172cd59、workforce01a0ef23-e4ba-77e0-9629-6c2198f74fb3 parent均root，已交付释放并关闭。并行只读W23任务已结束，不修改/部署源码。

## 后续边界

- 长期 CPU、能源利用率、源侧积压和扩张经济性继续由既有巡检问题跟踪；不要用短窗口替代完整 300/1500/6000 tick 证据。
- 不修改已审核布局、Rampart 停建策略、Ledger 历史口径或 automation 调度，除非用户另行要求。
- 下一检查点：.2纯新完整无诊断窗口、实际交付/升级/积压和单车完整往返；不要把自然减员或短窗当作因果收益，不suicide、不恢复automation。遗留用户tools/inspect-worker-pool.js保持未提交。
