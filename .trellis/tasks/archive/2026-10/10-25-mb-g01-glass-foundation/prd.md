# G01 轻盈玻璃令牌与应用外壳

## 目标与前置

交付父任务R1、R2、R4、R6。用户已批准完整规划，并于2026-10-25允许G01在基线环境恢复前先启动；基线和验收仍须补齐，未PASS不得推进G02。 2026-10-25用户已批准最新完整规划，implementation_approval=granted；仍须满足本子任务前置门槛。

## 范围

DESIGN.md、styles.css的根令牌/外壳/共享控件、必要App标记、外观测试、相关frontend视觉规范。需求及非目标继承[父PRD](../10-25-mb-airy-glass-refactor/prd.md)，材料/兼容合同见[父设计](../10-25-mb-airy-glass-refactor/design.md)。

## 验收

- AC-1：目录来源与旧设计备份完整；新DESIGN明确浅深方案及字体/密度例外，CSS只有一个令牌系统。
- AC-2：薄荷紫场和单workspace纸面实际可见，blur层≤1，内部列表/well/dialog无blur，窄窗回退通过。
- AC-3：浅深/系统和全部公共控件状态一致；合成对比度文字≥4.5、控制边界/焦点≥3，白光边不冒充控件边界。
- AC-4：959/960、减少透明度、无filter、减少动态和forced-colors回退有浏览器证据；真实原生留G03。
- AC-5：原字体/字号/偏好与虚拟行几何保持，基础导航和640×480/20px可用，无新业务调用。

## 边界

禁止改ui-preferences持久化/度量或VirtualRows算法；只有视觉相关TSX标记。root DESIGN替换只在获批后，旧视觉备份与历史证据必须保留。 不提交、归档、安装、push或发布。G01阶段验收PASS，见evidence/check-report.md；最终Windows原生与集成验收仍由G03执行。
