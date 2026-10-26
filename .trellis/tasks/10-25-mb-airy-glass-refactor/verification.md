# 验证矩阵（2026-10-25最终集成）

G01/G02独立阶段检查已通过。G03当前自动、浏览器、原生功能及性能复测均有实际收据；最终独立检查见[G03报告](../10-25-mb-g03-glass-acceptance/evidence/check-report.md)。恢复环境的早期结果不替代本表锁定依赖环境结果。

| ID | 判据 | 结果与当前证据 |
|---|---|---|
| V01 | 规划三件套、父子/上下文与R→AC→V覆盖 | PASS，planning-validation.json；G01/G02/G03独立检查 |
| V02 | 薄荷紫场、单paper、20px/1.15；行/dialog无blur；959/960 | PASS，G03全量airy-glass、实际原生截图；scroll-comparison当前blur1/行filter none |
| V03 | 浅深/系统、固定主题、启动不写偏好；字体与12–20保留 | PASS，全量appearance/font-picker；当前原生13控制、真实退出重启及字体glyph证据 |
| V04 | 七尺寸全页bbox/真实滚动祖先、最小窗20px完整行和最后动作 | PASS，全量workspace-layout/review/settings；实际120/144DPI八组、原生弹窗命中检查 |
| V05 | 空/加载/失败/只读/过期/冲突/未知；导航、确认与全量审查 | PASS，全量231浏览器及G02页面覆盖表；原生实际导出取消 |
| V06 | 最差合成背景及消费状态；文字≥4.5、边界/焦点≥3、环≥2px | PASS，ancestor alpha+saturate合成、未知背景拒绝；实际选中history/forced-color子标签回归 |
| V07 | v1只读/v2、12/14/20行与控件几何；字体应用/取消 | PASS，浏览器与原生12/14/20指标、9种v1只读迁移、真实glyph及缺字体回退 |
| V08 | 隐藏24/120锚点±1px、底部/草稿/checkbox/End、sticky不遮挡 | PASS，全量appearance/shell与当前原生锚点/草稿/焦点检查 |
| V09 | 窄窗/reduced-transparency/无filter/reduced-motion/forced-colors | PASS（浏览器分支和模拟）；原生媒体支持记录独立，Windows透明度开关联动NOT_VERIFIED，未作支持声明 |
| V10 | 同机锁定环境B10K三轮p95预算、DOM有界、原生搜索p95≤200ms | PASS（带完整复测说明）：滚动浅7.0→7.1ms≤9.0，深7.1→7.1≤9.1；当前最多17行；原生首轮208.6ms FAIL，唯一相同条件新目录复测149.2ms PASS，两轮保留，差异原因UNVERIFIED |
| V11 | 当前exe退出/新PID恢复偏好；实际125/150%DPI20px小窗/弹窗/滚动 | PASS，当前exe33b9a601…；PID51940→85720；120/144DPI×浅深×1100×760/640×480共8组；42屏幕/13控制 |
| V12 | lint/typecheck/test/protocol/build/e2e；校准IPC/无隐式业务调用/preview权限 | PASS，Vitest272、Node35、浏览器231；协议/产物扫描PASS；真实校准、81命令preview拒绝；owned进程/监听清零 |

## 当前证据索引

- [完整自动与截图](../10-25-mb-g03-glass-acceptance/evidence/automated-report.md)：锁定217包版本/完整性；20个浏览器文件，231通过、0失败/跳过/flaky；272单元与35 Node测试。
- [滚动前后比较](../10-25-mb-g03-glass-acceptance/evidence/scroll-comparison.json)：同Edge156.0.4314.42/机器/1440×900/14px/同脚本，浅深各三轮；原始trace无损gzip并校验摘要。
- [当前原生报告](../10-25-mb-g03-glass-acceptance/evidence/native-report.md)：当前构建、完整脚本/输入指纹、实际DPI与字体、重启、权限、搜索两轮分布及清理。
- [原生功能收据](../10-25-mb-g03-glass-acceptance/evidence/native/run-1792930130353-bc46d593/result.json)。原生首轮误把背景滚动容器当作modal top-layer裁剪祖先；失败与旧脚本保留，修正测试模型并增加真实命中断言后通过，产品未改。
- 原生搜索[首轮失败](../10-25-mb-g03-glass-acceptance/evidence/current-performance-6c9eb871-0862-4c42-8ddb-5bb87860ddc9-receipt.json)与[同条件复测](../10-25-mb-g03-glass-acceptance/evidence/current-performance-743eda0d-b839-43b8-90ba-d5d8e5a1990c-receipt.json)。通过线、30样本定义、焦点与代码均未改变；不从这两轮推断长期稳定性或根因。
- 旧基线失败与早期恢复环境保留，见research/baseline-receipt.md、baseline-recovery.md及locked-runtime-recovery.md；最终滚动比较重新跑了锁定环境旧代码。

## 范围与限制

七尺寸为640×480、640×760、1100×480、1100×760、1440×900、1920×1080、2549×1356，浅深14/20px及极端12px，另测959/960材料边界。页面/浮层覆盖见G02独立报告。模拟、高对比浏览器与真实Windows分别记录。未安装、签名、打包发布、提交、归档或操作日常Chrome。旧13/V12、15/V18和原父任务未完成状态不变；启动耗时仅额外观察，不在本轮改判。

收据时点说明：G03 automated-report.md与automated/receipt.json冻结于滚动性能执行前，因此保留pending文案/状态。随后实际滚动结果在scroll-comparison.json，完整独立PASS结论在check-report.md/check-receipt.json；不改写冻结收据的独立审查摘要。最终主会话完成记录见completion-report.md。

## 标准CI与当前产物追加验收

用户随后授权运行just ci并提交归档。实际just ci全部12阶段通过（397.9秒）：272 Vitest、35 Node、195 Rust通过/5既有忽略、231 Chromium通过。使用已审计217包外部modules目录，冻结锁验证仍执行，模块目录重写与运行前自动重写关闭；默认符号链接安装在本机仍不可用。精确环境与所有失败见[G03 CI收据](../10-25-mb-g03-glass-acceptance/evidence/ci-20261025/report.md)。

标准入口构建当前exe661468a8…，与早先33b9…不同；旧收据不改标。当前6614…已重新完成13原生控制、120/144DPI八组、真实重启/字体/81命令隔离和正常清理。严格静默首次30样本搜索p95=126.8ms、max=138ms，通过固定200ms门槛；新旧产物证据分别保存。最终收尾复核见[G03追加独立检查](../10-25-mb-g03-glass-acceptance/evidence/ci-20261025/final-check-report.md)。
