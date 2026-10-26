# G02 全工作区样式适配与交互回归

## 目标与前置

交付父任务R3、R5、R8。仅在 10-25-mb-g01-glass-foundation 阶段验收PASS后启动。 2026-10-25用户已批准最新完整规划，implementation_approval=granted；仍须满足本子任务前置门槛。

## 范围

styles.css页面规则、现有feature组件必要语义class/标记及对应浏览器回归。需求及非目标继承[父PRD](../10-25-mb-airy-glass-refactor/prd.md)，材料/兼容合同见[父设计](../10-25-mb-airy-glass-refactor/design.md)。

## 验收

- AC-1：父research页面清单逐项覆盖，包括详情全部tabs、五设置、首次接入、整理/语义、历史/导出和全部可信浮层。
- AC-2：输入/完成绿色与结果紫色仅表达真实语义；危险/未知有文字，proposal不误报完成；无逐行玻璃。
- AC-3：七尺寸、浅深14/20及极端12px满足bbox/滚动可达；20px最小窗完整一行，sticky区域无透字。
- AC-4：24/120隐藏列表锚点±1px、底部、草稿、勾选、End键、tab/focus/Escape/return-focus均保持。
- AC-5：来源切换、全量预览后确认、断线只读、导出取消、隐式调用禁令与远程预览边界无变化。

## 边界

App/LibraryWorkspace的挂载、portal、source/epoch、query、draft和订阅所有权不可改。不能为视觉把正文缩小、丢掉必要授权信息或放宽回归阈值。 不提交、归档、安装、push或发布。G02阶段验收PASS，见evidence/gate-review.md；最终Windows原生与集成验收仍由G03执行。
