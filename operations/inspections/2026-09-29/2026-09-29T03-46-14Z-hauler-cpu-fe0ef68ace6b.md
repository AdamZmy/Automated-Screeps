# 拆解 Hauler CPU 占用来源

- ID：`2026-09-29T03-46-14Z-hauler-cpu-fe0ef68ace6b`
- 类型：manual
- 本轮状态：completed
- 开始时间（UTC）：2026-09-29T03:46:14.110Z
- 更新时间（UTC）：2026-09-29T03:52:39.738Z
- 结束时间（UTC）：2026-09-29T03:51:19.300Z

## 本轮结论

当前版本中 Hauler 的总 CPU 最高主要由数量造成，而不是单车执行最贵：16 只 Hauler 的直接角色 CPU 为约 5\.13/t，占约 21\.54/t 主循环的 23\.8%；单次 Hauler 调用均值约 0\.3172，低于 upgrader 0\.3635、builder 0\.4126 和 miner 0\.4511。另有每房一次的 logistics\.prepare 约 1\.48/t。主要代码热点是需求/任务重协调、候选评分与当前车到来源的路径可达性检查、卸货口租约扫描与失败重试；当前没有证据表明静态路线缓存失效或持续堵塞是主因。未改代码、未部署。

## 游戏观测

- Shard：shard1
- 房间：W21N26, W23N26
- 版本：2026\-09\-28\.7
- Tick：74011100
- 采集时间（UTC）：2026\-09\-29T03:50:14Z

## 发现

### Hauler 总量高但单车不是最高

严重度：info · 无关联 Issue

性能窗口约 33 个样本中，Hauler 16 只，roles\.hauler mean 0\.3172、perTick 5\.1334；upgrader mean 0\.3635、builder 0\.4126、miner 0\.4511。Hauler 聚合约占主循环均值 21\.5416 的 23\.8%，所以当前首先是人口乘数问题。W21N26 有 5 只，W23N26 有 11 只；按同一单车均值估算，W23N26 贡献约 3\.49/t，约为总 Hauler 负担的三分之二。

证据：

- Memory\.frontier\.performance\.roles\.hauler
- Memory\.frontier\.rooms\.W21N26\.roleCounts
- Memory\.frontier\.rooms\.W23N26\.roleCounts

### 房间级 prepare 是 Hauler 相关的第二层成本

严重度：warning · 无关联 Issue

main\.loop 先对每个房间调用 logistics\.prepare，再逐 creep 调用 logistics\.haul。当前 logistics stage 约 1\.4778/t；prepare 会建立 board、计算需求、索引全部 Hauler、reconcile 任务并进行分配/排序。它不计入 roles\.hauler，但与 Hauler 数量和需求数量一起增长；直接 Hauler 5\.1334/t 加 prepare 约 1\.4778/t，已知物流相关路径至少约 6\.61/t。

证据：

- main\.js:43\-60
- logistics\.js:328\-337
- Memory\.frontier\.performance\.stages\.logistics

### 任务重协调和候选评分是主要代码热点

严重度：warning · 无关联 Issue

新任务或任务失效时，assignTask 会扫描需求、扣除预约、构造来源×目的地候选、排序并逐候选做 routePossible；静态 source→destination 路线有 500 tick heap 缓存，但当前 Hauler→source 的 pathLeg/findPathTo 没有同等级缓存。已携货 Hauler 每 tick 还会再次做需求覆盖、紧急目标和状态复核。

证据：

- logistics\.js:221\-326
- logistics\.js:341\-384
- logistics\.js:194\-220

### 卸货口竞争可能放大单车成本但不是当前首要证据

严重度：warning · 无关联 Issue

deliveryPort 会扫描房内 Hauler/租约持有者，租约失效时按候选格排序并逐格精确寻路；ERR\_NOT\_IN\_RANGE、ERR\_NO\_PATH、blocked 和端口失败会触发 avoid、重寻路或外层再次尝试。当前窗口 portCacheHits 约 6\.94/t、portCacheWaits 约 1\.58/t、pathResets 约 0\.39/t、blockedSteps 约 1\.67/t，说明存在竞争/恢复活动，但不足以证明端口失败是总 CPU 的主因。

证据：

- logistics\.js:398\-460
- logistics\.js:488\-555
- Memory\.frontier\.performance\.movement

### 线上负载特征偏向数量、碎片化和远路

严重度：info · 无关联 Issue

W23N26 当前 11 只 Hauler、总 capacity 1800、carryTarget 36；两条路线 roundTrip 为 68 和 80，采样时多数车辆有任务且有多笔小额运送。其 haul CPU 更可能来自并发车辆数量与每车状态/预约/移动检查的重复固定成本，而非单次路径缓存 miss；当前 haulRouteCacheMisses 约 0\.03/t，pathSearches 约 1\.30/t。

证据：

- Memory\.frontier\.rooms\.W23N26\.hauling
- Memory\.frontier\.rooms\.W23N26\.economy
- Memory\.frontier\.performance\.movement


## 待办进度

无。

## 动作

### 2026-09-29T03:47:00Z · done

通过 Screeps HTTP API 刷新状态、性能窗口和 W23N26 物流遥测

结果：获得 tick 74011100、版本 2026\-09\-28\.7、两房间 Hauler 数量/状态、CPU stage/role/movement 统计。

### 2026-09-29T03:49:00Z · done

只读核对物流调用链、缓存边界和历史故障目录，并运行本地物流回归

结果：确认 prepare 与 haul 的两层调用链；verify\-logistics\.cjs 通过；未修改源码、未部署。


## 检查

### 实时性能窗口

结果：passed

新鲜状态包含约 33 个样本；主循环均值 21\.5416，Hauler perTick 5\.1334，logistics stage perTick 1\.4778。

### 代码版本一致性

结果：passed

远端 branch frontier24 的受管模块与本地源码一致，版本为 2026\-09\-28\.7。

### 物流行为回归

结果：passed

verify\-logistics\.cjs 通过，覆盖任务重协调、预约、端口和小批次等既有分支。

### 细分到单函数 CPU

结果：pending

现有遥测只能细分到 role/stage/counter，不能把 collect、deliver、reclaim、port search 各自精确计时；本轮未做代码改动或线上实验。


## 下一轮

- 若要继续降 CPU，优先降低 W23N26 的 Hauler 数量/容量碎片，并观察 20 tick 可比窗口的 Hauler perTick 与 logistics perTick。
- 若继续做代码优化，再为 assignTask、deliveryPort、collect/deliver 的分支增加临时细分计数，先验证实际命中率再改缓存或调度逻辑。

## 引用

无。
