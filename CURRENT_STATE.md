# Screeps World 当前交接

- 唯一 World 源码目录：`/Users/zmy/screepsworld/new-colony`；账号 AdamZmy，官方 shard1，活动分支 `frontier24`。
- 用户要求暂停的巡检 automation `screeps-world` 仍为 `PAUSED`；本次重构没有恢复调度。
- 当前发布：v0.5.0 / game build `2026-09-27.2` / commit `b7b96b1`。
- 2026-09-28T01:55Z 已通过 API 上传并逐模块回读；备份位于 `new-colony/backups/api-deploy-20260928T015525.881056Z/remote-code.json`。
- 线上 tick `73990020` 已报告版本 `2026-09-27.2`，确认拆分后的主循环实际运行。

## 代码边界

- `main.js` 仅 39 行，负责装配模块、tick 调用顺序和异常隔离；具体游戏策略不再放在入口。
- `runtime.js`：移动、距离、能量、矿位等通用工具。
- `development.js`：发展预算、Controller 固定站、升级、施工、补能和矿工动作。
- `logistics.js`：运输需求、预约、取送目标、多卸货口和 Hauler 状态机。
- `workforce.js`：身体、有效产能、续代、岗位缺口和 Spawn 决策。
- `infrastructure.js`：Tower、safe mode 和 Link。
- `metrics.js`：CPU 阶段、角色和移动计数。
- `planner.js` / `plans.js`：布局与执行档案；`expansion.js`：扩张；`monitor.js` / `ledger.js`：监控与能量账本。
- 修改前先查 `new-colony/README.md` 的“修改前先定位文件”表，只读职责文件、直接依赖和对应测试；调用链或回归失败时再扩大范围。

## 验证

- `npm test` 全部通过：game、layout、API 23项、operations、diagnostics、policy。
- 所有受管模块通过语法、部署 dry-run、实际上传和远端 hash/readback 校验。
- `test-support/runtime.cjs` 已支持在同一 VM 中加载拆分模块；经济和策略回归不再依赖单文件 `main.js`。
- 这次只调整代码组织与加载方式，没有修改能源阈值、出生策略或角色行为。

## 仍待后续处理的运行问题

- tick `73990020`：CPU 窗口 mean `24.6509`、max `29.9906`，CPU EMA `25.3856 / 20`，bucket `1`；仍未恢复。
- W23N26 的源侧与地面能源积压仍有告警；Upgrader 少、能源堆积的策略问题尚未在本次重构中修复。
- 主房 Controller Container 曾消失及重建的历史原因仍未证实；不要把当前存在或模块拆分当作根因结论。
- 下一次处理上述问题时，首读 `development.js`、`workforce.js` 和 `logistics.js`，再按需要读取 `monitor.js` / `ledger.js` 的证据口径。

## 发布与维护规则

- API 受管模块共 12 个：`main/runtime/development/logistics/workforce/infrastructure/metrics/planner/plans/expansion/monitor/ledger`。
- `screeps_api.py deploy` 默认只预览；`deploy --apply` 才上传，上传后必须 `code-check` 并等待 Memory 中版本和 tick 推进。
- 游戏代码、README、AGENTS、架构文档及本机 `screeps-world-api` skill 均已指向新的文件边界。
- 不因代码发布自动恢复巡检 automation；只有用户明确要求时再启用。
