# 巡检日志并发审视（2026-09-25）

本轮root：01a0d9b7-4b5d-7160-ba1b-f2ed83639448；独立审视：journal_review，仅读本地和隔离沙盒，无API或生产写入。Issue #12。

## 已确认与排除

| 假设 | 证据/实验 | 结论 |
| --- | --- | --- |
| 陈旧索引覆盖新摘要 | 固定2cd580a与原索引blob，08:18索引updatedAt落后JSON；init/validate报day summary disagrees | 已确认 |
| 缺少真实记录 | 629c6d8遗漏18:19索引；19:15记录曾仅有未跟踪文件但索引存在 | 已确认 |
| 直接编辑后没有write | 12:39 completedAt及18:43 action.at超过旧updatedAt，Markdown不同；生成器拒绝 | 已确认 |
| 校验失败仍发布 | 并发发布者报告629c6d8命令未因错误中止；提交与现场复核一致 | 已确认 |
| 工具失败会自动破坏原文件 | 隔离失败前后逐文件比较不变 | 本复现条件下排除 |
| 游戏运行故障 | 本轮没有游戏API、版本或tick采样 | 证据不足，未作游戏结论 |

## 安全恢复

先保存全部原档案和Git暂存索引。两并发任务明确停止共享档案/Git写入，把终态副本交root。旧12:39任务经root直接wait_threads确认systemError/latestTurn failed，真实completedAt为2026-09-25T15:40:01Z；保留原检查证据，修订时间单列。其余真实run身份和状态不按时间推测。

逐份校验canonical JSON，在隔离档案用原写入器生成Markdown/两级索引，再write和validate；全部通过后回写共享档案。90c3436已发布25条一致档案，2e711bf已发布26条与授权移交起始记录。此前最终修订未完成发布；2026-09-26恢复时用真实终态证据继续合入，不按经过时间推断结果。原故障审视没有游戏API与部署。

## 验证与边界

原始旧索引问题在隔离目录复现；只修摘要/顶层更新时间后validate通过，init恢复成功，未修改原JSON/Markdown字节。该原始复现的12:39使用同summary有界fixture，未声称重建原全文。629c6d8的非法时间与缺索引独立复核来自真实记录。

现有写入器回归及本次沙盒只验证档案恢复和拒绝非法状态，不证明游戏健康，也没有实现跨进程Git事务。执行边界已补充至inspection-logging.md，下一轮必须先核验当前owner，再读取新游戏tick。

独立回归：`python3 -B tools/verify-inspection-recovery.py`，3项临时目录实验覆盖过期摘要、漏索引、多非法时间互相阻塞及保留证据恢复。

## 2026-09-26 恢复验收

旧协调者与journal_review实际停止后，本轮root01a0dc5e-78e0-7412-8f71-16b514713719接管，复用独立审视者journal_recovery_review（父任务01a0dc27-8952-7971-8623-63f864025181）对旧6份终态和遗留4文件的复核。20项日志回归、3项恢复回归通过。另独立journal_recovery仅核验本日14组起止修订，隔离导入44轮/2日通过。

本日14组起始由a689f4a显式提交推送，随后本日14组与昨日6份真实终态由c9be031显式提交推送，全部44轮/2日validate通过。保留原id/startedAt/kind/completedAt；旧副本先合入当前canonical再由writer更新updatedAt。18:19批次3b6d305b1dd9随后凭其原owner01a0d9b7的即时任务状态恢复为failed：latestTurn failed、真实结束Unix1790379192；没有按恢复时间冒充结束。不是所有历史待同步日志均已恢复。
