# Screeps World 操作记忆

- 这是独立的 **Screeps World** 项目：AdamZmy / 官方shard1 / 活动分支frontier24，初始主房W21N26，Origin spawn `(21,28)`。
- 用户目标：提高主基地升级效率，以双能源、交通可达和后续扩张空间选择辅房；每房提前规划RCL1–8。
- 用户明确要求“站在巨人的肩膀上”：布局、道路、防线等设计先深入研究GitHub源码、作者说明和玩家论坛的成熟方案，记录可核验来源、许可、适用条件及实际地形验证；优先复用已有算法。不能仅借鉴项目名称/管理架构后自行拼布局，也不能将数量合规或可达当作布局质量验收。先完成研究与方案对比，再实施替换。
- Link可作为主房入口的外矿接收中继：运输者跨房后卸载，再传给房内仓库端；按实际外矿路线、吞吐、损耗及RCL配额评估并预留，不为填满上限任意摆放。新基地、外矿、交通走廊要统一规划。
- 唯一游戏源码目录 `/Users/zmy/screepsworld/new-colony`，六模块为main.js、planner.js、expansion.js、monitor.js、ledger.js、plans.js。Screeps Arena、其地图编辑器及旧结构图均不属于此项目。
- **用户明确要求全部游戏数据读取与操作仅通过HTTP API，禁止computer use、截图、原生UI或浏览器自动化；不以界面为失败回退。** 此偏好持续适用于后续巡检及子代理。
- 读取可复用操作skill：[screeps-world-api](/Users/zmy/.codex/skills/screeps-world-api/SKILL.md)。每次先读本文件、README.md及LIVE_STATUS.md，修改游戏代码前读相关模块和ARCHITECTURE.md。历史研究建议不等于已实现功能。

## API 入口与凭据

- 默认 `python3 screeps_api.py status`，固定服务 `https://screeps.com`，默认shard1/frontier24；`identity`核验AdamZmy，`code-check`核验六模块。
- 认证已真实通过，Token仅由CLI从 `/Users/zmy/.config/screepsworld/auth-token` 读取。文件0600、目录0700，不回显、不放源码/游戏Memory/日志/命令行参数/版本备份，不读取客户端会话凭据。Token只用X-Token请求头，不传其他主机，拒绝重定向。
- `status`输出并保存 `state/api-frontier.json`，包含fetchedAt和游戏tick。新的fetchedAt/HTTP200不代表遥测已更新；与此前有效tick比较，在正常20tick采样窗口内相同属正常，跨足够窗口仍未前进则通过Game诊断快照核验。磁盘快照不代表实时。
- HTTP401/403或其他API失败：记录准确阻碍，不猜测状态，不反复重试同一失败凭据，不转用UI；同一阻碍只通知一次。用户更新凭据后再验证。429遵守限流。

## 诊断、开发与部署

- 需要逐tick详情时：`python3 screeps_api.py console --file tools/inspect-world.js`，下一服务器tick后运行 `python3 screeps_api.py memory --path frontier.apiSnapshot`。必须核验快照tick已更新，accepted仅表示排队。
- 诊断表达式只更新单份快照，无游戏行为intent。Console限制是表达式JSON序列化后1024个UTF-16字符，注释、转义均计入；客户端会在发送前检查。更多查询拆成明确的小文件。
- `apiSnapshot.rooms[].creeps`为[name,role,x,y,TTL,energy,activeWORK,spawning,refuelTargetId]；sites为[type,x,y,progress]。详细能量/道路/历史优先读telemetry，避免重复采样。
- `python3 screeps_api.py deploy`预览差异；`deploy --apply`经账号/分支校验、远端备份后上传，再GET回读验证。无变化不POST，不切活动分支，不用旧客户端同步目录部署。写入结果不明时先code-check，不盲重试。
- 用户已授权本游戏的日常代码与策略维护，无需为每次可逆修复重复确认。仍需相关行为验证及真实在线版本/错误/策略效果核验，不把离线测试当实测吞吐或扩张成功。
- 不重开世界、不购买服务、不操作市场或其他账号；除非用户另行明确扩大范围。

## 子代理分工

- root是唯一凭据持有、API采样、Console提交、整合和部署者。子代理默认只读root提供的脱敏state工件，注明fetchedAt和tick；不重复调用API或自行部署。
- 能源代理负责main.js及经济测试；布局代理负责planner.js及布局测试；监控/战略代理分析工件并反馈证据，文档改动需明确文件所有权。监控模块改动单独指定所有者。
- 每次启动有限、独立的小任务，约定文件归属，交付发现/测试/待验证点并释放。不要把子代理当永久运行进程；游戏代码逐tick工作，heartbeat定期复查。
- 长期状态写LIVE_STATUS.md与有限游戏Memory，不依赖代理永久保留context。只在重要进展、故障、干预结果或需用户处理时通知。

## 能源指标与网页

- 指标说明为 `ENERGY_METRICS.md`，账本是 `Memory.frontier.energy.rooms[room]`，status摘要是northStar。主指标为总用能率utilization=(真实升级+计划内建设+孵化+维修+塔耗能)/同一完整样本的理论供给，目标≥90%；主窗口1500tick，辅助300/6000。G/eta保留为发展指标。运营支出须核验必要性，不能为了达标乱花能源。库存、link损耗、非计划建设和残差分列；预热、缺测、外援和库存透支不能冒充持续效率。
- 2026-09-25.3已接入动态运输、提前续代、施工预算和升级分配。持续低效看eligible与indicator；明确的矿工缺失、满箱掉落、停工应独立诊断。
- 网页源码 `/Users/zmy/screepsworld/dashboard`，地址 https://screeps-energy-observatory.vercel.app 。页面60秒检查、服务端缓存120秒，历史来自有界游戏Memory。
- 网页 `#layout` 的分级建筑地图使用API导出的静态规划/地形/建筑快照，当前RCL另随现有遥测更新。布局改版或RCL里程碑后按dashboard/README.md更新快照并发布；不能把快照建造状态称为实时。绘图在网页完成，不增加游戏每tick代码或常驻Memory。
- 用户已要求发布Vercel实时网页，允许将Screeps凭据保存为该项目敏感生产环境变量SCREEPS_TOKEN；运行时仍只请求固定Screeps域名。绝不将凭据放网页源码、日志、工具输出、游戏Memory或普通文件。CLI登录与插件连接独立。

## 规划与执行边界（用户2026-09-25明确偏好）

- 复杂战略、语义说明、完整候选布局和研究记录留在本地项目，由Codex持久维护。游戏Memory只留活跃房间执行数据、候选摘要和有界监控，不将所有未来房间详单留作每tick解析。
- `plans.js`是静态执行归档模块，冷房激活时一次加载建筑坐标。仅精确匹配已归档版本的冷房可从Memory精简；未归档或已修改的计划必须先归档，不能直接删除。生成命令和恢复机制见README。
- `Memory.frontier.performance`每20tick发布CPU阶段、角色开销、Memory体积及移动计数，历史最多60条。先看实测归因，再优化；疲劳和合法驻守不算堵塞，目标正常完成后的切换不算震荡。
