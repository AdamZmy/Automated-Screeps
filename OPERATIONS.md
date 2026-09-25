# GitHub 驱动的持续开发

仓库：[AdamZmy/Automated-Screeps](https://github.com/AdamZmy/Automated-Screeps)。
Issues 是工作状态的权威记录，Git 提交保存代码，版本 tag 标识经过验证的发布。
本地 `new-colony/state/` 仅保存脱敏诊断和可丢弃缓存，不能代替 Issue，也不进入仓库。

## 工作生命周期

| 标签 | 含义 | 下次巡检动作 |
| --- | --- | --- |
| `status:planned` | 受 RCL、储备或依赖限制的未来工作 | 检查门槛；满足后改为 ready |
| `status:ready` | 可以开始，尚无工作者 | 按优先级启动有明确文件归属的有限子任务 |
| `status:in-progress` | 已有明确负责者 | 用真实任务状态核验，不能只看标签或时间戳 |
| `status:verifying` | 实现完成，等待测试、部署或线上观测 | 执行检查点；只在失败证据明确时返回修改 |
| `status:blocked` | 必要外部条件缺失 | 条件变化后恢复，不反复重试同一权限问题 |
| `status:done` + closed | 验收条件有证据支持 | 保留版本、提交、部署与观测记录 |

每个 Issue 都必须有问题证据、范围、验收条件、依赖/启动门槛。
工作开始或阶段变化时，追加结构化 checkpoint，记录实际 owner、文件、下一步和证据。
`ownerKind=agent` 指当前协调树中的子代理；`thread` 指可查询的 Codex 任务；`root` 指协调者。
这只是工作记录，脚本本身不会启动代理或在后台运行。

## 每 20 分钟的协调流程

沿用唯一 `screeps-world` heartbeat。先读本文件、World AGENTS、LIVE_STATUS 和 skill，再取新 API tick。

1. `python3 tools/github_ops.py list` 读取 GitHub 状态和活动 Issue 的最新 checkpoint。
2. 对每个 in-progress：通过 `collaboration.list_agents` 或 Codex `wait_threads` 核验 owner。
   工作者仍在运行则不重复派工；空闲且任务未完成则向现有工作者补充有限任务；
   owner 不存在/已退出时，先读其提交与检查点，再恢复未完成部分并记录新 owner。
   时间戳陈旧只触发核查，不能直接断定任务失效。
3. 对 verifying：检查新鲜样本和验收条件。等待 1500 tick 窗口时维持验证状态，
   不能因无人写代码就重复启动开发。实现错误、运行故障或不达标证据才返回 ready/in-progress。
4. 按实际 RCL、岗位覆盖、储备和依赖，解锁 planned；为 unattended ready 工作分派有限子任务。
   root 也可直接完成短小任务；独立工作才并行。每个文件只能有一个写入者。
5. 新问题先搜索所有开放及已关闭 Issue。相同未解决问题更新原 Issue；复发问题重开并补新证据。
6. root 统一 API、整合、Git 提交和串行部署。写入结果不明先回读；不盲重试。
   完成后记录版本/提交/部署/实际 tick。只在所有验收条件满足时关闭 Issue。

不应为了保持工作者忙碌而制造任务。RCL/储备不够时保留 planned；其他任务改动同一文件时等待交接。
GitHub不可用时，保存带时间戳的本地检查点并继续已授权且安全的游戏工作；恢复后补录。
待补录记录统一放 `new-colony/state/github-work-checkpoints.json`，先核验实时任务状态再上传，不能原样重放过时的owner。
不得把“已准备待上传”写成“GitHub 已更新”。401/403不重复重试同一凭据。

## 工具

工具通过用户已登录的 `gh` 访问固定仓库；不读取游戏 Token，不代管 GitHub Token。
首次初始化由 `operations/roadmap.json` 创建标签、里程碑和有稳定标识的 Issues：

```sh
python3 tools/github_ops.py sync              # 只预览缺失项
python3 tools/github_ops.py sync --apply      # 幂等创建；保留已有内容和状态
python3 tools/github_ops.py list
python3 tools/github_ops.py checkpoint --key fixed-logistics \
  --status verifying --owner-kind root --owner main-coordinator \
  --files new-colony/main.js new-colony/verify-economy.cjs \
  --next '检查新 API tick 的固定交接与失效恢复' \
  --evidence '填写真实提交、测试和快照 tick'
```

手工创建的新问题可用 `checkpoint --number N ...`，无需将其重复创建为路线图工单。
`--number` 与 `--key` 二选一；编号仅指当前固定仓库的真实 Issue，不接受 PR 或其他仓库。
完成用 `checkpoint --status done ... --evidence '验收证据'`，会关闭对应 Issue；
复发用其他状态会重开。状态更新只替换 `status:` 标签，保留 area/priority 等其他标签。
禁止用用户内容拼接 shell；描述通过 JSON stdin 提交。脚本在失败写入后不自行重试；先 `list` 回读。

## 版本和发布

根 `VERSION` 和 `CHANGELOG.md` 使用语义版本；游戏 build 标识独立记录。
重大不兼容改动升主版本，新增行为升次版本，修复升补丁版本。
每次有意义的改动单独提交并引用 Issue；合并同一批已验证工作再做发布标签。
保留旧历史，不 force push，不改已有 release tag，不伪造过去的提交。

发布前核对所有代理文件归属/交付状态；六模块整体上传意味着未完成模块不能混入部署。
执行相应离线回归、部署预演、安全扫描和 API 备份上传回读，再验证实际新 tick/行为/CPU。
Vercel 发布和游戏发布分别留证。GitHub Actions 只做离线检查，绝不持有游戏 Token 或自动写游戏。
发布日志不能包含凭据、完整 Memory、私人快照或 auth 文件。

能源目标仍是可持续总用能率 ≥90%，并保持升级与计划内建设产出。
按照 ENERGY_METRICS 的覆盖率和库存条件验收，不靠浪费能源提高指标。
