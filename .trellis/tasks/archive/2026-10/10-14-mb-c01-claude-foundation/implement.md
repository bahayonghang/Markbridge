# C01 执行步骤

## Gate

实施已获批准；启动前置：用户明确批准本父任务最新完整规划。读取父prd/design/task-map/verification及project-baseline、本任务jsonl。前置验收未通过不运行start。

## 顺序与验证

1. 映射现有--blue等消费点到accent/focus/selected角色，更新单一令牌层。
2. 统一中文可读字阶、边距/圆角和公共状态，不引入官网布局。
3. 运行appearance/shell关键矩阵、对比度、键盘；补前后截图。
4. 根据结果修正DESIGN并更新相应frontend约定，提交C01独立check。

## 验证命令

pnpm lint；pnpm typecheck；pnpm test；pnpm build；pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/shell.spec.ts。按受影响范围选取初轮用例，完结前覆盖本AC。

每项按父verification记录当前代码/产物hash、退出码、样本、主题、字体/字号、viewport和原生环境。首次截图保留baseline，后续不可覆盖。浏览器与原生分别下结论。

## 风险与收尾

C01不把新默认14px偷偷塞入旧v1 standard=13；新v2默认由C02上线。现有旧字号几何仍保持。若C01必须调整行高，则同步共享映射并补旧字号原生验证，不能只改CSS。

使用Trellis实施/检查子代理流程时，活动任务必须是本子任务；给代理明确文件责任，保留其他已有改动。完成自验与独立检查后才允许下一任务start。提交/归档/日志记录仍由主会话按授权处理。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
