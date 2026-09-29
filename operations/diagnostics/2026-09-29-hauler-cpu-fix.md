# Hauler CPU 修复与验收 — 2026-09-29 / Issue #5

范围：AdamZmy / shard1 / frontier24；游戏观察、诊断、备份部署均通过 HTTP API。root 为唯一 API/整合所有者；workforce 有限实现者与独立审视者均已交付并释放文件。保留原 worker 池、标准 Hauler 半房容量 CARRY:MOVE=1:1、布局、账本及暂停的 automation。

## 已实施与回归

- 稳定任务跳过候选构建/排序；房内统一核对实际 cargo，同tick容量/货源与紧急需求仍即时核验。18辆稳定车的 fixture 无 assignment 重排，reconcile 只执行一次。
- 精确起点→来源与来源→目的地共享有界 heap 可达性缓存；完整结构身份/坐标/通行状态失效，正缓存500tick、负缓存15tick。不以距离估计伪造连通性，不向Memory写路线档案。
- 卸货口共享 tile 占位/近场租约索引；占口立刻试合法备用口，所有口暂占才有界等待；idle 空车仍让路。临时 worker 的 storage 排除不可被全量索引绕过。
- 同tick目的地到货取消无效取货；保留实际货物优先、预约回收、完整卸货、失败恢复与非疲劳堵塞区分。
- Hauler 续代按未来 CARRY 与多Spawn串/并行期限融资。仅真正开工期限到达且标准买不起时用应急体；合并同死亡期碎片需求，自然续代，不 suicide。
- 新增 needs/reconcile/assignment/target/pickup/delivery/port/movement 的嵌套 self-time，角色/阶段仍 inclusive。20tick发布、60历史边界不变。
- 独立残留复核发现旧/新版都跨完整趟次继承小 task.amount：450容量/来源1000，送完9后每次再取9。`.2` 在下一tick确认真实卸空才结束旧趟；重派后新订单450。拒绝、部分结算、同tick accepted、疲劳不误清，关闭 fixture 自动刷新的5个边界实验通过。故障目录 L008。

`npm run test:hauler` 的7组、missions/movement/planning、23项 API tests、语法/diff 检查通过，独立审视放行 `.1` 与 `.2`。完整 `npm test` 仍有 `.7` worker-pool 改造前已存在的旧 builder/upgrader oracle 不一致（verify-economy:154、verify-workforce:41、verify-hauling-hypotheses:470）；未宣称全套通过。

## 实测：不能把部署成功当作 CPU 收益

| 窗口/版本 | 样本 | 执行 Hauler | role CPU/t | prepare CPU/t | 主循环 CPU/t |
| --- | ---: | ---: | ---: | ---: | ---: |
| 74026101–120 / .7 | 20 | 8 | 2.5757 | 0.7883 | 16.1732 |
| 74026261–280 / .1 | 20 | 8 | 3.2531 | 1.0739 | 17.9207 |
| 74026281–300 / .1 | 20 | 8→9 | 3.8001 | 1.0291 | 18.4239 |
| 74026301–320 / .1 | 20 | 9 | 3.4322 | 1.1710 | 18.3946 |

同8车的首窗 prepare+role 从3.3640升到4.3270（+28.6%），没有性能验收通过。第二窗单次 delivery.self8.9929 的尖峰约贡献0.45/t；后续窗口受出生、自然死亡、补给紧急抢占和工作者缺能外出影响，不是同负载A/B。74026321–340只有18样本且有 profiler probe，下一窗19样本，也不作稳定恢复证据。

首完整新窗 self-time：movement1.8887、delivery0.5500、needs0.4000、target0.2305、port0.2028、assignment0.1680、pickup0.1543、reconcile0.1511。移动仍占物流执行大头；没有将 engine 成本从角色统计抹去。官方[CPU机制说明](https://blog.screeps.com/2015/10/Important-change-CPU-cost-of-API-methods/)解释为何人数/真实移动意图本身也有成本，不是全靠缓存消除。

微测74026327：100次 Game.cpu.getUsed 平均0.0003672，100次 measured no-op平均0.0009064；粗算约0.029/t新增测量开销不足以解释0.963/t增量，但不是排除偶发GC的证据。

## 行为区分与部署

- 新鲜 probe74026299/306/343确认主循环在推进；原W21的88货物与W23的240货物后来已卸出，排除仅因两次相似快照断言“永久不卸货”。W23 `_move.dest` 与卸货口一致，但未验收路线最优。
- W21续代900能量在74026299开工，引发 priority0 Spawn/Extension 补给；W23也续代矿工。控制箱低水位时工作者外出，全部角色 moveCalls 从基线12.15/t升到约19–22/t。缺能和紧急订单不能单凭相关性归因于新的缓存。
- `.1` 本地提交2a46ae6，备份 api-deploy-20260929T215630.860888Z，改main/logistics/workforce/metrics，17模块回读一致。
- `.2` 本地提交c0d9e68，备份 api-deploy-20260929T220550.817883Z，仅main/logistics变化，API返回verified。22:09:46Z最新运行74026440版本.2，17模块code-check all_match=true，模块无报错。haulerProbe/haulerProfiler/apiSnapshot清理回读均null。
- `.2` 冷启74026389–400仅9样本/mean24.3173；暖窗74026401–420为19样本/mean18.7321、role2.8810、prepare0.9254；74026422–440仍19样本/mean18.2340、role2.7885、prepare0.8936、bucket1。缺样与低bucket不符合稳定CPU恢复验收，不能将角色开销未低于基线写成收益。
- 74026440 W21/W23仍20WORK，升级19/14.4、运输2/6、stalled0；主房新标准车真实携450，辅房部分已卸空返源。旧小订单在发布前已转pickup的车，需要下一次实际完成趟次后才清理；无需杀车或强制清全部任务。
- 最新暖窗upgrader角色5.7329CPU/t、首次Memory2.3602、ledger1.3128；当前最大的角色开销不再是Hauler。此处只记录归因，未扩展修改worker执行或Ledger口径。

## 发布边界与后续验收

自动审批拒绝把本轮诊断日志推送公开GitHub，原因是本轮未明确授权公开这些内容；本地commit已保存，未绕过拒绝，未声称Issue/公开日志已同步。用户授权后再推送并更新既有 Issue #5，不新建重复问题。

下一步核验 `.2` 的纯新、完整、无诊断窗口，实际交付/升级和完整取送周期；不要把短窗口或自然减少人数当作因果收益。旧车仍自然续代，标准半容量策略不扩大。长期总CPU、bucket、源侧积压与能源90%目标保持 verifying；不恢复暂停的自动巡检。
