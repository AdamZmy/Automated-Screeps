# Screeps World 当前交接

- 唯一源码new-colony；AdamZmy / shard1 / frontier24；W21N26主房、W23N26辅房；不操作Arena。
- root=01a0f43a-9236-7b41-ba14-8022a98b399e; active owner of API/evolution state, controlled policy configuration, Issue14 checkpoints, CURRENT_STATE and this run journal; no worker yet. Previous root01a0f41f and old Issue owners01a0dd13/01a0e59f verified notLoaded/latestTurn completed before takeover.
- 上轮root01a0f3fd、旧Issue owners01a0dd13/01a0e59f均实查notLoaded/latestTurn completed；setup root01a0f3cb idle/completed；首次写入前已重读归属。
- cpu_review parent=01a0f41f-c50e-7542-8779-34b246f00ad8; completed independent report and sandbox, released files. Root persisted diagnostic regression and catalog X003; all workers stopped.
- 游戏2026-09-30.1 / 代码72c8d56；两次cycle通过AdamZmy/frontier24和19模块本地/远端哈希核验。用户遗留tools/inspect-worker-pool.js未跟踪，保留不提交。
- 实验hauler-20260930T195223821086Z，phase=baseline，batchWeight=0；state.json是唯一状态，experiments同ID一致。
- 基线74045006→74046506；最新collector74046251，1245/1500tick，尚差255；observedAt2026-09-30T21:18:48Z。
- 实际EVENT_TRANSFER交付21648能源/174次；haulerTicks2530、carryTicks22770、workerWorkTicks24210、minerWorkTicks12550；errors0、invalidReasons[]。
- 固定评价observe/incomplete_baseline；没有候选/收益结论。采集tick74046213→74046251；id/room/stage/revision匹配，bucket min9480/end9856。
- 新API摘要74046240/fetched2026-09-30T21:18:15Z：两房RCL5/peace，无module errors、掉落均0。主房progress993763、升级20/t、2worker20WORK(10+10)、2hauler18CARRY、0工地、buffer1329。
- 辅房progress8267、升级5.3/t、3worker20WORK(8+8+4)、7hauler、2miner、capacity1350、11工地、buffer200；无扩张操作。
- 主房U1500=97.37%/coverage1但stock-319，不合格；辅房97.7%/coverage1/stock+572 eligible，仅单窗；未验收持续≥90%。
- CPU74046200 mean22.7386/max200.9723，scout9.9768/t max187.8277；74046220/240恢复mean14.1473/13.9357，bucket9696→9822；EMA16.59告警仍在，暂未见持续当前过载。
- 只读Game快照真实新tick74046274：两scout均stuck0、有缓存terrain/出口；unsafe仅W24N27非己方owner、seen74031551。不能证明历史峰值的具体热点。
- X003: unsafe scout destinations enter expensive route search; reproduced offline, live peak attribution unproven. Four regressions plus diagnostic passed; retrospective fixture fails before W005. See Issue7/report for bounded follow-up.
- Issues14/4/7保持verifying；基线/试验期间不并行部署backlog。仅W21N26非紧急取货batchWeight[0,2]开放；priority≤2、其他房间、Link/出生/扩张保持原行为。
- Journal2026-09-30T21-15-51Z-hauler-8a2fa5b70df3; initial4aa72ed/progress813512f pushed; final record included in this handoff commit. No website deploy.

## 下一步

- 先核验本root和cpu_review父任务已停止并释放，再cycle；完整有效1500tick前保持verifying、不提案/改权重。
- 到diagnose后检索fault-catalog、独立审视及反证，最多两方案；无可由batchWeight解决的证据则defer→start新配对基线。
- 保留scout CPU问题及独立诊断结果到Issue7；受控权重不解决侦察热点。发生紧急维护先经控制器结束实验，非紧急不打断采样。
- 完整窗口按haulerTicks与实际CARRY/WORK均值评价；工况变化/错误/漏测不算收益；哈希冲突停部署，runtime失败先诊断。
