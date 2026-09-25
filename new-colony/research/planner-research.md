# Screeps World 自动布局源码研究（2026-09-25）

本次只研究公开源码和本地脱敏地形快照；没有读取凭据、请求游戏 API、使用 UI、修改六个游戏模块或网站、部署。源码副本在 `research/planner-sources/`。结论以固定提交为准，不用星数、截图或 README 的“自动”代替源码证据。

## 给整合者的一页结论

**优先深入 The International 的完整规划流程，优先抽取 Overmind / International 的独立 min-cut；目前没有一个被核查的完整 planner 能不加适配就满足“保留现有 spawn、10 extension、tower、3 container 和道路”的要求。** 这不是现成算法不可用，而是这些 bot 的默认产品目标是空房生成或迁址重建；现有 RCL3 基地的硬约束不能被事后合并几行坐标替代。

| 候选 | 已核实算法 | 本房优点 | 关键不匹配 | 建议 |
|---|---|---|---|---|
| The International | 固定 fast-filler 核心 + 自动 hub/labs/grid extension + 加权 min-cut + 分级道路 + 多候选评分 | 分级输出最完整；link 有具体功能；地形自适应强于整块 bunker | 初始化只读地形，无固定既有设施输入；min-cut 后允许 source/ctrl 独立盾；源码有索引 0 / 路长评分问题 | 完整算法学习和后续离线原版对照的第一候选，先修验收再决定采用 |
| Overmind | 自动 bunker 锚点；可人工指定 hatchery/commandCenter；独立 RoadPlanner/BarrierPlanner/minCut | 接口清楚，MIT；leaf min-cut 已离线跑通；按控制器/远矿需求加 link，不补满额度 | 大模板需空地；会迁址拆建筑；模板道路不能等同最短交通网 | 分别复用防线、道路、需求 link 逻辑最省成本；模板能否适配由真实地形实验决定 |
| TooAngel | 从 controller/storage 出发预计算资源/出口路径，沿最长路径放建筑，分层封出口 | 全流程成熟、适应非规则地形、有分级施工 | 长路径沿线排楼与紧凑目标相冲；exit links/全出口路不等于本房业务需求；无 min-cut；会拆错位设施；AGPL-3.0 | 学习“先路后楼”和执行层，不作为本房直接替换首选 |
| KasamiBot 历史源码 | 7×7 core + butterfly wings + 单散 extension 补位 + 目标道路 | extension 子模块相对独立；有路径/直线距离≤1.5 的补位约束 | 当前 HEAD 已删源码；历史代码会搬 spawn/拆旧 extension；边境墙非 min-cut；许可元数据不一致 | 次级参考，尤其看道路约束与去堵路；不直接整包接入 |

原始两套 min-cut 已用 W21N26 快照 **tick 73929558 / 2026-09-25T06:21:06.085Z** 离线执行并检查：现有核心 12 座（1 spawn、10 extension、1 tower）加一格保护边界，International 得 27 格，Overmind 得 25 格；再将现有道路/容器纳入（总 36 对象）时为 36/34 格。四例出口八方向 flood 均未触及目标、未落天然墙/自然对象，受保护地形均为单连通。**两算法保护边界语义不同，不能用格数宣称谁更优；这不是完整规划通过。** 运行代码/逐坐标结果：`research/mincut-demo/run.cjs`、`result.json`，Node 25 原始算法本机耗时 10–31ms，不等于 Screeps CPU。

下一步研究应该是将固定设施、天然障碍、矿工站位、道路业务目的和“核心内部运输不穿出防线”组成统一评测输入，让原版候选失败原因可比较，再决定最小适配范围；不急于发布新布局。

## 1. 固定来源与许可

| 项目 | 固定提交（本次克隆） | 许可证文件 | 入口与算法文件 |
|---|---|---|---|
| [The International](https://github.com/The-International-Screeps-Bot/The-International-Open-Source) | [`7e5106eebffb9627cf08cf893b6846012d970b90`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/commit/7e5106eebffb9627cf08cf893b6846012d970b90), Main, 2024-08-27 | [MIT](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/LICENSE) | `src/room/construction/communePlanner.ts` (3498行), `minCut.ts` (450行), `basePlans.ts`, `rampartPlans.ts`; `src/constants/general.ts` stamps |
| [Overmind](https://github.com/bencbartlett/Overmind) | [`5eca49a0d988a1f810a11b9c73d4d8961efca889`](https://github.com/bencbartlett/Overmind/commit/5eca49a0d988a1f810a11b9c73d4d8961efca889), master, 2019-06-14 | [MIT, Ben Bartlett](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/LICENSE) | `src/roomPlanner/{BasePlanner,RoomPlanner,RoadPlanner,BarrierPlanner}.ts`, `layouts/bunker.ts`, `src/algorithms/minCut.ts` |
| [TooAngel](https://github.com/TooAngel/screeps) | [`87645a0b933360224737cca3b18ae9d112f46fef`](https://github.com/TooAngel/screeps/commit/87645a0b933360224737cca3b18ae9d112f46fef), master, 2026-08-17 | [AGPL-3.0](https://github.com/TooAngel/screeps/blob/87645a0b933360224737cca3b18ae9d112f46fef/LICENSE) | `src/prototype_room_init.js`, `prototype_room_basebuilder.js`, `prototype_room_wallsetter.js`, `prototype_room_routing.js`, `prototype_room_costmatrix.js` |
| [KasamiBot](https://github.com/kasami/kasamibot) | [`6830e7be851385249ad53cac5aaf259fad2b60e6`](https://github.com/kasami/kasamibot/commit/6830e7be851385249ad53cac5aaf259fad2b60e6), 2017-11-13，已检出历史源码 | [根 LICENSE.md: CC-BY-3.0](https://github.com/kasami/kasamibot/blob/6830e7be851385249ad53cac5aaf259fad2b60e6/LICENSE.md)，根 package 同；嵌套 ts-source/package 另写 MIT，存在元数据不一致 | `ts-source/src/lib/{spawn,extension,base}.ts`, `managers/{Build,Road,Wall}.ts`; 已编译 `source/lib.extension.js` 等 |

Kasami 当前 HEAD [`c1dd61799f682dc118f4b58ae19a21878052d456`](https://github.com/kasami/kasamibot/commit/c1dd61799f682dc118f4b58ae19a21878052d456) 的提交信息就是 `Removed code`。不能给用户一个当前 master 链接就宣称能直接复制；本研究固定到删除前的父提交。许可列仅记录文件，不把仓库内许可冲突自动视为已解决。

## 2. The International：最完整，但不是保留旧城的现成函数

### 实际生成顺序、输入输出

[`CommunePlanner.attemptPlan`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L221) 使用 RoomManager、Room、Game/Memory 和扩展 prototype；步骤为避让 source/mineral → fastFiller → grid → 升级站 → source 站位 → hub → labs → 预留矿旁建筑 → extension → 资源路 → power/nuker/observer → grid 道路 → mincut → source 建筑 → 防线入口 → towers/塔路 → mineral → 单格盾 → RCL road quotas → score/record。约 3.5k 行并非单纯的摆楼函数。

- fastFiller 是预定义 stamp（集中式快速补能区）；hub 是 storage/terminal/link/factory 周围站位。其他 extension 动态放到网格道路邻格，所以是“模板核心 + 动态周边”的混合算法，不是整间固定模板。
- 候选起点为 controller、两 source、最近 source-controller 路中点、source-source 路中点，随后按当前地形做距离变换/泛洪寻找可行 stamp。不是枚举所有布局取得全局最优。
- 输出 `basePlans.map[packedCoord] = [{structureType,minRCL}, ...]`，ramparts 另有 minRCL/防核/防威胁/需要储存建筑等条件。`record()` 编码为 packed strings，另存 source paths、mineral path、upgrade path、stamp anchors、road quotas 和 score。接本项目应在编码前转为简单 `{type,x,y,rcl,purpose}`，不引入整套 Memory 编码。
- `setBasePlansXY()` 按 `CONTROLLER_STRUCTURES` 自动决定解锁级别；道路使用关联建筑 minRCL，矿/ctrl 干线当前写 RCL3，矿物设施 RCL6。要改为我们所需经济时间表，需在输出适配层显式映射。

### 矿、controller、link、道路、防线

- source 邻格按到核心路径排序，选择矿工站位和 container；矿旁候选结构不占资源交通路。controller 先最大化升级可站邻格，再靠近核心，container 与后续 link 可能同坐标，是“升级替换”，不是允许永久 container/link 共存。
- link 是 controller + hub + fastFiller + 每源一个，正常两矿五个；没有“剩一个配额随便补满”的策略。但是否值得给近矿 link 仍是我们经济层的决定。
- [道路](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L2243) 有具体 source/upgrade/mineral/tower 目标，加动态 grid 连接；权重偏向已有 grid/road，并非几何最短路径。`planGridCoords` 只给邻接建筑的格规划路，比全房棋盘全部铺路克制；fastFiller 内仍有模板路，`pruneFastFillerRoads()` 在主流程被注释。
- [mincut](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L2401) 将 stamp 周边和 hub-fastFiller 连线纳入保护，对与 fastFiller 不连通的保护坐标会做 prune；用深度权重偏向近核心切线。`generalShield()` 对外部 source/link/upgrade 等再加单格 rampart，并计 unprotectedSources 惩罚。**这允许独立盾或外部矿区；“有 rampart”不保证补给路线全在同一安全连通区。** 必须独立验证我们的核心 extension、labs、storage 服务点连通。
- 塔在 min-cut 内候选点按对防线的最小伤害评分搜索；不是仅围住 storage。

### 明确适配工作和风险

[`tryConfigurePlan`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L487) 初始化只复制 terrain 数组，没有 lockedBuildings 参数。要保留当前设施，至少要在各 stamp/站位/路网搜索前注入：固定楼占位、既有道路低成本、固定 container/矿工位、已有 extension 计数与功能分类，以及已占位置与 stamp 能否兼容的判定。不能先生成60 extension再追加既有10座。

静态阅读发现须验证的两个直接问题：

1. [`planSourceStructures():1247`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L1247) 用 `if (!closestCoordIndex)`，合法下标0被视为未找到，可能漏 source link。
2. [`findScore():3131`](https://github.com/The-International-Screeps-Bot/The-International-Open-Source/blob/7e5106eebffb9627cf08cf893b6846012d970b90/src/room/construction/communePlanner.ts#L3131) 加的是 `this.sourcePaths.length`（路径条数），不是总路径长度；因此不能依赖原评分自动避免远矿绕路。

完整离线依赖：constants/stamps、utils、codec、BasePlans/RampartPlans、CustomPathFinder、TowerUtils、RoomOps，以及 Room 的 distanceTransform/findClosestPos 等 prototype。编码层还引入 base32768，实际可在输出前去掉。完整抽取成本高；只提取 `minCutToExit(sources,costMatrix) -> Coord[]` 成本很低，已跑通。

## 3. Overmind：拆分边界清晰，适合抽取子算法

- [`BasePlanner`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/BasePlanner.ts) 找能装 bunker 的地形，用距离变换，过滤 controller/source/mineral 冲突；最多随机采样10锚点，再以 source+controller 的**寻路长度和**选优，阈值75。代码寻路 `ignoreStructures:true`，所以不是既有建筑适配器。
- [`RoomPlanner.generatePlan`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/RoomPlanner.ts#L281) 按 RCL 读取模板并平移。源码里旋转调用是注释，不能宣称原实现自动搜索全部旋转。可手动/半自动组合 hatchery/commandCenter/bunker。
- 模板 `BuildingPlannerOutput` 是 `{name,shard,rcl,buildings:{type:{pos:[{x,y}]}}}`；flatten 后 `{type:RoomPosition[]}`；barrierLookup/roadLookup 独立，容易转成项目静态计划。
- [`RoadPlanner`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/RoadPlanner.ts#L151) 从 storage 连接 colony.destinations（hatchery/upgrade/mining）；避让计划障碍、现有不可走建筑和工地。plain3/swamp4，已规划路径偶数格降到2，鼓励并路。天然内部墙设45，允许规划隧道路，是有意识的高成本穿墙候选，**若本项目禁止凿墙道路，须把墙明确设255**。原算法按目标顺序生成加权最短路径，不是全网 Steiner 最优或每条路线步数最短。
- [`BarrierPlanner`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/BarrierPlanner.ts#L46) 用核心矩形+padding调用 mincut，再单独保护 controller。bunker 默认RCL7改为 bunker 格逐格盾，不再要求全部旧外围 rampart 维护；这与本房“统一可走安全区”的目标不同，不能连施工策略一起照搬。
- [`link逻辑`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/RoomPlanner.ts#L764) 核心link后先补controller，再按实际距离从远到近补source；找不到新业务 anchor 就返回，即使RCL允许更多也不凑数。source link位取 source→storage shortest path上距source2格，需结合实际矿工站位复核；controller link靠近battery。
- [`demolishMisplacedStructures`](https://github.com/bencbartlett/Overmind/blob/5eca49a0d988a1f810a11b9c73d4d8961efca889/src/roomPlanner/RoomPlanner.ts#L574) 会拆非模板建筑，有spawn迁址安全门槛。整包执行不满足原位保留。

完整planner依赖Colony、Mem、Pathing、各种Room/RoomPosition扩展、lodash、日志、visual/profiler；只拿layouts是低成本，只拿mincut是低成本，重用完整RoomPlanner是高成本。`getCutTiles(roomName, rectangles, preferCloserBarriers, limit, visualize, bounds)->Coord[]` 只需要terrain、lodash.take和空视觉桩；本次 Node 原版执行已验证。作者注释来源 Saruss → Chobobobo → Muon，保留署名链。它保护矩形边，内部作为不可达区域，并非任意点源的完全同义接口。

原作者说明为半自动规划和可拖动布局部件：[Ben Bartlett, Screeps #2: Interior Design](https://bencbartlett.com/blog/screeps-2-interior-design/)。root 已用 `research/check-bunker-fit.cjs` / `bunker-fit.json` 实测原始 RCL8 footprint：保持现 spawn `(21,28)`，允许对应模板 3 个 spawn 槽，穷举 3×8=24 种平移/旋转/镜像，天然地形兼容为 0；放开 spawn 位置时全房有 352 种朝向和位置组合。这证明原位整张模板直套不适合本房，并不否定 Overmind 子模块。该实验也不等于 352 种自由布局均可保留旧设施或物流/防线合格。

## 4. TooAngel：全自动但优化方向不同

[官方仓库 BaseBuilding 文档](https://github.com/TooAngel/screeps/blob/87645a0b933360224737cca3b18ae9d112f46fef/doc/BaseBuilding.md)与[`prototype_room_init.js`](https://github.com/TooAngel/screeps/blob/87645a0b933360224737cca3b18ae9d112f46fef/src/prototype_room_init.js)一致：controller旁站upgrader、旁放storage、再设filler/pathStart；到每个source/mineral/出口中点规划path；选择可利用空间最多的长path，沿边放spawn/extensions/labs等。输出为 `room.data.positions.structure[type]`、`positions.creep`、`pathEndLevel`，路径另缓存到memory；RCL按配额和pathEndLevel施工。

- source 找第一可用站位，link靠source；storage/filler有核心link；出口路径也可设link。适合其固定路径物流，而我们没有出口link业务，须删去对应目标生成。
- 道路有明确资源/出口目标，但“每出口都需要路”是bot的战略假定。最长道路沿边排楼不保证紧凑或全部供能点短程。
- [`prototype_room_wallsetter.js`](https://github.com/TooAngel/screeps/blob/87645a0b933360224737cca3b18ae9d112f46fef/src/prototype_room_wallsetter.js) 是分层closeExitsByPath与ramps开口，不是图论mincut。
- [`prototype_room_basebuilder.js`](https://github.com/TooAngel/screeps/blob/87645a0b933360224737cca3b18ae9d112f46fef/src/prototype_room_basebuilder.js) 会销毁不在缓存path的road（allowRoad flags可豁免），也会处理错位spawn搬迁；没有“保留旧城再搜索余量”的全局接口。
- 依赖config、Room/RoomPosition原型、costmatrix/path cache、Game/Memory/lodash及执行层；离线抽完整规划需要较多适配。可读性/算法隔离度低于Overmind leaf modules。AGPL许可和整合方式也应独立处理，不能默认为MIT片段。

## 5. KasamiBot：历史版灵活extension值得读，完整套用不合适

[原作者特性页](https://kasami.github.io/kasamibot/features.html)明确说明7×7核心、butterfly wings、不足则走廊/单散extension，并在RCL4后搬初始spawn。源码核查：

- [`lib/spawn.ts`](https://github.com/kasami/kasamibot/blob/6830e7be851385249ad53cac5aaf259fad2b60e6/ts-source/src/lib/spawn.ts)：distance transform找核心空地；候选评分对source/controller用range，不是真实地形最短路；mineral用于避免核心重叠。
- [`lib/extension.ts`](https://github.com/kasami/kasamibot/blob/6830e7be851385249ad53cac5aaf259fad2b60e6/ts-source/src/lib/extension.ts#L125)：`getRoomExtensionPositions(basePos) -> {ext:string[],roads:string[]}`，坐标字符串为 `x-y-roomName`。先主翼/下翼，再去掉堵关键目标的extension，补足60时限额50尝试、只接受寻路长度不超过range×1.5的单散点。此比纯欧氏扩展更直接限制绕路，但源码未把所有后续新补位同步加入extcm，且没有防线内服务连通约束。
- [`managers/Build.ts`](https://github.com/kasami/kasamibot/blob/6830e7be851385249ad53cac5aaf259fad2b60e6/ts-source/src/managers/Build.ts#L201) 每次会调用destroyExtensionsNotCorrectlyPlaced；后者直接destroy已有非规划extension。它在避免旧设施妨碍模板，不是在保留旧设施。
- road targets含controller、sources及RCL6矿；使用`utilities/Pathfinding.ts`和完整extension布局避让。controller container后改link，core也有固定link；不提供独立完整RCL1–8 JSON规划器，需要将施工规则转换成静态计划。
- [`managers/Wall.ts`](https://github.com/kasami/kasamibot/blob/6830e7be851385249ad53cac5aaf259fad2b60e6/ts-source/src/managers/Wall.ts#L331)在离出口2格的边境坐标筛needed walls，另有核心rampart/shell，不是mincut。

依赖 RoomPosition/PathFinder、lodash、IntelLib、source/controller container原型、base/room repository；只抽extension生成属中等成本，完整布局仍大。历史源码没有factory等后出建筑，不能按其终局布局声称覆盖当前RCL8全部需求。

## 6. 中文63、Atavus与离线随机生成器的边界

- **63“超级抠位置”**：公开教程确认原使用4个资源/controller flags与WASM priority queue，但不是原作者许可文件：[使用教程](https://sokranotes.github.io/posts/Screeps-63layout-tutorial/)。GitHub找到 [an-stu/Screeps-63bot](https://github.com/an-stu/Screeps-63bot)，固定commit `65e8206be07f3c1b27a61e0681f13ac254b9e72d`（2026-09-23），`modules/manager_planner.js`中`computeManor(roomName,[controller,mineral,sourceA,sourceB])`返回`{roomName,storagePos,labPos,structMap:{type:[[x,y],...]}}`，建筑数组按离storage距离排序、RCL使用配额前N项。依赖RoomArray/PriorityQueue/UnionFind、Room.Terrain/PathFinder和helper globals；有自定义storage标记。**这个公开快照根目录没有LICENSE，也没有查到原作者授权声明；不能称为已确认可复用的开源许可候选。** 未运行其代码，未读取该仓库打包的原始API响应，未采用其deploy目录。
- **Atavus**：论坛可证实其自述是中心点+偏移布局、计算不昂贵但刚性：[原作者论坛回复](https://screeps.com/forum/user/atavus)。本轮没有找到足以固定版本/许可/入口的独立通用planner；不拿名字当候选已验证。
- **jedislight/screeps_room_layout_generator**：[`0cf098af09fbe8ae34ef3108d298ec5b7b435e20`](https://github.com/jedislight/screeps_room_layout_generator/commit/0cf098af09fbe8ae34ef3108d298ec5b7b435e20)，2017-07-28，MIT；`main.js`+`solution.js`+`screepsConstants.js`+lodash，原生Node输入2500格terrain数组，输出dissi buildings JSON，随机变异/加权reward。是真离线生成器，但`initControllerStructures`主动删roads/rampart/wall/container/extractor，只保留1 link；只生成RCL8，缺factory，未实现固定既有设施。因此不满足本次完整房间布局目标，优先级低于前三。
- admon84/screeps-room-planner、screepers/screeps-tools 是绘制/导入/导出编辑器，不能因名字含planner便称自动算法。

## 7. 可复现离线实验与验收边界

运行：

```sh
node /Users/zmy/screepsworld/new-colony/research/mincut-demo/run.cjs
```

仅依赖Node内置`module.stripTypeScriptTypes`（本次Node v25.5.0），运行时从两仓库固定源码读取，不改原文件；去掉import/export、擦除TS、注入terrain getter/CostMatrix/pack helpers/空RoomVisual。International 的pack是`x*50+y`，项目terrain字符串是`y*50+x`，适配已明确转换。原最小割算法体未重写。

| 场景 | 算法 | cut格数 | 核心/目标暴露 | 受保护地形分量 | 本机单次ms |
|---|---|---:|---:|---|---:|
| 12座现有核心+1格邻域 | International | 27 | 0 | 589格单分量 | 30.64 |
| 同上 | Overmind | 25 | 0 | 570格单分量 | 13.44 |
| 36现有建筑/道路/container+1格邻域 | International | 36 | 0 | 659格单分量 | 29.86 |
| 同上 | Overmind | 34 | 0 | 636格单分量 | 10.92 |

这些只是样例防线，不是新布局候选，不含未来60extension/labs的空间保证；flood检查以地形与cut为障碍，故刻意不把可拆建筑当永久防线，也未把其当物流障碍。不能据此说现有交通无堵塞、所有未来楼可供能、源到仓路径已最短或已部署。

之后完整planner评测应将以下分开：

1. 固定设施保持及RCL配额；天然对象不可占、road/rampart/container叠放合法；未来container→link替换明确，不误当叠放。
2. 所有核心建筑的可服务邻格在同一保护内连通分量；从storage/filler到extension/lab/tower路径不能穿出防线再回来。只看每座楼“出口flood不可达”不够。
3. 每条road必须对应源/ctrl/矿物/核心服务/实际扩张目标；标实际最短路基线、最终道路长度、绕行率、关键窄口。删除无业务目的的支路，不能用“全路连通”代替道路有用。
4. link逐个有角色和相邻矿工/升级站/核心工位；允许少于RCL上限。经济收益与运输替代单独评估。
5. mincut保护集合必须包含保留核心与最终核心，且明确是否保护源路/ctrl路；独立矿区可以按成本取舍，但不能把核心extension散成运输需穿外部的防线口袋。

## 8. 收敛为两条后续研究路线

- **完整候选路线：The International。** 先离线跑未改算法作对照，再试保留设施适配；必须把原版失败、适配改变、结果改善分开记录。先修验或确认 source link 下标 0、source path 评分，验证 RCL 配额、各阶段服务连通、独立防线口袋，之后才判断是否值得移植。完整 planner 尚未在 W21N26 运行，不能承诺一定适配成功。
- **子算法复用路线：Overmind 的 minCut/RoadPlanner/需求 link 策略。** 原样保留来源与算法边界，在静态离线流程里调用；用固定设施作为规划输入，不接入拆迁施工逻辑。mincut 已验证可执行，bunker 已实证原位不合；RoadPlanner 及最终 60 extension 动态选位仍未做完整端到端评测。若 International 完整适配成本过高，此路线可保留成熟防线和交通算法，再明确补上本房固定设施约束。

上述为研究优先级，不是已经选定或部署的新版布局。
