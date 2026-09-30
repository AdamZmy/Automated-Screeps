# Scout CPU 复发有界审视 — 2026-09-30 22:00 UTC 轮次

- root / reviewer parent: 01a0f456-09bd-79c3-91e6-5f95351cd296；reviewer cpu_review 已 completed/released，仅只读文件和离线诊断，无 API、凭据、Git 或源码写权限。
- 关联 Issue #7 / #4 / #14；游戏 2026-09-30.1。复用 fault-catalog X003 与已有完整审视，不新增未经证实的故障机制。
- API fetchedAt 22:03:20Z / 22:04:26Z，各自 status tick 74046880 / 74046900；Game 诊断由 root 提交并真实回读 74046923，大于旧快照 74046474。

| 核查 | 证据与边界 |
| --- | --- |
| Scout 间歇峰值 | 74046861–74046880 loop mean22.6586/max200.5016；scout max186.2718，物理 W23N27 max186.2742。最大单次约占该窗口 scout 总量93.94%；去除此值约0.6007/t。 |
| 恢复与紧急性 | 后20tick loop mean13.5907/max16.3966；scout max0.3973；bucket9847→9924；无模块错误。六窗均值约16.6758/t，未形成持续耗尽证据。 |
| X003 | 审视者实际运行 node new-colony/tools/verify-scout-routing-diagnostic.cjs 通过；合成图 safe4/unsafe5270 callback。代码机制可复现，但没有峰值同tick候选/安全情报/内部计时，不确认本次命中。 |
| 其他可能热点 | route、出口选择、moveTo、首次地形统计及作用域内运行时成本仍未区分；需要同tick分段CPU、cache和terrain-before。 |
| W005 | 后采policy74046914两房cpuMode normal，无等待队列，bucket回升；该触发条件不成立。旧retrospective fixture缺口保持未知，本轮未重跑或宣称通过。 |
| 其他计时 | memory max2.8399/planner max0.5454不足以解释186CPU scout调用；roles/rooms/stages嵌套，不能相加。 |
| batchWeight | weight0仅控制W21非紧急物流评分；远房scout不直接计入W21房间CPU。共享bucket仍需作安全背景，房间CPU也不是纯Hauler CPU。 |

能源链核查：W21六个20tick样本升级20/t，两矿各5在位WORK，无掉落或停滞；U300由72.58%升77.83%，U1500为95.35%。W23在74046800–74046880升级进度未增，74046900恢复2.6/t，event74046913实际升级12/计划建设40；Game74046923进度13511，8+8+4WORK均已孵化，hostiles0/downgrade80000。74046798续代确认和空能量工人补给目标与短停相容，但不能确认整个80tick的原因。W23 U300有库存透支，U1500为94.22%；不据滚动重叠窗口关闭长期验收。

监督结论：保持 baseline / batchWeight0。root第二次cycle74046927得到350/1500ticks、6165实际energy/44events/700haulerTicks，errors0/invalidReasons[]，固定评价observe/incomplete_baseline。无候选、部署或实测收益宣称。若持续bucket下降、恢复模式、缺测/错误或必要生产实际中断，先经控制器结束实验再维护；否则等待完整窗口74048077，后续诊断须采实际非紧急决策证据。
