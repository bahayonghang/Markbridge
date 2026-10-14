# C04 执行步骤

## Gate

实施已获批准；启动前置：C03全部自身验收通过；C01/C02证据完整。读取父prd/design/task-map/verification及project-baseline、本任务jsonl。前置验收未通过不运行start。

## 顺序与验证

1. 汇总C01–C03可复用证据及hash差异，补缺项而非盲目重复全部历史实验。
2. 执行正式自动检查/全受影响e2e，保存当前目录下截图和测量。
3. 当前exe在隔离app根验证真实字体/重启/DPI/preview新命令拒绝；观察器先校准。
4. 按既有B10K方法验证普通搜索p95；修复本轮回归，重新跑受影响项。
5. 独立trellis-check审查，更新spec与当前验证报告，向用户报告完成边界；未经授权不提交/归档。

## 验证命令

pnpm lint；pnpm typecheck；pnpm test；pnpm protocol:check；pnpm build；pnpm test:e2e；受影响Rust检查；pnpm build:native；git diff --check。原生和性能脚本复用合法方法，任务内新收据不得覆盖归档证据。

每项按父verification记录当前代码/产物hash、退出码、样本、主题、字体/字号、viewport和原生环境。首次截图保留baseline，后续不可覆盖。浏览器与原生分别下结论。

## 风险与收尾

C04是最终集成，不容许C01–C03跳过自验。DPI若缺实际环境则NOT_RUN且任务不关闭；已有真实睡眠豁免保持原状态，不将其重新加入本轮。没有借本轮UI验收关闭V12/V18。

使用Trellis实施/检查子代理流程时，活动任务必须是本子任务；给代理明确文件责任，保留其他已有改动。完成自验与独立检查后才允许下一任务start。提交/归档/日志记录仍由主会话按授权处理。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
