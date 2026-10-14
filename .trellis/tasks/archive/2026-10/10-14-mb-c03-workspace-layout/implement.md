# C03 执行步骤

## Gate

实施已获批准；启动前置：C02全部自身验收通过。读取父prd/design/task-map/verification及project-baseline、本任务jsonl。前置验收未通过不运行start。

## 顺序与验证

1. 记录同fixture基线；按DESIGN调整壳/表单/数据/详情宽度策略。
2. 依次检查书签/详情、五设置/首次接入、整理/语义、历史/导出，不改其业务状态owner。
3. 最大字号和最小窗优先检查分组、动作包裹与弹窗可达；修正集中布局规则。
4. 完成全页面截图、键盘/草稿/业务调用回归；提交独立check。

## 验证命令

pnpm lint；pnpm typecheck；pnpm test；pnpm build；pnpm exec playwright test tests/e2e/shell.spec.ts tests/e2e/settings-layout.spec.ts tests/e2e/details.spec.ts tests/e2e/organize.spec.ts tests/e2e/semantic.spec.ts tests/e2e/history.spec.ts tests/e2e/appearance.spec.ts。

每项按父verification记录当前代码/产物hash、退出码、样本、主题、字体/字号、viewport和原生环境。首次截图保留baseline，后续不可覆盖。浏览器与原生分别下结论。

## 风险与收尾

布局优化不新建全局状态库、重写异步订阅、把源选择复制到设置或把远程页面注入可信DOM。目录/详情替换模式沿用；字号导致空间不足时优先叠列而非缩字。

使用Trellis实施/检查子代理流程时，活动任务必须是本子任务；给代理明确文件责任，保留其他已有改动。完成自验与独立检查后才允许下一任务start。提交/归档/日志记录仍由主会话按授权处理。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
