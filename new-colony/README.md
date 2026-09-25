# Frontier：Screeps World 新殖民地

账号 **AdamZmy**，官方 **shard1**，主房 **W21N26**，出生建筑 **Origin `(21,28)`**。本项目与既有 Screeps Arena 代码完全独立。

## 当前运行方式

游戏活动分支为 `frontier24`，源码在本目录。用户要求数据读取、Console诊断和部署均通过官方HTTP API，不再使用computer use、截图或界面自动化。可复用skill：[screeps-world-api](/Users/zmy/.codex/skills/screeps-world-api/SKILL.md)。

服务器每 tick 执行 `main.loop`。开发子代理按需启动，分别处理战略、能源和布局；它们不充当永久运行的游戏进程。持续运行的是已经部署的 JavaScript 模块。

| 文件 | 职责 |
| --- | --- |
| `main.js` | 出生、矿工、运输、建造与升级、防御、模块调度和异常隔离 |
| `planner.js` | RCL 1–8 布局、资源与出口通路、建筑配额校验、旧建筑复用、分批施工 |
| `plans.js` | 冷房静态执行归档，开拓时按需恢复；完整规划另存本地 |
| `expansion.js` | 侦察、双矿候选评分、单目标开拓、自给验收和扩张间隔 |
| `monitor.js` | 每 20 tick 保存逐矿库存、道路进度、运输阻塞、升级速度、CPU EMA 和有限历史，异常去重 |
| `ledger.js` | 每tick依据真实事件记录G/eta、费用、库存、残差和300/1500/6000tick窗口 |
| `ARCHITECTURE.md` | 架构研究、开源参考、代理边界、已实现状态及后续改进 |

## 主房地理与升级

控制器 `(16,21)`，两个能源点 `(24,24)`、`(16,42)`。实时遥测显示两个源各只有一个地形采矿位，因此专职矿工的有效 WORK 与换体衔接尤为重要。两个自有源的理论持续产能合计 20 energy/tick；这不是当前实测产量。

已有完整分级布局通过独立地形/API 模拟，含 60 extension、3 spawn、6 tower、10 lab、6 link 及其他终局建筑；模拟产出 339 项（含路和 rampart）。现场复用已有工地后的在线 v3 布局为 331 项，已确认 `complete=true`、`missing=null`；道路等数量会随既有布局变化。在线权威布局保存在 `Memory.frontier.rooms.W21N26.plan`。两份 `plan-W21N26*.json` 是早期离线快照，不能当作实时布局。

开局先恢复采运和 RCL 2，然后建设 extension 扩大身体预算；RCL 3 加塔，RCL 4 建 storage，RCL 5 加 link。升级吞吐随储备和开拓活动调整。施工按当前等级和预算分批执行，并非开局同时建设全部计划。

`.7` 的早期生产门槛：RCL 2 需达到 550 容量且每源有已就位矿工 4 WORK，RCL 3 需 800 容量且每源 5 WORK。达标前保留稳定的 2 WORK 主升级队，多余升级工临时施工 extension/container，不改变永久角色；同类型先完成已有进度的工地。出生目标暂为 6 CARRY，不淘汰现有运输者；达标后恢复正常配置。矿工仍有更高的续代和换体优先级。

`2026-09-25.1` 修正工人补给分配：库存低于半仓与约10tick工作耗能中的较小值时请求补给，补至90%后结束请求；运输者优先服务剩余工作时间更短的工人。避免持续给接近满仓的升级工零碎补能而忽略缺能建造者。该版本生产门槛及取货流程不变。

`2026-09-25.2` 增加经济干线与积压处理：

- planner 保持 v3 建筑坐标，原地迁移 `roadVersion=1`；矿源/控制器至共同核心的经济道路提前到 RCL 2，先沼泽、再源侧关键段，同时最多 3 个道路工地。普通道路等待经济干线完成、RCL 4 及 storage ≥20,000。塔、容器优先级仍高于道路。
- 运输取货评分考虑矿边容器与地面总库存；选定目标跨 tick 保持，达到 90% 载量即配送。取货耗尽、无路或长期不动会重选；配送目标连续 4 tick 不移动或无路时暂避 15 tick，继续服务其他需求，疲劳等待不算阻塞。
- 监控在 `telemetry.rooms.<room>.mining` 保存逐矿 `buffer/dropped/stock/stockDelta/backlogSince`，`work` 只计未孵化且已经位于采矿范围的矿工，`assignedWork` 单独保存所有已分配 WORK。`netStockRate` 是净库存变化，不是实际搬运量或采矿产量。
- `roads` 记录经济道路计划/已建/工地/剩余沼泽及每条路线覆盖；`hauling` 记录载量、疲劳与停滞。逐矿积压持续 100 tick 才打印告警；实际尝试移动的满载停滞持续采样后才告警。历史固定最多 60 条，不无限增长。

## 扩张规则

优先双能源、无主无预留、无已知威胁且通路/布局完整的房间；评分同时考虑到母房的距离、出口数量、邻接双矿和地形。候选由侦察补齐，不能只凭地图图标宣称适合殖民。

当前实现启动条件包括母房 RCL 4、storage 至少 12,000、最近 100 tick 储备非下降、关键矿工和运输岗位覆盖、CPU EMA 不高于 12、bucket 至少 7,000。一次只开拓一房，总房间保护上限为 3。初期先验证一主一辅；新 spawn 出现后进入 `stabilizing`，采矿、运输、RCL 2 和持续升级满足检查后才算 `complete`，再等待 1,000 tick 才考虑下一次。

这些是保守自动门槛，不保证固定时间扩张。建筑防线封闭性、按运输周期动态配额、按截止时间续代、轻量候选规划等仍是后续改进，详见架构文档。

## API 巡检与诊断

认证已通过，账号AdamZmy，shard1 Memory读取、frontier24六模块校验和Console诊断回读均已实测。只使用本机CLI，不在参数或源码中放Token：

```sh
python3 screeps_api.py identity
python3 screeps_api.py status
python3 screeps_api.py code-check
python3 screeps_api.py memory --path frontier.telemetry.alerts
python3 screeps_api.py console --file tools/inspect-world.js
# 等下一服务器tick，再读取并核对快照tick：
python3 screeps_api.py memory --path frontier.apiSnapshot
```

固定 `https://screeps.com`，默认shard1、frontier24。凭据在项目外 `/Users/zmy/.config/screepsworld/auth-token`，权限0600；不纳入游戏部署或备份。`status`输出有限摘要并保存脱敏快照到 `state/api-frontier.json`，有fetchedAt和游戏tick。CLI支持GZIP Memory解码、错误和限流报告，不自动重试写请求。

`console --file`只提交表达式，需要回读确认执行。服务端限制表达式经JSON序列化后≤1024个UTF-16字符，客户端会预检。`tools/inspect-world.js`只更新一份诊断快照；creeps行依次为name、role、x、y、TTL、energy、activeWORK、spawning、refuelTargetId，sites行为type、x、y、progress。大查询拆成小文件，不把整个项目代码塞进Console。

已有root统一采样与部署，其他子代理按需读取带时间戳的脱敏工件，能源/布局/监控/战略分别有明确文件边界。API失败时不回退computer use，不把旧快照当实时；同一认证阻碍只通知一次。认证依据[官方文档](https://docs.screeps.com/auth-tokens.html)。

## 验证与部署

在本目录按需要运行：

```sh
node --check main.js
node --check planner.js
node --check expansion.js
node --check monitor.js
node verify-economy.cjs
node verify-planner.cjs
node verify-expansion.cjs
node verify-monitor.cjs
python3 verify-api.py
python3 screeps_api.py deploy
# 完成相关验证并准备实际发布后：
python3 screeps_api.py deploy --apply
```

经济检查覆盖恢复体型、矿位与容器、部分负载、仓库循环、实际升级节流、单矿位换体、持久补能目标及矿位预约；布局检查覆盖真实房间地形、已有建筑、堵路、失败重试和逐级施工；扩张检查覆盖储备/CPU/岗位门槛及自给验收。模拟不能替代线上吞吐、CPU 与续代观察。

Codex 本任务已设置每 20 分钟复查的 heartbeat，名称“Screeps World 基地巡检”、ID `screeps-world`。游戏代码和服务器侧监控逐 tick/每 20 tick 运行；Codex 的复查依赖本机API客户端、网络与有效Token。仅重要进展、故障或需用户处理时通知。最近人工/代理读取结果记录在 `LIVE_STATUS.md`。

仅整合者通过API发布六模块。deploy默认预览；--apply校验AdamZmy/frontier24、备份远端代码、保留其他模块、上传并回读比对，不切分支；无变化不POST。写入结果不明时先code-check。发布后仍要通过Memory确认版本、tick推进及实际策略效果。旧分支与历次部署备份在backups/。不自动调用市场、不购买订阅，也不操作其他游戏项目。

## 2026-09-25.3 能源账本与动态调度

当前发布已扩为五模块，加入ledger.js，需运行 `node verify-ledger.cjs`。详见 [ENERGY_METRICS.md](ENERGY_METRICS.md)。运输由固定配额改为线路往返需求加持续积压反馈；矿工按孵化和行程提前续代；施工按能量预算执行，剩余供给用于升级；储能模式12000/18000滞后避免反复切换。G/eta来自实际事件，缺测与统计限制明确标记。

面板：https://screeps-energy-observatory.vercel.app ，源码 `/Users/zmy/screepsworld/dashboard`。页面可见时60秒检查、服务端缓存120秒。最新上线配置和实测状态以LIVE_STATUS.md为准。原20分钟巡检已加入持续低效诊断、自主局部修复和效果复核。

分级建筑地图：https://screeps-energy-observatory.vercel.app/#layout 。提供真实主房地形、331项规划的RCL1–8累计/新增视图、坐标定位和施工门槛。建造状态为有时间戳的API快照，当前RCL随遥测更新；更新导出步骤在dashboard/README.md。地图在网页绘制，未增加游戏运行逻辑或常驻Memory。

2026-09-25T03:54Z：Vercel CLI登录、敏感生产环境变量配置和重新发布均已完成，公开API已经返回真实游戏账本。此前“未配置凭据”阻碍已解决，不应再要求用户重新登录。

`.4` 修正施工限流：只有已到目标施工范围、携能且可工作的工人才共享施工预算；赶路、补能或让位的工人不占额度，前往工地的移动每tick执行。该修复针对在线发现的退役矿工误占施工预算，回归测试覆盖远处4WORK不再压低现场3WORK的产出。

`.5` 将总用能率设为面板主指标，目标90%，纳入真实发展与生产/维护支出，保留G/eta和库存/损耗的独立口径。账本修复墓碑/残骸取能的事件归属；配送改为优先补给缺能工人，再补健康的控制器储备，builder就绪门槛与90%补给高水位一致。独立覆盖、可持续判断及费用必要性检查见ENERGY_METRICS.md。

## .6 规划与运行边界

复杂战略、规划说明和候选房完整布局由Codex保存在本地。游戏Memory只保存活跃房间执行数据、候选摘要、当前任务和有界监控。`plans.js`是静态布局归档，首次开拓或拥有某房间时一次解析该房数据，保持原建筑坐标；日常侦察只读摘要。未归档或被修改的规划不会自动删除。新房归档由后续Codex巡检处理；无需Codex在线即可恢复已归档候选并开拓。

初次完整归档为 `state/room-plans-before.json`；发布前副本为 `state/room-plans-predeploy.json`。后续归档使用新快照，不覆盖这两份基线：

```sh
python3 screeps_api.py memory --path frontier.rooms > state/room-plans-latest.json
node tools/build-plan-archive.cjs --snapshot state/room-plans-latest.json --output plans.js
node verify-planner.cjs
python3 screeps_api.py deploy
python3 screeps_api.py deploy --apply
```

生成器按内容版本增量合并既有plans.js；当前快照仅有摘要时保留旧payload和已签发archiveId。缺失归档引用会拒绝覆盖，不能删除plans.js后拿摘要重建。运行时直接对完整JSON作精确比对后才迁移，每tick至多一房；拥有或当前开拓房保留可执行详单。无法恢复归档时，仅对已经激活的房间重算一次，正常失败重试间隔500tick；未完成候选不自动变成可开拓房。

常规moveTo仍复用15tick路径；配送目标在同优先级内保持，紧急供能可抢占。连续受阻时显式清理旧路径，疲劳等待不算受阻。跨房路线与出口选择另有有限缓存，并检查最新威胁。

`status.performance`与网页“计算开销”显示每20tick窗口的主循环CPU、阶段开销、Memory体积、配送目标切换和受阻重算。CPU包含首次Memory访问，但不包含进入main.loop前的初始化或返回后引擎工作；`totals.tick`保留进入本轮前的CPU贡献。它与能源300/1500/6000tick窗口不同。历史最多60条。发布和在线验证结果见LIVE_STATUS.md。

`.7` 修复成长阶段施工完成后的预算缺口：没有工地、维修或储存工作的builder转为upgrader，转换当tick不追加升级，之后加入同一升级配额和补员统计。基础建设短空档、RCL1、紧急防降级、bootstrap与pioneer维持原行为。不要把转岗前未计入预算的额外升级当作可持续收益。

`.8` 修复侦察出口撞墙：出口候选先排除不可通行实体和占位单位；连续真实受阻后清除旧路径，失败出口暂避50tick（最多8格），全部受阻则10tick后重试。平时仍复用路线/出口缓存，疲劳与旧停滞记录不触发重选。不能用moveTo返回OK或“能到出口旁一格”代替真实跨房成功。
