# R03 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] R01、R02 验收通过；复用原05，原03/04除真实休眠外的门槛已在 R02 复核；真实休眠按 gate-change-2026-10-13.md 移至 R08 完成前，旧 V04 保持 UNVERIFIED；不提高Chrome树硬上限。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 先用超过旧上限/跨Profile/标签加查询样本复现缺口。
- [x] 扩展Rust/serde schema/TS生成查询合同，再适配UI分页与统一搜索。
- [x] 实现范围明确的选择、路径导航、键盘及动态虚拟高度。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、Rust三项、protocol:check、真实浏览器键盘/分页回归、B10K性能；不得把DOM测试耗时当原生性能。

主线程维护本项 `evidence/native-driver.mjs`、`native-performance.mjs`、`native-browse.mjs`、`native-live-query.mjs`。正式验收前重新构建 `seed_profile_cache` 和 `pnpm build:native`，使用最终源码对应产物。`native-performance.mjs baseline` 仅验证改动前测量脚本；正式命令为 `node .trellis/tasks/archive/2026-10/10-12-mb-r03-browse/evidence/native-performance.mjs final`。另运行 `native-browse.mjs` 的10001同目录/交集/键盘末项，以及 `native-live-query.mjs` 的实际Chrome变更后旧页拒绝和可见结果恢复。每次使用独立临时目录，保留具名首次失败/重测JSON；不执行会扫描日常资料的旧harness。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。
