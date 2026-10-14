# C02 执行步骤

## Gate

实施已获批准；启动前置：C01全部自身验收通过。读取父prd/design/task-map/verification及project-baseline、本任务jsonl。前置验收未通过不运行start。

## 顺序与验证

1. 先最小只读DirectWrite验证，确认本地集合、族名/本地化名、WebView渲染与fallback；记录runtime。
2. 按父design的DTO/命令边界完成系统服务、trusted guard、生成链与frontend adapter；补权限/异常合同测试。
3. 实现字体选择弹窗，复用焦点/列表原语；开闭/并发请求带有效性保护。
4. 实现v2只读迁移、字号数值及resolveAppearanceMetrics；更新主窗口首屏与所有几何消费者。
5. 运行单元/DTO/浏览器与原生字体/重启/preview拒绝验证；更新字体spec与新命令登记清单。

## 验证命令

pnpm protocol:check；pnpm lint；pnpm typecheck；pnpm test；pnpm build；受影响Rust fmt/test/clippy；pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/settings-layout.spec.ts；pnpm build:native及本任务新原生收据。

每项按父verification记录当前代码/产物hash、退出码、样本、主题、字体/字号、viewport和原生环境。首次截图保留baseline，后续不可覆盖。浏览器与原生分别下结论。

## 风险与收尾

本任务跨Rust/协议/React三个边界，先验证再消费。任何字体列表web mock都不能满足真实枚举AC。真实字形证明不依赖document.fonts.check。新能力不得放宽remote preview能力；不得把共享协议字段所有权规则误读为重开旧02，新的DTO扩展需保持同一生成合同。

使用Trellis实施/检查子代理流程时，活动任务必须是本子任务；给代理明确文件责任，保留其他已有改动。完成自验与独立检查后才允许下一任务start。提交/归档/日志记录仍由主会话按授权处理。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
