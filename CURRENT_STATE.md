# Screeps World 当前交接

- 唯一 World 源码目录：`/Users/zmy/screepsworld/new-colony`；账号 AdamZmy，官方 shard1，活动分支 `frontier24`。
- 用户要求暂停的巡检 automation `screeps-world` 仍为 `PAUSED`；代码发布不得恢复调度。
- 当前发布：v0.5.3 / game build `2026-09-27.5`；Rampart 停建代码提交 `8284e96`。
- 2026-09-28T02:15Z 已通过 API 上传并逐模块回读；备份位于 `new-colony/backups/api-deploy-20260928T021529.075544Z/remote-code.json`。
- 上传后 shard tick 暂停在 `73990280`，Memory 仍报告旧构建 `.3`；远端源码 hash 已确认 `.4`，下一游戏 tick 才会加载。

## 代码边界

- `main.js` 负责装配模块、tick 调用顺序和异常隔离；具体游戏策略位于职责模块。
- `runtime.js`：移动、距离、能量、矿位及逐 tick 房间查询缓存。
- `development.js`：发展预算、Controller 固定站、升级、施工、补能和矿工动作。
- `logistics.js`：运输需求、预约、取送目标、多卸货口和 Hauler 状态机。
- `workforce.js`：身体、有效产能、续代、岗位缺口和 Spawn 决策。
- `infrastructure.js`：Tower、safe mode 和 Link；`metrics.js`：CPU 阶段、角色和移动计数。
- `planner.js` / `plans.js`：布局与执行档案；`expansion.js`：扩张；`monitor.js` / `ledger.js`：监控与能量账本。
- 修改前先查 `new-colony/README.md` 的“修改前先定位文件”表，只读职责文件、直接依赖和对应测试。

## CPU 优化结果

- 优化前 `.2` 完整窗口：31 samples，平均 `20.9712` CPU/tick，峰值 `27.1579`；Hauler `8.5892/t`、Miner `3.4249/t`、Memory `3.5427/t`、Spawn `1.6710/t`。
- `.3` 共享同 tick 的 creep/房间对象查询，缓存升级站、工地和 Link 分类，并删除 Hauler 第一次配送前的重复目标规划。最佳完整窗口 `17.09/t`，最近完整窗口 `17.8111/t`；相对基线分别下降 `18.5%` 和 `15.1%`。
- `.4` 让已完成布局只按每 10 tick 的原施工周期调用 planner；计划缺失或未完成仍立即运行。bucket <500 时暂停纯展示文字。冷房压缩后的完整窗口平均 `16.4949/t`、峰值 `19.3322`，planner `0.0802/t`；相对 `.2` 总均值下降 `21.3%`。
- 约 29–30 个 creep 才是当前负载单位：新房有 19 个、主房 10 个；最近窗口每 tick 平均移动 `10.8333` 次。房间虽只有两个，但逐 creep 搜索和寻路会乘以单位数。
- 当前最大项目依次为 Hauler `5.7833/t`、Memory 首次解析 `3.4757/t`、Miner `3.4236/t`、Spawn `1.5138/t`、Monitor `1.0648/t`。Hauler 已较基线下降约 `32.7%`；不同窗口会随移动和目标切换波动。
- Memory 从约 `686075` 降到 `488298` bytes（`-28.8%`），首次解析从基线 `3.5427/t` 降到 `2.3887/t`（`-32.6%`）。新增的 5 个冷房布局已进入 `plans.js` 并逐房精确匹配为可恢复摘要；当前仅两个自有房保留完整执行布局。剩余主要体积是 `frontier.energy` 的两房长历史，后续压缩必须保持仪表盘口径，不能直接删除。

## 验证

- `npm test` 全部通过：game、layout、API 23 项、operations、diagnostics、policy。
- 三次代码优化提交均已推送：`894616a`、`cad8ae0`、`2ada4e6`；12 个受管模块通过实际上传和远端 hash/readback 校验。
- 未修改能源阈值、岗位数量、出生优先级或角色工作优先级。

## 仍待处理

- 用户于 2026-09-28 紧急要求取消全部 Rampart 施工。当前所有 Rampart construction site 已删除，planner 永久跳过 Rampart；tick `73990460` 回读两个房间均为 0 个 Rampart 工地。已有 Rampart 和计划坐标保留。
- bucket 已从低个位数回到 `31`，最新窗口 CPU 全部低于 20；样本仍只有一个完整窗口，继续称为开始恢复而非长期稳定。
- W23N26 仍有两处 source backlog 和约 5.5k 地面能源；Upgrader 少与能源堆积的策略问题尚未在本次 CPU 优化中改变。
- 主房 Controller Container 曾消失及重建的历史原因仍未证实。
- 若后续窗口仍接近上限，再设计能源历史的定长编码；当前先避免在低 bucket 阶段继续加入迁移成本。

## 发布与维护规则

- API 受管模块共 12 个：`main/runtime/development/logistics/workforce/infrastructure/metrics/planner/plans/expansion/monitor/ledger`。
- `screeps_api.py deploy` 默认只预览；`deploy --apply` 才上传，上传后必须 `code-check` 并等待 Memory 中版本和 tick 推进。
- 不因代码发布自动恢复巡检 automation；只有用户明确要求时再启用。

## 当前负责者

- 本轮重构由 root `01a0e5d9-dc86-7f83-883c-af5c434fcefe` 独占整合/API/Git/部署；三个有限代理分别负责物流、经济人口、任务规划移动。用户已明确授权重构与部署。
