# Claude 工作台集成与原生验收

## 目标与授权

当前产物全应用集成、原生字体/重启/实际DPI、权限与性能回归；不安装日常应用，不开展旧真实模型验收。

所属父任务：[需求](../10-14-mb-claude-workspace-optimization/prd.md)。覆盖U01、U05、U09、U10及AC-P1–P8。implementation_approval=granted；用户已批准按顺序实施，状态以task.json和验收证据为准。启动前置：C03全部自身验收通过；C01/C02证据完整。一次一个子任务，不启动父任务。

## 需求

当前产物全应用集成、原生字体/重启/实际DPI、权限与性能回归；不安装日常应用，不开展旧真实模型验收。 用户最新字体要求为真实已安装列表选择和预览；仅名称输入不满足。通用设置基础已经存在，本轮在现有代码增量实施。

## 验收标准

- [x] AC-C04-1：父verification V02–V14在当前有效源码/产物证据下满足；未运行项真实保留，不宣告全验收。
- [x] AC-C04-2：实际Windows125/150%DPI和新PID重启，字体/主题/字号持久；列表和弹窗最大字号可用，绑定exe hash。
- [x] AC-C04-3：新命令preview拒绝、校准IPC零隐式业务调用、无网络字体，B10K普通搜索p95达原门槛。
- [x] AC-C04-4：研究截图与当前源码差异有准确结论或明确UNVERIFIED，不触碰日常安装；旧13/15及历史收据状态不变。
- [x] AC-C04-5：全应用前后截图、机器可读测量、自动/浏览器/原生分层收据、独立检查与稳定spec更新齐备。

## 范围与约束

C04是最终集成，不容许C01–C03跳过自验。DPI若缺实际环境则NOT_RUN且任务不关闭；已有真实睡眠豁免保持原状态，不将其重新加入本轮。没有借本轮UI验收关闭V12/V18。

具体行为合同引用父[设计](../10-14-mb-claude-workspace-optimization/design.md)、[DESIGN](../../../DESIGN.md)和父[验证矩阵](../10-14-mb-claude-workspace-optimization/verification.md)。沿用Windows范围、主窗口/preview隔离、明确apply、AI默认关闭；原13/V12、15/V18不变。无提交/归档/push/安装/发布授权。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
