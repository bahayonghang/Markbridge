# R06 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] R04、R05 验收通过；原06恢复/备份；真实文件保存权限必须最小化，不能开放通用前端文件写入。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 从EditDesk提取历史和导出，回归只读状态入口。
- [x] 实现原生保存及取消/写失败合同，同步DTO和受限capability。
- [x] 实现历史详情、撤销diff/冲突反馈，与R04批次恢复对接。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、Rust三项/协议（若变）、原生保存取消/失败/真实文件解析、删除恢复和外部冲突样本。

原生证据通过本项 `evidence/native-export.mjs`、`native-history.mjs`、`native-web.mjs` 运行，分别覆盖实际保存与文件解析、历史条件恢复、远程页面新命令拒绝。保存期间并发变更用于验证快照一致性。所有环境保持临时隔离，禁止运行会探测日常 Chrome 的旧任务验收入口。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。
