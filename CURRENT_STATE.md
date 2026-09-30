# Screeps World 当前交接

- 唯一源码new-colony；AdamZmy / shard1 / frontier24；不操作Arena。
- root=01a0f43a-9236-7b41-ba14-8022a98b399e active: API、evolution state/config、Issue14/4/7、CURRENT_STATE、本轮日志、Git/部署。
- 旧root01a0f41f及Issue owners01a0dd13/01a0e59f已逐一wait_threads核验notLoaded/latestTurn completed；首次写入前重读归属未变。
- hauler_review parent=01a0f43a-9236-7b41-ba14-8022a98b399e running；仅写operations/diagnostics/2026-09-30-hauler-baseline-review.md；只读相关源码/脱敏证据，无API/凭据/Git权限。
- 游戏2026-09-30.1，19受管模块身份/远端/本地哈希检查通过；当前未改游戏源码或部署。用户遗留inspect-worker-pool.js未跟踪，保留。
- 实验hauler-20260930T195223821086Z phase=diagnose，incumbent batchWeight=0；state.json为唯一状态，experiment同步。
- 完整基线74045006→74046506，1500ticks/coverage1，delivered25320/217events/3040haulerTicks，throughput8.328947。
- carryMean18.24、workerWorkMean19.08、minerWorkMean10.0667；roomCPU3.610795/t，bucket9646→9833/min9480，errors0，invalidReasons[]，validator ready。
- payload0.287739仅诊断；waitingPickup216、blocked93、spawnStarved0/101demandTicks；无收益结论。
- API74046500/fetched2026-09-30T21:36:41Z：两房RCL5/peace/drop0/errors0；W21progress997134、upgrade16/t、0工地；W23progress10493、upgrade7.8/t、10工地。
- W21U150098.06%/stock-526 ineligible；W23U150098.10%/stock+452 eligible单滚动窗；不验收持续90%。
- CPU74046500 mean22.6514/max195.7673，scoutmax181.8961(W23N29)，bucket9814；74046480 mean13.735。已知Issue7/X003后续保留，不归因Hauler，不并行修复。
- Read-only Game诊断真实新tick74046474：无敌人；main正常Hauler续代，worker20WORK；accepted后已读回证据。
- 本轮日志2026-09-30T21-32-17Z-hauler-a2fa2ba135e0；initialdbc1568/progress58e975b已推送；本次完整基线进度另提交。

## 下一步

- 等独立审视完成；最多两个有证据的方案，先propose再trial；无可由batchWeight解决的问题则defer→start新基线。
- 仅W21N26新非紧急取货batchWeight[0,2]开放；priority≤2、其他房间、Link/出生/扩张保留；安全紧急维护先由控制器结束实验。
- 后续轮先核验本root及审视者父任务实际状态；不得用新代理树为空推断释放。
