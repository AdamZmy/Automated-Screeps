# Screeps World 当前交接

- 唯一源码：`/Users/zmy/screepsworld/new-colony`；AdamZmy / shard1 / 活动分支frontier24；W21N26主房、W23N26辅房。
- 当前发布：game `2026-09-29.3` / v0.6.3。API备份/上传/17模块回读verified；仅main/workforce/mining变化。真实Game74026531/539与遥测74026560已核验新版本。
- Worker用户确认规则：按房间energyCapacityAvailable定标准身体；两房目标20WORK，矿工不计。W23容量1300→8+8+4（3只）；W21容量1800→10+10（2只）。融资不足等待，只缩目标尾槽。
- 实际数量74026539：W23仍11只旧碎片合20WORK，W21旧8+8+4三只合20。固定槽位缺失、queued为worker-work-cap、pending为空；两房能源满额仍未额外出生。目标workerCount不是实际人数。
- live/spawning/accepted及bootstrap共同占名义WORK，受伤不释放额度。旧碎片自然死亡，不逐只续代、不suicide；满池不提前重叠，死亡和孵化期间可以暂时不足。退休矿工让位、只送已有货、不转worker。
- 容量策略已在线生效；完整数量收敛和真实矿工交班仍需后续生命周期证据，不能称已完成线上收敛。
- 用户暂停的`screeps-world` automation仍PAUSED，不因发布恢复或新增监控。

## 已完成和验证

- .2 Hauler任务复用、每房一次物理核对、双端预约、标准半容量身体与期限续代继续保留；真实卸空终止旧趟（L008）。
- worker/upgrader/builder/repairman统一出生角色，Development仍按人数分配运行职责；有资源/有效任务连续工作，无新增动作轮休。
- `npm run test:worker`七组、API23项与diff通过。覆盖W23/W21自然收敛、标准融资、尾槽、受伤治疗、双Spawn有钱但额度不足、pending去重/释放、旧role、bootstrap、矿工让位/送完不再取货等。
- 独立worker_review最终只读复核通过并释放文件；没有调用API。完整npm test有此前builder/upgrader旧oracle，不记全绿。
- 74026540模块健康无error，spawn/creeps两房ok；纯新版本74026540–560窗口升级W21=19、W23=15.65/t。已有CPU告警仍在，不能宣称CPU收益或90%长期能效。
- 故障知识W006、正式回归与用户规则已保存；日志`operations/inspections/2026-09-29/2026-09-29T22-04-14Z-worker-work-6c07fb59dc03.json`保留原始起始身份。
- 本轮代码/记录仅本地保存并提交，GitHub未推送。上一聊天公开诊断发布曾被自动审批拒绝；不要将未同步Issue或/logs称已发布。遗留用户`tools/inspect-worker-pool.js`未提交。

## 归属与下一检查点

- 本轮root01a0ef23-5c14-7cc0-9930-d922406065d2；worker_review parent同root，已交付/释放。本轮部署已结束。
- 已核验上轮root01a0eb3c-2aea-77b0-b28c-69f63e2cc893 idle后才接管。下轮先核验owner，不因新协调树为空推断旧任务结束。
- Issue4保持verifying：观察自然死亡释放后的固定4/8/10WORK出生、名义总池≤20、真实升级/补给与矿工交班；最终W23三只/W21两只才验收数量收敛。新任务不要重造逐只小体续代。
- CPU/能源长期验证继续原Issue5等：完整无诊断20tick CPU窗、实际交付/升级/积压，能源完整300/1500/6000tick；不将短窗或自然减员作为因果收益。
- 不改已审核布局、Rampart停建、Ledger历史、Hauler融资策略或automation调度，除非用户另行要求。
