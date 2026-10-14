# Claude 风格基础与全局视觉令牌

## 目标与授权

仅主题、共享字体角色、公共控件/导航/弹窗视觉；保留现有三档字号的数据/行高，精确字号由C02承担。

所属父任务：[需求](../10-14-mb-claude-workspace-optimization/prd.md)。覆盖U06、U07。implementation_approval=granted；用户已批准按顺序实施，状态以task.json和验收证据为准。启动前置：用户明确批准本父任务最新完整规划。一次一个子任务，不启动父任务。

## 需求

仅主题、共享字体角色、公共控件/导航/弹窗视觉；保留现有三档字号的数据/行高，精确字号由C02承担。 用户最新字体要求为真实已安装列表选择和预览；仅名称输入不满足。通用设置基础已经存在，本轮在现有代码增量实施。

## 验收标准

- [x] AC-C01-1：style:claude转为暖灰/墨色/陶土强调的明暗语义令牌；保留Markbridge品牌资产；无网络/专有字体。
- [x] AC-C01-2：导航、按钮、输入、标签、状态及可信浮层全部状态可读；实际消费对比度达标。
- [x] AC-C01-3：现有主题/三字体/三字号、设置入口、checkbox与草稿保留；六正式尺寸无基础布局回归。
- [x] AC-C01-4：当前源码截图和computed-style收据齐全，候选配色计算不冒充运行验收。

## 范围与约束

C01不把新默认14px偷偷塞入旧v1 standard=13；新v2默认由C02上线。现有旧字号几何仍保持。若C01必须调整行高，则同步共享映射并补旧字号原生验证，不能只改CSS。

具体行为合同引用父[设计](../10-14-mb-claude-workspace-optimization/design.md)、[DESIGN](../../../DESIGN.md)和父[验证矩阵](../10-14-mb-claude-workspace-optimization/verification.md)。沿用Windows范围、主窗口/preview隔离、明确apply、AI默认关闭；原13/V12、15/V18不变。无提交/归档/push/安装/发布授权。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
