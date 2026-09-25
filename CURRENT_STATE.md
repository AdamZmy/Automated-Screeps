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

## 最近核验证据（旧快照，下轮必须取新数据）

- 新审计tick73931000、Game73931008/73931024，仍为`.10`，六模块API一致。800容量，两源箱均2000/2000，地面1991；远矿积压4560tick。
- 两只650能量Upgrader共8WORK，升级预算却为2/t；三只200能量Builder共3WORK，建设预算13.5/t、300tick实际5.5667/t。
- 300tick升级4.9467/t，占实际采集25.59%；总用能79.23%，残差未解释，不判定健康。具体修复范围/验收见P0 #4，优先于#5/#9及扩张。

- 项目发布 v0.2.0，游戏 build `2026-09-25.10`；游戏代码提交 `126189a`。
- `.10`开始tick73930364；tick73930387四升级工已固定驻站、有能量，无hauler向creep配送。
- tick73930425四席仍在，上一运输任务已释放、交货口已让开；完整补给/续代/施工周期仍待验证。
- 纯20tick窗口73930381–400 CPU均值7.2857、峰值10.1223、Memory176094、bucket10000。
  与旧窗口角色/施工负载不同，不能宣布性能改善或无回退。
- 1500tick≥90%尚未验收。发布前73930200为89.36%且存在unexplained-balance。
  首个纯`.10`1500tick窗口不早于73931864；完整覆盖、库存持续性和残差仍必须分别合格。
- 主房复核布局 `2026-09-25-international-adapter-1` 已上线，205项；其他冷房仍是旧v3。
- 网站 https://screeps-energy-observatory.vercel.app ，布局 `/#layout`。
  生产 `dpl_2QHBtL9eZefWFx8L9oyVX1y4ytet`；地图是tick73930304快照，非实时施工。
- GitHub有10个路线图Issue及巡检迁移#11、4个里程碑；#4升级P0，本轮未新建重复能源工单。main及v0.1.0/v0.2.0已发布。

## 下轮读取远端 Issue，以下仅为交接索引

- #1 fixed-logistics：verifying，检查完整固定节点补货/换体/建造取能和同负载CPU。
- #4 sustainable-utilization：**priority:p0 / ready**，用户要求最高优先解决矿区溢出；先修施工未用预算回流升级、工人体型与补给周期，再做长期≥90%验收。
- #5 movement-cost、#9 neighbor-layout-review：ready，按优先级与文件归属认领。
- #6/#7/#8/#10：planned，分别受仓储、扩张、Link及成熟基地阶段门槛约束。
- #2 GitHub管理、#3 主房复核布局：已done，不重复初始化或重开已完成工作。
- #11记录独立巡检迁移；以 `python3 tools/github_ops.py list` 返回状态和最新检查点为准。

## 协调者交接

- 最近审计协调者任务ID：`01a0d78f-8784-79d2-aeda-5f6987b8836e`；已完成#4证据与P0工单更新，没有游戏代码写入/部署或待运行子代理。
- 旧协调者 `01a0d3ca-10e0-7362-a9d0-1f3c60a63853` 已通过即时状态确认 idle/迁移完成。下轮仍核验最新owner后认领。
- 固定交接/CI/主房地图子代理已交付；布局任务 `01a0d746-f0e4-78a3-9093-43f8f506a26d` 已完成。
- 启动写入前，用即时任务状态核验上轮协调者和Issue owner；新代理列表为空不代表旧代理停止。
- 若仍运行则本轮不竞争写入/部署；确认停止后记录本轮协调者ID再接管。阶段变化写Issue检查点。
- 每轮结束覆盖本文件的最新核验tick/风险/下一检查点/协调者；不要追加完整巡检流水。
