# Screeps World 自进化 v1

游戏内 `new-colony/evolution.js` 逐tick采集，游戏外 `tools/evolution_workflow.py` 管理实验。现有 `screeps-world` 独立定时任务每30分钟新开对话，按 prompts 中的监控→监督→优化→执行→评价角色顺序工作。AI推理由已登录Codex完成，无须另一份模型API Key。程序无常驻代理或额外cron。

监控所有自有房间；只允许 W21N26 hauler 的非紧急取货评分自进化。受控参数 `batchWeight` 在 `[0,2]`，作为游戏代码模块上传，平滑偏好每趟可送的较大批量。它不要求满载、不延迟动作；priority≤2、其他房间保持原行为。Link、出生和扩张先继续观测，后续经单独验收再开放控制面。

```
start → baseline(1500tick) → diagnose → propose → ready → trial(300+1500tick)
                                 ↑                         ↓
                       新配对基线 ← keep / rollback / inconclusive / invalid
```

状态机命令在仓库根目录运行：

- `python3 tools/evolution_workflow.py status`：只读本地公开状态。
- `python3 tools/evolution_workflow.py cycle`：核验身份/哈希/新tick，推进观察及评价；保护条件失败自动部署回滚。
- `python3 tools/evolution_workflow.py start`：检查并部署新基线，不改 incumbent 权重。仅终态可调用。
- `python3 tools/evolution_workflow.py propose --file new-colony/state/evolution/proposal.json`：验完整基线，登记AI假设、证据、最多两个方案和候选权重。
- `python3 tools/evolution_workflow.py trial`：运行回归，仅修改受控配置、备份、上传及回读。
- `python3 tools/evolution_workflow.py defer`：完整基线没有可验证问题时记录延期，再采新基线。
- `python3 tools/evolution_workflow.py rollback`：实验中停止候选，验证快照后恢复原policy代码与开关。

`state.json` 为单个活跃实验记录；`experiments/<id>.json` 保存每轮公开聚合证据、假设、检查、代码哈希、部署与结论。精确incumbent代码位于忽略的 `new-colony/state/evolution/`，每次API部署另保留原有远端备份。原hauler Memory不变。POST结果不明时状态保留 deploying（检查前改配置的中断保留preparing，可只恢复哈希证明匹配的原policy）；cycle仅回读核对，无法确认则停止，不自动重试。

采集冻结完整的首个1500tick窗口，外部检查即使错过边界仍能读取。攻击、RCL/工况/明显运力变化、漏tick等使样本不可比；精确以模块/评价器字段为准。完整窗口内平均活跃Hauler数量、CARRY、消费/采矿WORK变化超过20%归为混杂，短暂普通续代允许纳入曝光。下一tickEVENT_TRANSFER中实际hauler发出的能源才计为delivered，withdraw不是delivery。输出/hauler存活tick为主目标，载荷率只作诊断。评价器阈值在 `tools/evolution_evaluation.py` 固定，窗口中性先回滚再重采相等长度，不选择性延长单侧或重复读冻结数据。监督者对同一假设至多重试三对窗口。

定时任务先查上一owner状态和Issue，单实验/文件归属及文件锁同时防重。任何人工游戏代码变更造成哈希冲突均停止自动部署，先核对版本、保存中断原因、恢复/重采；紧急安全维护优先但必须先结束实验。用户暂停任务时遵守暂停；仅在本次用户明确实施授权下恢复。

验证：`npm run test:evolution`、`npm run test:hauler`、`npm run test:api`。线上版本/真实tick验证与实验收益验收分开；闭环上线不等于优化已经成功。
