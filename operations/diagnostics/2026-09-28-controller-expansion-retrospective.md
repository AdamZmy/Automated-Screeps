# 暂停巡检后的因果回顾

协调任务：01a0e59f-6dbf-7542-a88c-e879ef934275。2026-09-28 UTC。
仅暂停计划、读取历史/新鲜 API、创建无游戏行为的诊断快照、运行隔离验证；未改游戏策略或部署。

## 调度

`screeps-world` 已由自动化工具确认 PAUSED，保留原每小时配置。上一轮协调者收到停止新增工作要求，并确认停止 API、修复、部署与派工，仅做已有日志/Git收尾。暂停的是 Codex 巡检；已部署游戏代码仍逐 tick 运行。

## 时间线

所有人类时间以下同时注明 UTC / 美东 EDT，游戏 tick 不受时区影响。

- tick73955120，9月26日09:39 UTC / 05:39 EDT：主房RCL4，2名Upgrader合计18WORK、4个固定席，storage0，无工地。
- tick73977000：原先已部署的自动扩张逻辑启动 W21N26 → W23N26，候选得分187。没有新的人工作战指令证据。
- tick73977135：W23N26拥有房间账本开始。该字段是开始观测自有房，不是精确claim事件日志。
- tick73980140，9月27日14:21 UTC / 10:21 EDT：新房已RCL2；主房仍2名升级工、14WORK、4席、storage19337。新房两名先驱的home在主房，不能把home人口0解释为无人。
- tick73981980，9月27日16:30 UTC / 12:30 EDT：新房首Spawn仍在施工11826/15000。
- tick73983666，9月27日18:27 UTC / 14:27 EDT：地图API仍明确列出主房(16,23)Container。
- tick73985060，9月27日20:05 UTC / 16:05 EDT：新房已有Spawn、41单位（9upgrader、10builder、15hauler、6miner、1scout）；主房固定席仍4，2名升级工共26WORK，storage18086。实际首Spawn完成时刻仅能界定在12:30–16:05 EDT。
- tick73989460，9月28日01:17 UTC / 9月27日21:17 EDT：主房固定席0，2upgrader共8WORK；73989480确认原坐标Container工地2443/5000，消失早于本次CPU保护部署。
- tick73989500：.1修复已建Spawn不能解除精确bootstrap超时状态后，既有内部条件把扩张标complete。它不代表实际经济/CPU验收完成。
- tick73989640，9月28日01:31 UTC / 9月27日21:31 EDT：新鲜状态见下。73989655直接Game快照再次确认主房原坐标只有Container工地4568/5000。

因此扩张早于主房Container消失。Container最后直接存在证据为73983666；73985060工位仍4为间接支持。没有连续血量/死亡事件，不能给出确切消失tick。

## Container失踪的证据与边界

确认代码机制：main.js的work函数先施工后维修；存在任何工地就建造/赶路并return，即使Controller箱濒死也不修。Upgrader驻站升级而不负责修箱，Tower仅修rampart，矿工只维护自己源旁的箱。主房多份快照持续有rampart工地。

独立沙盒：Controller箱1000/250000hits，有能源builder且工地连续存在，10tick得到10build、0repair；移除工地后立即repair。这是可复现的维修优先级缺陷。

官方规则：自有房Container每500tick损失5000hits。长期无维修可以自然消失。来源：https://docs.screeps.com/api/#StructureContainer 。

“失修后自然衰减”是有代码与现场支持的首要解释，仍不是已经证明的历史死因。没有消失前hits/ticksToDecay序列或攻击/销毁事件；稀疏hostiles0不能排除中间攻击。限定游戏模块未发现主动destroy/dismantle。RCL5布局保留Controller箱，现有两Link分别为源端/中心端，Controller Link计划在RCL6；没有拆箱换Link的代码路径。

## 低升级与积压的因果链

1. 只要有施工，updateEconomy把发展预算先拨给施工，升级目标通常剩2能量/t。主房当前发展14.67，其中施工12.67、升级2。连少量rampart工地也会触发。预算影响未来人数/身体；已有就绪Upgrader仍每tick升级，因此早期26WORK仍曾实际达到300tick平均16.09/t。
2. 固定箱消失后主房stationSeats由4到0。8WORK按补能路程模型只算2.96有效WORK，且快照确认5WORK工人曾无能源。补给效率下降有支持，但尚无逐tick证据把全部吞吐损失量化给这一因素。
3. 新房能量容量始终300，早期很多小单位补足模型需求，人口曾41；其中15Hauler、10Builder、9个小Upgrader。全局CPU超20额度，bucket耗尽，影响两房。扩张前检查的是当时主房CPU/储备/岗位，缺少对新房成熟前人口与CPU总成本的充分限制。
4. 上一轮.1补丁于739894xx附近加入CPU应急限生；mean>20且bucket<1000时停止非必要新生。它只能解释之后的补员冻结，不能解释此前箱消失或人口变动。
5. 保护判断把所有消费WORK混在一起：只要还有一个Upgrader就不视为“缺WORK”，因此没有Builder也不能恢复施工队伍；反向同理。运输缺口又排在Builder/额外Upgrader前。现有可工作单位不会因为这道guard主动停工，但消费岗位恢复会受阻。
6. 最新新房有1upgrader/2WORK、0builder、13hauler、7miner（含续代重叠）、1scout；工地无人建设，升级目标仍2。更多运输无法补足消费端，两个源箱都满，Controller箱也接近满。

## 新鲜状态

状态73989640、Game快照73989655：

| 项目 | W21N26 | W23N26 |
|---|---:|---:|
| Controller | RCL5 | RCL2 |
| Upgrader人数 / WORK | 2 / 8 | 1 / 2 |
| Builder人数 | 3 | 0 |
| Hauler人数 | 6 | 13 |
| 矿箱能源 | 约10 / 0 | 2000 / 2000 |
| Controller箱 | 原地重建4568/5000 | 1912/2000 |
| Storage能源（status） | 16567 | 无 |
| 地面能源（status） | 0 | 2529 |
| 近20tick遥测升级率 | 1.25/t | 1.4/t |

全局CPU20tick执行均值25.7112、额度20、bucket1；该20tick窗口只有14个完整采样，不能宣称连续满覆盖。Hauler占11.8209CPU/执行tick，Memory解析3.6346。主房storage从19337降到16567，因此“持续堆积”当前最明确发生在新房，而非主房库存持续上涨。

## 验证和处理优先级

已运行既有经济回归及独立维修饥饿、箱/Link选择、CPU恢复角色判定3组沙盒，均通过；通过表示现有代码机制被复现，不表示线上故障已解决。脚本/独立报告由审视者保存至同目录。

后续修正顺序：关键Container按血量/剩余寿命获得维修兜底；消费角色恢复分别保护Builder和Upgrader；按实际工程量和可执行施工能力分配预算；解决已测CPU成本后再扩大有效升级WORK。不能只把Upgrader数量加大，不能把内部expansion.complete当自给验收。

本轮依用户要求止于回顾，没有执行上述游戏修复。唯一巡检计划保持暂停。
