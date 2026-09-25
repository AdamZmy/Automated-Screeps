# W21N26 离线布局生成器

这是对两套 MIT 开源算法的受约束适配，**不是完整 International bot，也没有运行它的完整 `attemptPlan()`**。它在固定现有 RCL3 基地的条件下调用原版动态布局、lab、道路和 min-cut 方法，输出当前游戏执行器的 `version: 3` / `roadVersion: 1` 设计 JSON。游戏内不运行规划搜索。

## 运行

依赖根项目锁定的 `@screeps/common`，Node.js 22.13+（需要 `node:module.stripTypeScriptTypes`）。无需 Steam、网络、API、凭据、私有 `state/` 或研究期间的 Git 克隆。

从仓库根目录 `/screepsworld` 执行：

```sh
npm ci
node new-colony/research/layout-implementation/generate.cjs
node new-colony/research/layout-implementation/verify.cjs
```

默认从本目录 `fixtures/` 读取 tick 73930064 的公开几何快照及旧方案，生成 `candidate-W21N26.json`、`candidate-W21N26-audit.json`、`candidate-summary.json`。也可给四个参数：世界 JSON、旧方案 JSON、输出 JSON、可选搜索摘要 JSON。路径均按调用时工作目录解析。

```sh
node new-colony/research/layout-implementation/generate.cjs world.json old-plan.json candidate.json summary.json
node new-colony/tools/verify-layout-candidate.cjs candidate.json world.json old-plan.json acceptance.json
```

`verify.cjs` 先校验 4 份原始 TS 文件的 SHA-256 和 MIT 许可，再在临时目录独立生成两次、验证结果完全一致，调用独立验收器检查现有设施保留、逐级配额/可达、lab 反应范围、出生位、Link 工位和拓扑、核心防区内交通、range-3 防御间隔和道路用途。临时目录结束后删除，不改游戏或 `state/`。

## 确实复用的源码

`vendor/` 中保留完整、未经编辑的原文件；固定提交、上游路径与 SHA-256 见 `vendor/SOURCES.json`，许可证见 `vendor/LICENSE-International` 和 `vendor/LICENSE-Overmind`。`runtime.cjs` 只在加载时移除 import/export、装饰器和 TypeScript 类型，通过 VM 提供最小 Screeps 对象适配。

| 原始来源 | 实际调用及用途 |
| --- | --- |
| [International `communePlanner.ts`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts) | `generateGrid` / `pruneGridCoords`（533/807 行）生成/整理路网分组；`planStamps` / `findDynamicStampAnchorWeighted`（1398/1656 行）搜索可行建筑格；`hub` / `findStorageCoord`（1965/2096 行）四向 storage/terminal/link/factory 核心；`labs`（2114 行）2 输入 + 8 输出共同范围；`gridExtensions`（2214 行）；observer/nuker/powerSpawn 单格设施。 |
| [International `general.ts`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/constants/general.ts) | 加载原版 `stamps` 定义。固定旧 10 extension 代替 fastFiller 的配额计数，不摆其不兼容旧基地的 fastFiller 大模板。 |
| [International `minCut.ts`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/minCut.ts#L148) | 原 `minCutToExit` 函数，作者注释保留 clarkok / Carson 署名；按 tile 容量的修改 Edmonds–Karp 实现。输入共同核心保护区与真实 terrain，输出最终 perimeter rampart 坐标。 |
| [Overmind `RoadPlanner.ts`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/RoadPlanner.ts#L168) | 原 `generateRoadPlanningCostMatrix` / `generateRoadPath`（168/219 行），terrain 成本、建筑避让、每隔一格降低已规划道路成本，促使后续实际目的地共用道路。 |

International 固定 commit `7e5106eebffb9627cf08cf893b6846012d970b90`；Overmind 固定 commit `5eca49a0d988a1f810a11b9c73d4d8961efca889`。均 MIT；前者 Copyright 2022 The International Screeps，后者 Copyright 2018 Ben Bartlett。

## 本项目适配边界

1. 现有 36 个非 controller 建筑全部硬固定，包括 Spawn、10 extension、tower、3 container、21 road；source/controller 原工作站保持。保留旧 RCL 和 tag。自然对象与真实地形不可占用。
2. 先预留两矿和控制器的真实经济道路，再摆未来建筑。动态搜索使用从固定 Spawn 出发的真实步行距离，搜索 10/11/12 格可达半径和 4 个 grid 相位，共 12 组；这不是最优布局的数学证明。
3. 原 `generateGrid()` 会从出口设种子；适配器仅在调用该方法时隐藏出口种子，之后恢复出口限制。最终道路只连接真实 source/controller/mineral/建筑服务点，不为远期想象需求修出口路。
4. 额外 2 Spawn、5 Tower 使用原 `planStamps()` 搜索可达、临路单格位置；**未运行 International 的全套塔伤害优化器**。实际防线战斗能力仍取决于塔能量、守军、Rampart hits 和维修能力。
5. 原 Overmind 默认允许内部天然墙作为高成本“隧道”；适配器将其改为不可通行。所有未来建筑、自然对象、固定矿工和 hub 工位按最终障碍处理。原生 `PathFinder` 用单房八方向精确 Dijkstra 适配，保留传入成本与终点 range；这并非 Screeps 原生寻路实现，也不宣称同样 ops/CPU。
6. 每个核心建筑周围 range 3、共同服务路周围 range 1 纳入同一次 min-cut；验证所有核心都通过同一防区服务。这里不靠给孤岛建筑单格盖盾掩盖交通出防区。两个矿区与矿物开采点仍允许在核心防区之外。
7. 完整 bot 的经济管理、施工节奏、矿位/升级位发现、完整 fastFiller 模板、扩张选址、塔伤害优化和远房路线不在适配范围内。当前输入要求已有主 Spawn、sourcePlans、controllerSpot；不能直接把空白邻房 JSON 当作通用自动开荒输入。

## 稳定候选结果

选中 radius 10 / phase 0；71 road、41 perimeter rampart，60 extension、3 spawn、6 tower、10 lab，其他核心设施满足 RCL8 配额。所有 36 个现有设施保留，逐 RCL1–8 容量与服务可达通过。

| 指标 | 旧方案 | 候选 |
| --- | ---: | ---: |
| Storage 至 Extension 平均步数 | 6.517 | 4.317 |
| Storage 至 Extension p95 / 最远步数 | 23 / 24 | 7 / 7 |
| 核心补给必须经过防区外部 | 5 extension + 1 extra-link | 0 |
| 无遮顶核心距出口可达区域不超过 3 格 | 未以此作为旧设计约束 | 0 |
| 无用途出口道路 | 存在 | 0 新增 |

这些是地形/最终建筑障碍下的静态步数，不是 creep 动态拥堵、疲劳、实时吞吐或战斗存活率的实测。占住 hub 服务格后，其他核心仍可在防区内服务；现有 `(15,37)`、`(14,36)` 两格道路没有对应新目标，因已建而保留。

## Link 协议

| tag | 坐标 / RCL | role / flow | 工位与用途 |
| --- | --- | --- | --- |
| `source-link-5982fd14b097071b4adbeb7c` | 16,40 / 5 | source / sender | 矿工在 17,41；优先 controller，满或未建时 fallback hub。替代远矿长途搬运。 |
| `hub-link` | 25,28 / 5 | hub / receiver | 服务位 25,29 同时相邻 Storage；由搬运逻辑取能供核心/入库，禁止 Storage→hub 无目的循环。 |
| `controller-link` | 17,23 / 6 | controller / receiver | 固定升级位 16,23 同时在 link 取能与 controller 升级范围内。 |

正式结构含 `linkRole`、`flow`、`label`、`purpose`、`serviceArea`、`serviceSpot`，发送端含 `targetTag` / `fallbackTargetTag`，hub 含 `serviceMode`。运行时必须执行接收容量与实际需求判断，不能将这些静态设计连线当成实时吞吐。

`optionalReservations` 独立于 `structures` / 配额 / 施工：近矿 Link 25,26（RCL7）、西候选 5,12 与南候选 5,44（RCL8），全部 `optional:true, enabled:false`。近矿目前只需短路搬运，必须实测至少节省 2 CARRY 或解决拥堵；入口还要求实际外矿回流、至少 5 energy/tick 的预期回流量及安全装卸道路。**西南候选只根据本房到出口路径预留，没有验证相邻房矿点与跨房路线，不是应自动开建的最终站点。** 激活需重新验收布局和经济证据，节省运输身体还必须抵过传输损耗、接收搬运与维护成本；上述流量/部件阈值本身不代表已盈利。没有用 6 座 Link 配额倒推需求。

施工批量、bucket/能量门槛由原运行时控制，生成器不更改它们。`roadClass:economy` 的真实矿/控制器干线标 RCL2；其他 access 路按设施需求至少 RCL4，最终是否施工仍由运行时门槛决定。
