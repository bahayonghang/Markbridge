# R04 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] R03 验收通过；原06编辑/receipt/undo安全合同；新增批量路径必须独立验证V07/V08，不沿用归档PASS。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 复现空目录新建与批量操作缺口，建立保护/冲突/丢ack行为样本。
- [x] 实现表单/目标树/单条diff，再扩展Rust批次与协议生成链。
- [x] 接通批量工具栏、逐项进度与停止/恢复入口，核对备份/条件撤销所需数据。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、Rust三项、protocol:check；隔离Profile CRUD/批量第40步断连/丢ack/备份失败，记录零额外写入及语义树。

原生脚本位于本项evidence：`node native-harness-smoke.mjs`仅验证隔离驱动；最终产物使用`node native-batch.mjs normal`及`disconnect_before`、`drop_ack`、`pause_before`、`external_conflict`逐项运行。脚本从仓库根以完整相对路径执行。每次创建专用临时Chrome和应用目录；故障仅在这个临时扩展的service worker运行时注入，不改扩展产物或注册表。脚本执行完撤销临时配对凭据并关闭自己的进程。构建和原生收据分别记录，未跑脚本不计为通过。

`node native-editing.mjs`通过真实WebView2点击验证空目录新建、独立草稿、取消、路径选择和批量审查回执，截图1100×760与640×480。`node native-managed.mjs`使用现有未修改的临时stock Chromium二进制，只在新临时Profile的Local State设置test policy，验证managed及后代的批量选择/目标拒绝和禁用UI；不写系统注册表或已安装策略目录。此样本明确标Chromium，不冒充日常Chrome验收。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。
