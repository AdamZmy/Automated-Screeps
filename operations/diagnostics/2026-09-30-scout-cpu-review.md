# 侦察 CPU 峰值独立审视 — 2026-09-30

- Parent task: `01a0f41f-c50e-7542-8779-34b246f00ad8`；独立审视者：`cpu_review`，实现/API/部署由 root 独占。
- 范围：只读源码与精选样本；仅本报告和隔离沙盒有写入。不读取凭据或原始 Memory，不调用 API、Git、浏览器或部署。
- 版本：game `2026-09-30.1`；root 已核验 19 模块。关联 #7（侦察/扩张）、#4（CPU/持续用能）；#14 的 Hauler 实验须保持独立归因。

## 结论与紧急性

此次异常确认到 **scout 调用及其物理房间 W22N28 的整段 CPU**，没有内部计时证明具体热点。当前证据不足以认定紧急安全故障或中断 baseline：后续两个 20tick 窗口恢复正常，bucket 回升，未见模块错误，主房持续升级 20/t。应保留本事件、完成对照窗口，并对后续峰值定点采样；不得以全局 CPU 峰值评价 batchWeight。

独立沙盒确认一个可重现的潜在高成本机制：侦察候选只检查 `allowed`，已知敌占目标仍会进入 `movement.route`；该函数未先检查目标 `safeRoom`，而由 `findRoute` 的回调拒绝终点，可能把本可立即拒绝的目的地变成大范围无路搜索。**机制已确认，是否解释本次峰值未确认，也未修复或部署。**

## 精选线上证据

| Tick/窗口 | 证据 | 含义与限制 |
| --- | --- | --- |
| 74046181–74046200 | loop mean 22.7386 / max 200.9723；scout 40 calls、9.9768/t、max 187.8277；W22N28 max 187.8317 | 最大单次 scout 调用占该窗口 scout 总 CPU 约 94.13%；移除这一个最大值后剩余 scout 总量折合 0.5854/t。强烈支持间歇性单调用热点，仍无具体调用栈/峰值 tick。 |
| 74046081–74046200 | 六个等长窗口合计均值约 19.3674/t，多个峰值；bucket 9696，EMA 16.77/20 | 20tick 告警不能直接等同长期超额或 CPU 恢复模式。 |
| baseline 74045006–74046213 | observed 1207/1500、errors 0、invalidReasons 空；bucketStart 9646、end 9736、min 9480 | 尚未满窗，不作有效候选效果结论；当前未见实验完整性失效。 |
| 74046220、74046240 | root 后续 API：mean 14.1473 / 13.9357；max 17.3279 / 17.3994；后窗 scout 0.5751/t、max 0.7819；bucket 9822、EMA 16.59/20、无 module errors | 峰值之后恢复，不能据此排除未来复发。主房升级 20/t；辅房仍有建设，单次升级率下降不是本事件因果证据。 |
| 74046274 | 两 scout 分别 W22N27→W22N25、W23N27→W22N26；出口缓存时间 74046270/74046263，stuck 均 0，terrain 均存在 | 当前在途正常；不能重建峰值发生时的候选选择/缓存状态。 |
| 74046274 | 近邻不安全 intel 含 W24N27：foreign owner，hostiles 0，seen 74031551 | 当前确有可进入错误候选链的旧敌占信息。尚无证据表明峰值 tick 曾尝试该目的地；所有权过滤不按情报年龄自动失效。 |

证据工件由 root 保存于 `new-colony/state/evolution/cpu-review-01a0f41f.json`、`scout-snapshot-01a0f41f.json` 及第二次精选 status。上述更新使用各自 tick，未把后采字段回填为历史事实。

## 假设、区分实验及置信

| 机制 | 支持与反对证据 | 最小区分/沙盒结果 | 状态及下一步 |
| --- | --- | --- | --- |
| 不安全候选导致无路大搜索 | `neighborhood` 用 allowed，而 route 回调用 safeRoom；旧敌占信息存在。反对确定归因：无峰值同 tick 候选序列。 | 实际 expansion/movement + 固定 npm engine map，在合成图上：正常邻房 callback 4 次；敌占终点 5270 次、ERR_NO_PATH，然后 scout 选择另一安全目标。失败缓存十 tick，过期再次搜索。 | 机制高置信；本次归因未证实。后续捕获 route 起终点、失败数、callback 数与同 tick CPU。 |
| 出口选择/房内 moveTo 搜索尖峰 | travel 首次选出口、目标变化、100tick TTL 或真实受阻均可搜索；`findClosestByPath` maxOps 3000，后续 moveTo 是另一搜索。 | 既有 expansion 回归通过：80tick 共享一次 route/出口、TTL/敌情失效、障碍/占位与受阻恢复。 | 仍可能；现有计数 `pathSearches` 非 scout 专属，不能归因。需独立计时 route / exit selection / moveTo。 |
| 首次房间地形统计 | record 对缺 terrain 的房执行 48×48 次读取；整段在 scout 计时内。 | 沙盒确认首次 2304 次读取，后续 0 次；74046274 两房已缓存。 | 机制确定但成本未测；历史 W22N28 是否首次无证据。需峰值 tick 的 terrain-before。 |
| W005 恢复策略或普遍人口过载 | 历史 W005 与 bucket 枯竭有关；当前 bucket 高、cpuMode normal，主房消费者工作正常。 | 目录记录后续角色恢复修复；指定 retrospective 回归在到达 W005 前失败，不能称通过。 | 本样本 W005 触发条件排除；全局长期人口成本仍需趋势，而非本次 scout 峰值解释。 |
| Memory/规划/计时重复归因 | memory 2.3701/t、max 2.7761；planner max 0.5275；与 187.8 scout 峰值不符。 | metrics 回归通过。roles、rooms、stages 是同段嵌套总耗时，不能相加；仅 logistics 为 self time。 | 本窗口不支持 Memory/规划是主要热点；仍不排除运行时 GC/JIT等被计入 scout 作用域。 |
| batchWeight 导致此热点 | 仅 logistics 非紧急候选评分调用 routeScore；control/weight0 等价原评分。expansion/movement 没有该调用。 | policy 与 evolution 回归通过；隔离计时注入主房 2、远房 scout 180 后，currentRoomCpu 主房保持 2。 | 直接控制与直接房间归因排除；共享 bucket 的间接影响仍应作为全局安全背景观察。 |

## 能源链和实验口径

采集→取货→运输→卸货→消费→续代/成本逐层核对：样本没有掉落积压；Hauler 角色 max 0.7262，与 scout 峰值分离；baseline 交付事件正常累积、出生饥饿 0；主房消费持续 20/t；未见恢复模式或当前错误。以上只排除本样本明显的供能中断，不能替代逐矿库存、完整往返和续代的独立验收。

`main.js` 按 `c.room` 给角色动作计入物理房间；`evolution.finish` 读取 `metrics.currentRoomCpu(config.room)`。因此远端 scout CPU 不直接纳入 W21N26 `roomCpuPerTick`，但主房 roomCpu 也不是“纯 Hauler CPU”：该房所有已计时模块与房内单位均在其中，侦察经过主房亦可计入。角色/房间/全局三个口径均需分别解释。

## 实际运行的验证

通过：

1. `node new-colony/verify-expansion.cjs`：路线/出口缓存、真实受阻、障碍、失效与任务边界。
2. `node new-colony/verify-hauler-cpu.cjs`：20tick 计时、自耗时守恒、异常恢复和有界历史。
3. `node new-colony/verify-evolution.cjs`：真实事件采集、完整窗口、失效条件与冻结。
4. `node new-colony/verify-evolution-policy.cjs`：baseline 等价、房间/紧急范围和连续评分。
5. `node new-colony/tools/verify-scout-routing-diagnostic.cjs`：上述不安全候选搜索、失败缓存、地形一次性读取及物理房间计时边界。

未完成：`node new-colony/tools/verify-retrospective-causes.cjs` 在构造历史 bootstrap fixture 时抛 `TypeError: Cannot read properties of undefined (reading 'memory')`，先于 W005 回归断言。此为验证缺口，未修无关旧测试；没有把失败当成本次线上 W005 重现。运行环境 Node v25.5.0，而仓库声明 22.x，也应在修复测试时核验。

沙盒用 `__dirname` 相对加载 helper，helper 使用已安装固定 `@screeps/common` 常量与 `@screeps/engine` map/path-utils，启动位置不影响依赖解析。它使用合成可达房间图及 stub 房内移动，没有真实地形、真实服务器 CPU、真实跨房行为或峰值调用栈；5270 是 callback 调用量，**不是 CPU 实测值**。若 engine/地图算法、安全策略或候选策略改变，应重审该断言。原沙盒位于忽略的 state 目录，root 已审阅并持久化为独立诊断回归，见文末整合记录。

## 安全处置与剩余检查点

- baseline/trial 中保持已核验版本；本事件无需立即改策略或并行部署。root 将机制记录于 #7，#4 保留 CPU 背景，#14 只记实验安全/归因边界。
- 可审阅的最小后续修复为在寻路前拒绝当前已被 safeRoom 判定不可进入的目的地/候选；应复用原安全条件而非新增游戏行为阈值。须验证安全目标仍可达、敌情失效、回家/撤离以及失败恢复边界，完成后另取线上 CPU 和真实旅行证据。
- 单靠目标预检不能修复安全终点被其他危险房包围的无路搜索，也不能解释所有出口/moveTo峰值。最小定点观测必须将 route、出口选择、moveTo、record 对齐同 tick，保持有界、不发 intent；当前无此证据，保留原因开放。
- 如果后续出现持续 bucket 下滑、CPU 恢复、模块错误/观察缺口或必要生产中断，再由 root 按控制器先结束/回滚实验处理紧急维护。

有限审视已完成；本报告及沙盒交付 root，释放两文件写入归属。没有源码、策略、在线状态或 Git 变更。

Root integration: persisted the sandbox at `new-colony/tools/verify-scout-routing-diagnostic.cjs`, adjusted its helper path and reran it. It diagnoses the current failure mechanism; a future fix must replace failure assertions with a safe-target behavior oracle.
