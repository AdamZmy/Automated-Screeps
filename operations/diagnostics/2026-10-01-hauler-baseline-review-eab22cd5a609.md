# Hauler 第二完整基线独立审视

- 审视时间：2026-10-01T03:20:05Z（含root后续补充证据）。
- 父任务/root：01a0f574-9a3d-7372-9f8c-791b9832bc3f；审视者：`/root/baseline_review`。
- 实验：`hauler-20260930T214108514416Z`，W21N26，`phase=diagnose`，control / batchWeight=0。
- 权限：只读指定源码、两份现有实验 JSON、故障条目和 root 脱敏摘要；唯一写入为本报告。未访问凭据、API、UI、Git 或 Issue，未修改/部署游戏源码。按 screeps-world-api 技能的 root/审视者职责分工执行。
- 身份、分支及19模块哈希校验通过是 root 提供的本轮事实；本审视者未独立调用 API 重验。前任审视者已 completed/released 是 root 提供的交接事实。

## 结论：defer，当前无有证据支持的 batchWeight 候选

`alternatives=[]`。完整有效基线证明当前对照可用于比较，不证明新非紧急取货的路线排序存在缺陷。尚无 W21N26 分配当刻的全部同优先级可行候选、扣除预约/accepted intent 后额度、现行/候选分数及实际交付结果，因此不能在 [0,2] 内合理选择非零权重。低载率本身不构成目标，也不是应等满或增大权重的证据。

现有证据足以支持 **L009 的有限维护**，但该修复超出本轮权重控制面。按root提供的本次严格自动化约束，没有允许控制面内的证据支持问题时，应由控制器defer后start下一轮，保全已冻结基线；本轮不借诊断扩大游戏源码维护范围。L009优先维护建议保留Issue5，待允许的后续维护边界单独安排修复、独立复核及新基线。重复对照采样本身不补足路线选择的因果证据。

监督者本轮选择（root随后回报）：已采纳defer并由控制器将旧实验终结为inconclusive，正在依用户要求start新baseline。新baseline用于重新配对采样，旧冻结窗口不作为永久对照。此操作与审视者提出的未来L009维护建议分开记录；本轮未执行L009源码修复。

## 基线与当前观察

| 指标 | 前一对照窗口 | 本轮对照窗口 |
| --- | ---: | ---: |
| tick 范围 | 74045006–74046506 | 74046577–74048077 |
| observed ticks / coverage | 1500 / 1 | 1500 / 1 |
| 实际交付 energy / events | 25320 / 217 | 27032 / 220 |
| haulerTicks | 3040 | 3017 |
| delivered / haulerTick | 8.3289473684 | 8.9598939344 |
| averageTravelPayload | 0.2877386106 | 0.3090379404 |
| blocked / haulerTicks | 0.0305921053 | 0.0294995028 |
| room CPU / tick | 3.6107954130 | 3.6249417311 |
| waitingPickup | 216 | 218 |
| spawn demand / starved ticks | 101 / 0 | 149 / 0 |
| hauler count min–max | 2–3 | 1–3 |
| errors / invalidReasons | 0 / [] | 0 / [] |

两窗 signature 相同，且均为 weight0；第二窗吞吐高 7.5753%。这是观察到的未处理条件下窗口变化，不能归因权重，也不能据两窗推断统计显著性或稳定收益。平均单次交付由116.6820变为122.8727，仅是 delivered/events；它混合任务优先级、供给、容量及续代节奏，不能代替完整运输周期或同类路线比较。waitingPickup 没有把正常接近来源、取货动作与真实等料原因分开，不能据此判定218 tick可消除。

root 状态摘要 `new-colony/state/run-eab22cd5a609-status.json` fetchedAt=2026-10-01T03:15:53Z；status/telemetry/performance tick=74051340。该当前截面已在冻结窗口结束后：W21 两车实货450及325，总775/900，无 stalled；W23 两车实货160及60，其余三车在 pickup。这说明存在满载及部分载货，既不能证明长期最优，也不能确认这些部分载货命中了 L009。不得把后采源库存倒推为该次取货时可用库存。state 中 baseline.tick=74051357 是后续观察tick，窗口仍截止74048077；不能据此把窗口扩成4780tick。

## 控制面与多因复核

- `hauler-policy.js:4–8` 只在指定房间、batch-preference 变体、priority>2时改变分数；当前 control不施加惩罚。公式在原分数上乘 `1+w*(1-min(1,amount/capacity))`，w∈[0,2]时乘数为[1,3]。现行 `logistics.js:342–356` 已用距离估计/可行额度和库存压力排序，并验证两段可达性。追加较大批量偏好是否改善实际能量/haulerTick仍须决策时替代路线证据。
- **同趟旧额度 L009：机制确认。** `assignTask` 的336行、`retainTask` 的380行持续保留旧amount上限；528行withdraw再次以旧amount减实货限制。新来源增产或目的地需求增大不会扩容既有任务。权重只在新任务route构造时执行，不能修复已保留的额度，亦不覆盖W23。
- **跨趟额度 L008：现有控制通过。** 已确认卸空后旧任务清理位于reconcile阶段；本次诊断再次验证旧9配送完成后下一趟预约450。不能把同趟L009叫作L008修复失败。
- **合法供给不足/竞争：仍是独立原因。** source500、两车450+50，以及source9、单车9均正确。多车来源和目的地预约必须同时扣除，不能把同一可用余量分别加给所有车辆。
- **任务需求大小/紧急性：仍是独立原因。** 容量450车给一个50缺口extension取50，即使三个extension合计缺150。该行为在priority0，当前权重不触及；本轮不建议通过等满或多目标改造扩大维护范围。
- **Link批次、源产出和续代节奏：线上贡献未量化。** 前次W21可见116取货intent对应源116，没有已证实的现成未取余量。当前两窗Hauler数量范围不同，且没有完整来源节奏/交付周期分布，不能把低payload全部归于路线。
- **移动/堵塞：无权重归因。** 本轮blocked为89/3017；该计数与payload不足以识别可规避路线。合法idle、疲劳及完成动作后停顿不应一并判为拥堵。

## CPU峰单独归档到Issue7范围

当前20tick区间74051321–74051340：loop max197.8595，scout max187.0728，W23N29 room max187.0762；hauler max0.7785，logistics stage max0.8049，bucket9874。这是 scout/物理房间峰相关的证据，不是Hauler权重故障证据，且发生在本轮基线冻结之后。

X003已确认“对已知不安全目标搜路”的代码机制，但本次没有峰值tick的候选、route调用及intel跟踪，因此仍不能把该具体峰确定为X003。保留已知Issue7下的独立非紧急维护，不与L009或batchWeight捆绑；无本轮材料显示需要紧急打断运输实验的生产损害。

root补充的只读Game快照 `new-colony/state/run-eab22cd5a609-snapshot.json` 已真正回读新tick74051376，W21 hostile0、W23 hostile1。后续 `new-colony/state/run-eab22cd5a609-status2.json` fetchedAt=2026-10-01T03:18:23Z，status/performance tick74051380，CPUmean13.2868/max15.9408、bucket10000、模块无错误；W21升级20/t、W23升级10/t。两房security有独立实际tick74051392，均peace/count0/armed0/damage0。短暂单个hostile未证实武装或损伤，不归因Hauler；后续CPU恢复支持继续正常受控流程。不同遥测字段tick分别保留，不宣称都是同一tick的原子快照。

## 实际运行检查

1. `node new-colony/tools/verify-hauler-pickup-quota-diagnostic.cjs`：退出0，9个场景通过。当前代码容量450、原额度9、到源可行99仍实取9并进入deliver；沙盒到源重算实取99。同源peer90时，原始源189的沙盒实取99且保留90；无增产控制只取9。另含extension50、合法450+50分配、单源9及L008跨趟9→450控制。
2. `node new-colony/verify-logistics.cjs`：退出0。既有多tick实货核对、拒绝/部分动作、同tick intents、双侧预约、loaded优先、紧急抢占、Link协调、满额卸货及有限邻近补货回归通过。

第一项是已知故障诊断，“通过”意味着原故障和对照稳定复现，绝非已完成生产修复。沙盒在确定性开放地形、既有引擎常量及下一tick物理Store结算下证明额度机制；没有证明线上吞吐收益。未修改诊断或新增测试文件。

## 有限后续维护与验收边界

优先建议仅处理L009：在到源可执行withdraw时，以当前容量/实货、来源可用量、目的地实际需求、所有同行预约和同tick accepted intents重算本趟可行额度；保留紧急请求优先、合法小批次、掉落物无amount参数、失败/部分动作、已接受intent幂等，以及L008完成卸空后新任务语义。`runtime.js:48–57` 的intent账仅扣初始能量/容量；同tick incoming不能立即再花、outgoing不能制造即时空间，修复必须继续遵守。诊断中的直接沙盒改amount不是可直接上线的实现。

未来允许维护时，先结束当时仍活跃的实验，再修改物流源码；把已知失败断言改为正确行为回归，并补到源时目的地缺口变化、同行source/destination双预约、accepted transfer/withdraw、紧急抢占与拒绝动作边界。经独立审视与root API验证后重采完整基线，验收实际delivered/haulerTicks、消费者断能/孵化需求、CPU、来源库存/溢出和续代成本。提高满载率只能是解释变量，不作为单独成功条件。本次只按defer→start流程交接，不声称L009已修复。

若未来重新提权重候选，最小新增证据是有界的W21新非紧急任务决策记录：每条同优先级可行source→destination路线、分配前扣除全部预约/intent后的amount、容量、原始分数、拟议权重分数、两段可达性；再对齐下一tick实际取货与完整配送。维护修复后的新基线才能用于新候选比较。

## 文件释放

本审视已完成；唯一写入文件为本报告，所有读取的游戏源码/测试/实验状态均未修改。审视者释放本报告所有权；无后台进程、无待执行API/部署操作，后续由root接管。
