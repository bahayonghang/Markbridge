# R07 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] R04、R05、R06 验收通过；原10/11/12功能回归；不添加新模型算法或无授权云调用。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 把维护/组织从详情迁入独立整理区，连接范围摘要与返回路径。
- [x] 统一任务状态/取消/结果审查和历史链接。
- [x] 将AI配置和单条建议合理分区，验证默认不调用与禁写边界。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、组织/AI/维护行为回归、浏览器切区时任务状态；确定性fixture与原生证据分列，本机模型缺失记NOT_RUN。

首轮目录生成取消的窄 Rust/IPC 扩展需要 Rust fmt/clippy/tests。原生用本项 `evidence/native-organize.mjs` 和 `native-web.mjs`，均使用任务临时 Chrome/应用目录；`native-model.mjs` 只提供本机合成 HTTP 响应来验证真实传输、取消和审查，不能标记真实模型质量通过。公共页面抓取保护保持不变，loopback 链接不得为了测试放行。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。
