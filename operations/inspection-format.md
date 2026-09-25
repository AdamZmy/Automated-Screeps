# 巡检日志接口约定 v1

公开仓库 `AdamZmy/Automated-Screeps` 的 `operations/inspections/` 是日志存储；不要上传凭据、原始Memory、私人路径或完整聊天。
每轮一份JSON和可读Markdown，同轮进度更新同一个ID，Git记录修订；无变化/受阻/失败也记录。过去记录只可明确标记backfill并引用真实证据，不伪造历史巡检。

## 文件

- `index.json`：`{schemaVersion:1,updatedAt,days:["YYYY-MM-DD"],runs:[summary...]}`；days倒序完整保留，runs最多50条最新摘要。
- `YYYY-MM-DD/index.json`：`{schemaVersion:1,updatedAt,day,runs:[summary...]}`；该UTC日期全部批次倒序。
- `YYYY-MM-DD/<id>.json`和同名`.md`。ID格式 `YYYY-MM-DDTHH-mm-ssZ-<slug>`，slug为小写字母数字短横线，合计不超过96字符；前缀必须与startedAt的UTC秒一致。
- summary只包含 `id,kind,startedAt,updatedAt,completedAt,status,title,summary,tick,issueNumbers`；tick从game取或null，issueNumbers去重排序。

## 单批次完整JSON

必需字段如下；空数组保留，未知字段拒绝。时间均为ISO8601 UTC字符串，completedAt进行中为null、终态必须有值，tick未知为null，未知不等于零。

```json
{
  "schemaVersion": 1,
  "id": "2026-09-25T09-15-00Z-example",
  "kind": "scheduled",
  "startedAt": "2026-09-25T09:15:00Z",
  "updatedAt": "2026-09-25T09:15:00Z",
  "completedAt": null,
  "status": "running",
  "title": "巡检标题",
  "summary": "本轮结论",
  "game": {"shard":"shard1","rooms":["W21N26"],"version":null,"tick":null,"fetchedAt":null},
  "findings": [{"severity":"warning","title":"发现的问题","detail":"观察与影响","evidence":["带tick的证据"],"issue":4}],
  "tasks": [{"issue":4,"title":"待办","status":"verifying","progress":"实际进度","next":"下一步验收","owner":"本轮协调者"}],
  "actions": [{"at":"2026-09-25T09:15:00Z","description":"已采取或计划的动作","status":"done","result":"实际结果"}],
  "checks": [{"name":"检查名称","result":"pending","detail":"证据或等待条件"}],
  "next": ["下一轮要做的事"],
  "references": [{"label":"关联Issue","url":"https://github.com/AdamZmy/Automated-Screeps/issues/4"}]
}
```

- kind：scheduled/manual/backfill/setup；setup是系统建设记录，不冒充游戏巡检。
- status：running/completed/blocked/skipped/failed；只表示本轮执行状态，不代表所有游戏问题解决。
- findings.severity：info/warning/critical。
- tasks.status：planned/ready/in-progress/verifying/blocked/done。
- actions.status：planned/in-progress/done/failed；checks.result：passed/failed/pending。
- `game`可为null；存在时上述五个键齐全，缺失观测字段可为null。
- issue可为null或正整数，始终链接本仓库；references只允许本仓库GitHub HTTPS链接或既有监控站HTTPS链接。
- 避免无限制自由输入：单批次JSON上限256KiB；根索引上限1MiB、最多10000个日期及50条最近摘要；每日索引上限8MiB、最多10000条（正常定时巡检每天72条）。越界明确报错，不能静默截断日期或历史。字符串/数组有合理上限；文本按纯文本显示，不执行HTML/Markdown脚本。

## 网站只读API

`GET/HEAD /api/inspections` 返回 `{ok:true,source:"github",fetchedAt,stale:false,data:<root index>}`。
`?day=YYYY-MM-DD`返回同一包装的日期index；`?id=<id>`返回同一包装的单批次JSON。两种参数互斥、不能有其他参数。
客户端通过index的days选择UTC日期；日期与本地显示时间应明确。详情URL为 `/logs?id=<id>`，页面默认显示最新50条。
上游只能固定到 `https://raw.githubusercontent.com/AdamZmy/Automated-Screeps/main/operations/inspections/`，不使用任何游戏或GitHub密钥，拒绝重定向，有限大小/超时/短缓存。
失败返回 `{ok:false,error:{code,message}}`，若使用已缓存内容必须stale=true且注明原因/旧fetchedAt；禁止用空数组冒充读取成功。
新日志经Git推送后由API动态读取，不逐轮部署Vercel。页面应有刷新、日期/状态筛选、批次列表/详情、GitHub原文链接、空/加载/错误状态；失效时保留可识别的旧内容。
