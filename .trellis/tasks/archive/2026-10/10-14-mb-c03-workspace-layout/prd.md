# 全工作台排版与布局优化

## 目标与授权

应用壳、书签/详情、五设置与首次接入、整理/语义、历史/导出和可信浮层的布局与信息层级。

所属父任务：[需求](../10-14-mb-claude-workspace-optimization/prd.md)。覆盖U07、U08。implementation_approval=granted；用户已批准按顺序实施，状态以task.json和验收证据为准。启动前置：C02全部自身验收通过。一次一个子任务，不启动父任务。

## 需求

应用壳、书签/详情、五设置与首次接入、整理/语义、历史/导出和可信浮层的布局与信息层级。 用户最新字体要求为真实已安装列表选择和预览；仅名称输入不满足。通用设置基础已经存在，本轮在现有代码增量实施。

## 验收标准

- [x] AC-C03-1：全页面使用同一字阶、空间和表面规则；表单限宽、数据页利用宽屏、详情不长期限制在312px。
- [x] AC-C03-2：连接按有效宽度/字号分栏；六正式尺寸+2549×1356无横向整页溢出/重叠/不可达；20px×640×480可用。
- [x] AC-C03-3：所有导航与关闭返回焦点、未保存草稿、来源/query/selection/导出portal保留，不增加模型/抓取/索引调用。
- [x] AC-C03-4：按同fixture/viewport/字号做前后对照；空/加载/只读/错误/未知结果和长文本覆盖，不以铺满卡片代替层级。

## 范围与约束

布局优化不新建全局状态库、重写异步订阅、把源选择复制到设置或把远程页面注入可信DOM。目录/详情替换模式沿用；字号导致空间不足时优先叠列而非缩字。

具体行为合同引用父[设计](../10-14-mb-claude-workspace-optimization/design.md)、[DESIGN](../../../DESIGN.md)和父[验证矩阵](../10-14-mb-claude-workspace-optimization/verification.md)。沿用Windows范围、主窗口/preview隔离、明确apply、AI默认关闭；原13/V12、15/V18不变。无提交/归档/push/安装/发布授权。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
