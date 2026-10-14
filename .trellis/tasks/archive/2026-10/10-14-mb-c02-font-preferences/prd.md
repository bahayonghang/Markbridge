# Windows 字体列表与通用设置增强

## 目标与授权

真实Windows字体目录、列表搜索/预览/使用/取消/刷新、精确字号、v2迁移与共享几何。字体文件导入/安装不在范围。

所属父任务：[需求](../10-14-mb-claude-workspace-optimization/prd.md)。覆盖U01–U05、U09。implementation_approval=granted；用户已批准按顺序实施，状态以task.json和验收证据为准。启动前置：C01全部自身验收通过。一次一个子任务，不启动父任务。

## 需求

真实Windows字体目录、列表搜索/预览/使用/取消/刷新、精确字号、v2迁移与共享几何。字体文件导入/安装不在范围。 用户最新字体要求为真实已安装列表选择和预览；仅名称输入不满足。通用设置基础已经存在，本轮在现有代码增量实施。

## 验收标准

- [x] AC-C02-1：main按需取得真实已安装字体族列表，至少核对CJK/Latin两种；preview/非main拒绝，无路径/字节/网络字体。
- [x] AC-C02-2：按显示名/族名搜索、键盘候选、实际样例、使用与取消正确；刷新/失败/空目录/迟到结果不改全局选择。
- [x] AC-C02-3：12–20px有效输入、快捷值、字号几何共享，无剪裁/行重叠；24/120列表中段/底部/隐藏/checkbox和草稿通过。
- [x] AC-C02-4：v1的system/yahei/song及12/13/15原值保留；v2异常/未知/存储拒绝与reset边界通过；真实进程重启保留。
- [x] AC-C02-5：新DTO的Rust/Schema/TS/Ajv一致；日志无字体清单；普通浏览通用不扫描，预览不写偏好；无业务调用副作用。

## 范围与约束

本任务跨Rust/协议/React三个边界，先验证再消费。任何字体列表web mock都不能满足真实枚举AC。真实字形证明不依赖document.fonts.check。新能力不得放宽remote preview能力；不得把共享协议字段所有权规则误读为重开旧02，新的DTO扩展需保持同一生成合同。

具体行为合同引用父[设计](../10-14-mb-claude-workspace-optimization/design.md)、[DESIGN](../../../DESIGN.md)和父[验证矩阵](../10-14-mb-claude-workspace-optimization/verification.md)。沿用Windows范围、主窗口/preview隔离、明确apply、AI默认关闭；原13/V12、15/V18不变。无提交/归档/push/安装/发布授权。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
