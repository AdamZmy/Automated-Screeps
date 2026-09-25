# Screeps World 巡检交接

更新日期：2026-09-25。此文件是短交接摘要，不是实时游戏数据；每轮用新 API tick 和 GitHub Issue 校准。
只保留最新状态，最多 80 行。重要历史按需查 `new-colony/LIVE_STATUS.md`。

## 入口与目标

- 仓库：https://github.com/AdamZmy/Automated-Screeps；本地 `/Users/zmy/screepsworld`。
- 活动源码 `new-colony` 六模块；AdamZmy / shard1 / frontier24，主房 W21N26。
- 优先主房升级与可持续总用能率≥90%，再按实际经济/路线条件扩张双矿房；API only。
- 操作约束见 `new-colony/AGENTS.md`、`OPERATIONS.md` 和 `screeps-world-api` skill。
- 唯一巡检 `screeps-world`：已回读cron/ACTIVE、每20分钟独立新对话，无旧target_thread_id或重复活动调度。
- GitHub/Vercel登录已完成；相同旧设备授权阻碍已经解决，不再次要求登录。
- 巡检日志 https://screeps-energy-observatory.vercel.app/logs 已部署，生产 `dpl_BResWyWLagg3GKWRPZ7UPXTZuP2X`；每轮按OPERATIONS用inspection_log工具记录/发布，动态读取GitHub，无需逐轮部署。

## 最近核验证据（旧快照，下轮必须取新数据）

- 游戏 build `2026-09-25.11`，代码commit `2c1c04a` 已推送；08:09Z通过API部署，仅main改变，六模块回读一致。仓库版本以VERSION为准。
- 本轮落实用户规则：升级/施工份额只作优先权，按就绪动作双向借用，失败额度同tick再分配；共同总额保留续代/维护/储备扣除，控制器补给覆盖借用。
- 五组test:game及新增共享额度回归通过。新runtime记录development/developmentCredit均为固定尺寸；IntentEnergy仅是意图费用，真实耗能看ledger。
- tick73931220（08:11:30Z）线上`.11`，纯20tick73931200–220升级219，即10.95/t；原角色份额6/t，共同预算15.1/t，现有11WORK基本全部兑现。
- 这证明错误限流已解除，尚不等于P0完成：两矿理论20/t、该窗采集20/t，全房地面3128仍高；工人体型、有效WORK不足及补给周期继续优先处理。
- 纯新20tick CPU均值8.2202、峰值10.6989，新增development阶段0.2515/t，bucket10000。角色/行动负载变化，不能称CPU已改善。
- `.11`首次观测运行tick73931191；首个保守纯1500tick窗口不早于73932691，完整覆盖、库存持续性、残差和两个合格窗口≥90%仍须验收。
- 主房复核布局 `2026-09-25-international-adapter-1`，205项；其他冷房仍旧v3。网站布局/#layout的建造状态仍是有日期快照。
- GitHub #4为独占priority:p0；本轮使用原工单，没有新增重复能源问题。项目0.3.0含独立日志页和预算共享修复；日志系统建设与本轮游戏修复补录均已归档。

## 下轮读取远端 Issue，以下仅为交接索引

- #1 fixed-logistics：verifying，检查完整固定节点补货/换体/建造取能和同负载CPU。
- #4 sustainable-utilization：**priority:p0 / ready**，预算共享已上线并有实测；下一有限任务改进有效WORK需求/体型与补给周期、消减积压；长期验收不得阻挡明确容量缺口的修复。
- #5 movement-cost、#9 neighbor-layout-review：ready，按优先级与文件归属认领。
- #6/#7/#8/#10：planned，分别受仓储、扩张、Link及成熟基地阶段门槛约束。
- #2 GitHub管理、#3 主房复核布局：已done，不重复初始化或重开已完成工作。
- #11记录独立巡检迁移；以 `python3 tools/github_ops.py list` 返回状态和最新检查点为准。
- #12为逐轮日志/网页实现，生产页面及真实GitHub数据链路已通过验证；后续日志不改变Issue真实状态。

## 协调者交接

- 当前接管协调者：`01a0d7a3-fbe2-72e3-9871-1b834e8eb22d`，2026-09-25T08:18Z即时核验下列旧任务均已结束；本轮负责P0诊断、main/经济测试、API/Git/日志。

- 本轮游戏协调者任务ID：`01a0d78f-8784-79d2-aeda-5f6987b8836e`；预算共享修复/部署/短期验证完成，结束后释放main/经济测试等文件，无运行子代理。
- 日志协调者 `01a0d3ca-10e0-7362-a9d0-1f3c60a63853` 已完成日志/网页/OPERATIONS，子代理已交付；结束后释放这些文件。下轮仍核验真实owner，游戏P0优先接续。
- 固定交接/CI/主房地图子代理已交付；布局任务 `01a0d746-f0e4-78a3-9093-43f8f506a26d` 已完成。
- 启动写入前，用即时任务状态核验上轮协调者和Issue owner；新代理列表为空不代表旧代理停止。
- 若仍运行则本轮不竞争写入/部署；确认停止后记录本轮协调者ID再接管。阶段变化写Issue检查点。
- 每轮结束覆盖本文件的最新核验tick/风险/下一检查点/协调者；不要追加完整巡检流水。
