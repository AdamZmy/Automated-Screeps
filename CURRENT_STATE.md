# Screeps World 当前交接

- 唯一源码new-colony；AdamZmy / shard1 / frontier24；W21N26主房、W23N26辅房。
- 本轮实施Issue14：单房间Hauler自进化。游戏2026-09-30.1、19受管模块已API上传/回读verified；真实新版本Game74045015与采集74045014→74045036已核验。
- root=01a0f3fd-8af3-7d83-8d2f-39d623e92b6f；先查真实任务状态再接管，本轮接管API、实验state/experiments、Issue14及巡检日志；上一root与其collector/evaluation/workflow_review已完成释放。
- 上轮root01a0f3cb-fa35-7860-ae1d-7bad076c2dcb已实查idle/completed；旧Issue owners01a0dd13/01a0e59f均completed。
- 更早root01a0ef23-5c14-7cc0-9930-d922406065d2已核验completed/notLoaded，未竞争；遗留用户tools/inspect-worker-pool.js不混入提交。
- 工作流见operations/evolution/README.md，公开state.json为唯一实验状态，角色提示词在prompts。固定baseline1500tick、trial预热300+观察1500；实际EVENT_TRANSFER计交付，满载率仅诊断。
- 首版只允许W21N26非紧急取货batchWeight [0,2]自进化；不强制满载/等待，priority≤2及其他房间不变。未开放Link、出生、扩张或旧haul Memory。
- 名义工况和拓扑一致，实际Hauler数量/CARRY/消费/采矿WORK窗均值变化>20%不可比。普通续代计入曝光，攻击/RCL/漏测/错误/布局变化等使样本不可比。
- 独立复核阻碍已修：结构化schema、warmup、基线先验验收、collector故障独立检测、丢遥测超时、API上传即刻哈希校验、中断准备与未知POST回读。
- 采集器及房间/紧急优先级参数验证/22评价测试/17工作流测试、7组Hauler、24API回归通过；真实采集输出→评价器桥接通过。只记相关检查，不宣称全仓npm test全绿。
- 单一screeps-world已ACTIVE、World项目bb518859-6d74-4c13-9bfe-5da7007b3fa1每30分钟，无新增调度；原model/xhigh及通知偏好保留。先核验owner避免同轮部署。
- Worker规则保持容量标准、20WORK总池、自然收敛；Issue4/5等仍verifying。实验期间不并行改其他源码；必要紧急维护先结束候选，再重采。
- 初始setup日志已Git发布db2bbf5；本轮代码与末记录随自进化发布提交保存并推送。Issue14保持verifying，不能以上线代替实测收益。

## 下一步

- 当前实验hauler-20260930T195223821086Z，baseline权重0；截至74045078采72tick，下一轮先cycle读取新鲜状态。
- 已有真实事件50energy/1次交付/18haulerTicks（74045015的9tick早期样本），无module error/invalidReasons；这是采集验收，非吞吐收益。
- baseline完整前不提案/不部署行为改动；到diagnose由独立审视、监督、优化选择一项证据充分的候选。
