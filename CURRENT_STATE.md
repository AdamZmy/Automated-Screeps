# Screeps World 当前交接

- 唯一World源码new-colony，AdamZmy/shard1/frontier24；Arena不属于本任务。
- root任务01a0d7a3-fbe2-72e3-9871-1b834e8eb22d；下一轮先核验真实状态，active/unknown不接管。
- 独立20分钟自动巡检保持；先读AGENTS/OPERATIONS/相关故障目录和Issue，不重放历史。
- 用户最终原则：所有卸货按实际持能/空位，预约不截断动作；已有能源的升级/建设工人就绪即工作，预算仅作人数/身体/供给规划。
- 新限制需明确依据；已知故障先复验，未解释异常交独立审视，多假设沙盒确认后入库。

## 最新核验

- v0.4.2 / build2026-09-25.16，代码99202bb已推送并打tag；API备份及六模块回读verified，仅main变化。
- .16删除Container人工水位、全部目标卸货额度截断、最小配送批量/20与25取货门槛、升级/建设动作credit与轮休、强制蓄满才工作。
- 修复有storage的完工Builder永远haul；删除1000身体预算/Hauler8CARRY/worker10WORK/房总36CARRY固定cap，保留真实需求、房容量与50parts。
- Link允许小批实际有用转入，保留原生cooldown与正净到货；布局/扩张的现有战略门槛未盲删，逐项理由见限制审计报告。
- .14/.15此前修正空车未来货量抢占、远车过早占口与小数预约；新回归保留这些机制，但不恢复旧水位/动作阀门。
- 2026-09-25T15:38:29Z / tick73937780：RCL4，进度7470/405000，energy800/800，storage0，8个extension工地，地面能源0，无alerts。
- 73937761–780实际升级350、有效建设105、采集400、库存-55、残差0；即升级17.5/t+建设5.25/t，允许消耗已有库存。
- 同20tick CPU平均8.7854/峰9.643、bucket10000；这是短窗，非长期吞吐保证。
- 300tick U102.72%/库存-163/残差0；1500tick U107.36%/库存-3313/残差475，均不可当可持续效率验收；6000tick U97.55%亦库存透支。
- 全npm test通过，包含两套独立引擎/真实地形oracle及新增policy审计；发布后CI另查，不假称已确认本次CI。
- 末次补采Console超时，flowProbe回读仍73936566，未当新证据；clear-diagnostics已accepted，确认回读连接超时，下轮检查残留probe，当前不声称清理已确认。

## 下一步

- #1/#4 verifying：连续真实交付/升级/建设及至少两个合格1500tick窗口；.16保守纯窗口不早于73938080。
- #5 ready：运输跨矿/部分装载绕路的真实完整周期，固定分矿/合并小身体收益仍待证；没有部署该猜测。
- #6 RCL4门槛已达到、storage未建，转ready按原Issue推进；#7/#8/#10仍受各自储备/布局/RCL等门槛约束。
- #9 ready；升RCL4后的网页布局静态快照可在其既有范围更新，当前本轮未改网站资产。
- 故障目录operations/fault-catalog.md；完整审计operations/diagnostics/policy-restriction-review-2026-09-25.md。
- 本轮批次2026-09-25T08-18-14Z-run-358131860170；用户连续修正使本轮延长，记录实际过程而非新造历史。

## 文件归属与异常

- energy_fault_review与restriction_audit completed且释放文件；energy_capacity最终服务连接失败，root已接管完成测试与部署。父任务均为上述root。
- 服务403/断流中断不属于Screeps认证失败；两独立审视已恢复并完成，root补正两项旧fixture同tick/转岗断言后全回归通过。
- 多个后续自动巡检因root仍active跳过；仍存在其他批次未完成/未发布日志及已暂存改动，保留其文件，不把这些日志当游戏代码修改。
- root结束后释放本轮源码/测试/文档；统一API/Git部署已完成。后续接管仍先检查任务实际状态。
