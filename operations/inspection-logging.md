# 本地巡检日志写入

`tools/inspection_log.py` 使用 Python 3.9+ 标准库，只操作本地档案，不调用游戏 API、部署或执行 Git。格式以 [inspection-format.md](inspection-format.md) 为准。

从仓库根目录开始一轮：

```sh
python3 -B tools/inspection_log.py init --kind scheduled --title '周期巡检'
```

`kind` 必填，支持 `scheduled`、`manual`、`backfill`、`setup`。命令生成当前 UTC 时间及随机唯一后缀，在 `operations/inspections/YYYY-MM-DD/` 创建同名 JSON/Markdown、两级索引，并仅向 stdout 打印 JSON 的绝对路径。初始状态为 `running`；未知游戏观测为 `null`。系统建设使用 `setup`，不要记成已完成游戏巡检。补录使用 `backfill`，以本次登记时间开始，在内容里明确历史观察时间与真实证据，不修改初始化身份。

读取该 JSON，保留所有必需字段和空数组，更新本轮结论、发现、Issue 待办进度、动作、检查结果、下一轮与引用，然后写回：

```sh
python3 -B tools/inspection_log.py write --file /path/to/edited-run.json
python3 -B tools/inspection_log.py validate
```

推荐先复制 JSON 到归档目录之外的暂存文件，编辑副本后传入 `write`，这样验证失败不会改变已发布档案。也支持直接编辑初始化生成的 JSON；此时工具从日期索引核对原身份，并重建该轮 Markdown 和索引。直接编辑造成的无效 JSON 仍需先修正，`validate` 会如实报错。不要手动编辑索引或 Markdown。

同一轮始终使用同一 `id`。`id`、`startedAt`、`kind` 不可改变；`updatedAt` 由工具更新，读入的旧修订不能覆盖较新记录。完成或停止本轮时，将 `status` 改为 `completed`、`blocked`、`skipped` 或 `failed`，并填写处于开始和本次更新时间之间的 `completedAt`。结束后的记录可修正内容，但不能恢复 `running`；新一轮应重新 `init`。无变化和失败也应明确记录，结束本轮不表示所有游戏问题已解决。

时间必须为真实 UTC `YYYY-MM-DDTHH:mm:ssZ` 或带 1–3 位小数的形式；动作时间位于本轮起始与更新时间之间，游戏采集时间可以早于本轮，但不能晚于更新时间。`tick: null` 表示未知，不能用 `0` 代替。关联 Issue 由发现和任务中的正整数自动去重排序。引用只接受本仓库的 GitHub HTTPS 链接，及现有监控站 `https://screeps-energy-observatory.vercel.app`。

`validate` 核查全部日期、全部 JSON、Markdown 与两级索引的一致性；成功输出 `{"ok": true, "runs": ..., "days": ...}`。任何命令失败以退出码 `2` 和简短 stderr 原因结束，不输出敏感原文、不用空索引覆盖坏档案。测试或独立档案可在子命令前后指定 `--root /path/to/temp/archive`；路径中的 `..` 和受管理路径的符号链接会被拒绝。

根索引保留最近 50 轮及全部日期；日期索引保留当天全部轮次。按 `startedAt` 降序排列，同时间以 ID 降序打破平局。单轮最多 256 KiB，根索引最多 1 MiB / 10,000 个日期，日期索引最多 8 MiB / 10,000 轮；超限时明确失败并保留已有历史，不截断日期或当天记录。标题、负责人、版本、引用标签与检查名称最多 240 字符；普通文本最多 4,000 字符，单条证据最多 2,000 字符。一般数组最多 100 项，单个发现的证据最多 50 项。工具拒绝未知字段、错误类型/枚举、重复 JSON 键与非有限数值。

文本按普通文本转义生成 Markdown；检测常见 Token、私钥、私人绝对路径及原始 Memory 转储，拒绝明显误提交。此检查是基础防护，不能替代上传前检查；正常 commit 哈希、带 tick 的有限统计和 `Memory.rooms.<room>.<metric>` 等字段引用可以保留。禁止将凭据、完整 Memory、私人文件路径或完整聊天放进公共日志。

多进程写入使用档案根目录上的 `flock` 独占锁，且不生成锁文件；每个文件先暂存并 fsync，再原子替换。同步 I/O 失败会尝试恢复已替换文件。多个文件不能作为单个文件系统事务提交，进程被强制终止或断电可能造成可检测的不一致；出现这种情况先用 `validate` 定位问题，从 Git 中检查/恢复完整已知修订，再重试。不要把损坏档案当空目录继续写入。

本地行为测试使用隔离临时目录，不调用 API，也不改真实巡检记录：

```sh
python3 -B tools/verify-inspection-log.py
```

日志验证通过后，由日常版本发布流程检查并提交 JSON、Markdown 和两个索引。写入器不执行 Git 提交、推送或监控站部署。

## 并发与发布前的最终核验

- Issue/任务查询可能耗时；获得旧owner停止证据后、首次写共享文件前，重新读取CURRENT_STATE并核验其当前owner。发现新owner即让行，不沿用查询开始时的旧归属。
- 同一时间只有一个Git发布者。其他轮只在state中的隔离archive运行init/write，并移交真实起始、结束JSON；发布者按原id/startedAt导入，不重新init，不伪造历史。
- 每次write先重新加载当前记录。编辑副本须位于archive外；不要将直接编辑的JSON在write失败后提交。多个非法记录相互阻塞时先完整备份，在隔离目录验证所有canonical JSON后，用写入器的生成函数重建派生文件，再write及全档案validate。
- 发布必须串行且失败即停止：用subprocess.run(..., check=True)依次执行validate、显式路径git add、检查暂存差异、commit、push。禁止把校验失败和Git发布放进仍会继续的命令序列。
- 校验完成后再次核对HEAD和待提交文件未被其他任务修改；不使用旧快照覆盖共享索引。两级索引与Markdown均由同一批完整记录派生。
- 终态completedAt取真实结束证据；后续修订时间写updatedAt。无法确认旧run结束时刻则保留未完成，不按恢复时间冒充执行结束。
