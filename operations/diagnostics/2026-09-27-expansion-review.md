# 扩张报警、物理账本覆盖与 CPU 增长审视

父协调者：`01a0dd13-1434-7c73-b6c1-69d67742d963`。审视者：`expansion_review`。仅本地读取和隔离沙盒；无 API、凭据、网络、Git 或部署操作，未修改游戏模块。已读 OPERATIONS、fault-catalog、ENERGY_METRICS 及相关源码。本文交付后释放报告与沙盒所有权；root负责实现、发布和线上验收。

## 结论

monitor/ledger小补丁已独立复核并通过实际回归，可以进入root整合。新房早期两条报警确有观测口径错误；首Spawn未完成本身不是故障。后续真实人口膨胀与 CPU 超支是新出现的实际风险，应限制非必要增量出生，保留恢复和关键续代，不停已有单位的合法工作。该措施只能阻止继续恶化，不能保证现有 CPU 立即降到预算内。

## 证据时点与边界

- `inspection-0938-status-second.json` fetchedAt `2026-09-27T14:21:38Z`，遥测73980140、账本最新73980155；root重验六模块仍为 `.16`。主房RCL5/storage19337，两源各5W，drop0、stalled0。1500窗升级9.0147/t、计划建设2.5187/t、出口400；U=null、joint coverage=0。不能声明低于90%或已经达标。
- `world-current`73980185：W23N26首Spawn8180/15000，downgrade4074、hostiles0。`life-current`73980186：两名母房home的先驱真实位于W23N26，TTL1199/1239，各2W4C3M，能源194/190。apiSnapshot的room.creeps按home分组，不是物理位置。
- 最新 `status-now` fetchedAt `2026-09-27T20:05:56Z`，tick73985060：目标已有Spawn/capacity300，41creeps（9upgrader/6miner/15hauler/10builder/1scout）。CPU EMA33.4868、单次status38.5744、bucket627；不能把不同CPU口径混成同一值。主房15creeps、storage18086。目标源(33,25)地面594；当前扩张state=blocked、reason精确为 `bootstrap timeout; review required`。

## 分层假设与区分

| 层 | 假设及最小区分实验 | 结果与适用边界 |
|---|---|---|
| 采集/观测 | 新房人口0意味着无人工作；比较home roster与物理resident/WORK、真实harvest | 排除早期无人假设：两个resident pioneer，1500窗真实采集2584，建设2782。旧monitor只认home及miner职责；不能说两矿已达稳态。 |
| 运输/卸货 | L001–L004旧堵口/预约问题复发；跑既有真实地形诊断并看最新持货、口位、事件 | `.16`经济与诊断回归通过；73980140主房无积压/停滞。最新新房594掉落不能据此归为同因，需CPU恢复后采实际周期。 |
| 消费 | E001/U001动作预算使先驱停工；查buildAllowed/work及固定回归 | 先驱不受该动作预算，RCL1和downgrade<4000优先升级，其余优先Spawn施工。已有连续动作回归通过。短45tick仅+10施工不能证明故障；先驱当时在远端控制器附近。 |
| 续代/扩张 | 固定超时忽略仍在推进的首Spawn；按原函数推进到age6000/6050 | 已确认：6000仍launching，6050即使14990/15000也blocked；已有先驱继续工作，新先驱补员停止，之后Spawn完成也不解除blocked。此次真实73983050超时且后来有Spawn，机制已命中。 |
| 观测/账本 | 母房U缺测来自远行先驱而不是生产事件丢失；仅改home的反事实 | 已确认：73977080–73980155连续3076tick理由仅remote-economy-not-covered；metricComplete仍true。同一身体/位置仅改home即可恢复scope，证明口径耦合。实服不可用改home规避，会改变补员归属。 |
| 身体/CPU | 小容量、长补能周期和搬运路线使按能量规划的人数过高；对比目标字段与需求代码 | 最新数据支持：300容量小身体，controller无席位，workerDuty约0.225把2/t升级目标换算为9个1W；68/80tick路线与积压把CARRY需求拉到38，已有15车；两矿各3名矿工凑6W。当前出生规划没有总CPU成本约束。 |
| 多因/残差 | 修复scope即可证明90%或所有故障解决 | 排除该推论。旧1500窗库存+3669、residual−486、linkLoss970；这些仍须如实保留。新房进口与库存变化、必要孵化成本、CPU截断及缺测仍各自影响资格。 |

## 已实现小补丁的独立复核

1. ledger由本次observe(owned)构建observedNames；仅pioneer、memory.target等于物理room且该room本次被observe时免除remote理由。home/跨境货量均不改变；未拥有/未观测途中、其他职责、错target仍受保护。前后两帧scope规则不变，不补造旧样本。
2. monitor保留home roster及upkeep，另报物理bootstrap residents/WORK/先驱支援/途中先驱。无Spawn阶段停止套用spawn-starved和专职missing-mining；无resident WORK、无途中支援、controller停滞至少200且300窗G无正进展时，发bootstrap-unassisted。首Spawn后原恢复报警恢复。
3. 独立沙盒实测两个resident先驱但home roster为空时不误报；删除支援后可发无人报警；正确途中target解除无人报警、错target不能；已有Spawn后原报警恢复。ledger跨境100出口/100进口两侧残差0，home不变。
4. `bootstrap-unassisted`只负责“无人支援”，不证明“有WORK的人一定工作”。现有任意resident WORK或长期途中先驱会避免此报警；卡路、错误职责、无CARRY、受伤及持续低进展仍需要独立检查。此限制不阻止此次修复，但不可把该报警消失称为全局健康。alert的delay只延迟console日志，不延迟telemetry候选出现。

## CPU 应急设计的最小验收与风险

支持root在“新鲜实际CPU持续超额且bucket不足”时暂停无关键岗位缺失的增量出生；不改变既有单位动作，不杀人。门槛必须覆盖scout/额外先驱的global.frontierExpansion.spawn旁路。用明确恢复标签决定能否通过，而非所有role=miner一律放行：无有效矿工的源、必要的minerRenewal、无运输、无可工作WORK应保留；已有矿工从4W补5W及工位升级属于增量。检查活体有效部件、剩余寿命和待生体，避免以role存在代替岗位有效性或重复出生。

最小回归：

- 高CPU+低bucket时，已有采集/运输/WORK覆盖的两房不出生builder/upgrader/额外hauler/scout/pioneer；已有creep仍提交就绪动作。
- 分别去掉有效矿工、最后运输、最后WORK，及制造矿工续代deadline：允许正确恢复，待生体抑制重复。
- 尚有富余矿工或升级身体的请求不绕过CPU门槛；按source断供能恢复。
- 高CPU但充分bucket、低CPU+低bucket、陈旧/缺失遥测分别遵循显式策略，不能把缺测默认为健康或永久冻结。
- bucket恢复后的放行不发生每20tick反复开关；用已有规划节奏/有证据的恢复条件，不新增任意人口硬上限。

风险：bucket627，若持续约31.9–33.5CPU相对20预算，简单线性余量约46–53个执行tick；这不是精确引擎失效预测。自然死亡可能需数百至1500tick，仅禁出生不会立即降低现有41人的执行成本。root应部署后立即检查bucket斜率、CPU阶段、主房真实升级、两房采集与关键续代。若仍下降，下一步针对实测非行为重复规划/诊断开销缓存或降低重算频率，不能等待1500/6000窗才处理，也不能声称已恢复。

## 超时恢复小补丁

仅当blocked原因精确为 `bootstrap timeout; review required`、目标当前controller.my且有本地owned Spawn时恢复stabilizing，并清除过期timeout reason；其他blocked理由仍原样保留。恢复后仍执行原矿工覆盖/hauler/RCL/真实升级EMA的complete条件，不能Spawn一建好就标complete。已有父房补员保护会因目标有Spawn而停止额外pioneer。最小回归覆盖wrong reason、敌方/无controller.my、无Spawn不恢复，以及后续真正满足自立条件才complete。

## 实际执行过的验证

均通过：`verify-expansion.cjs`、`verify-monitor.cjs`、`verify-ledger.cjs`、`verify-economy.cjs`、`tools/verify-hauling-hypotheses.cjs`、`tools/verify-policy-restrictions.cjs`。root修改monitor/ledger后两回归再次独立实跑通过。

沙盒目录 `new-colony/state/expansion-review-0938/`：冻结`.16`模块及SHA256的baseline；`verify.cjs`/results.json重现原缺陷和scope反事实；`verify-current.cjs`/current-results.json独立验证当前monitor/ledger行为。只证本地机制，不替代线上CPU、施工吞吐或完整1500/6000tick验收。本文未验收尚待root实现的CPU门槛与timeout恢复补丁。

交付时间：2026-09-28T01:15:36.707879+00:00。文件已释放。
