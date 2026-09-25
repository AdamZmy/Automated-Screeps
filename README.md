# Automated-Screeps

AdamZmy 的 Screeps World 殖民地与能源监控网站。
当前游戏：官方 shard1 / frontier24，初始主房 W21N26。

- [`new-colony/`](new-colony/README.md)：唯一活动源码、六个游戏模块、HTTP API 客户端及行为回归。
- [`dashboard/`](dashboard/README.md)：[实时能源面板](https://screeps-energy-observatory.vercel.app)与[RCL建筑地图](https://screeps-energy-observatory.vercel.app/#layout)。
- [`OPERATIONS.md`](OPERATIONS.md)：Issue 生命周期、巡检分工、检查点和发布流程。
- [`ROADMAP.md`](ROADMAP.md)：RCL阶段和扩张门槛。
- [`CHANGELOG.md`](CHANGELOG.md)：版本变更；Git历史保留旧代码。

仓库根部旧 `main`、`role.*` 等文件仅为历史存档，**不参与当前游戏部署**。

使用 Node 22、Python 3.9+ 运行离线回归，无需游戏凭据：

```sh
npm ci --ignore-scripts
npm test
cd dashboard
npm ci --ignore-scripts
npm test
node verify-ui.cjs
node verify-layout-ui.cjs
```

所有游戏读写走项目 HTTP API；Token、完整Memory诊断、部署备份、环境变量均在Git之外。
GitHub Actions只验证代码，不自动发布游戏。实际发布仍须核验账号、活动分支与线上新tick。
