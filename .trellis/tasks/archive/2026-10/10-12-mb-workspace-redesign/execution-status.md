# 改版实施状态

2026-10-13 用户批准按顺序实施。R01–R08已完成调整后范围内的验收与独立审查，改版父任务已完成，保持未提交、未归档。R08 AC1–5通过；真实睡眠按用户最新指令WAIVED且实际NOT_RUN，未计作测试通过。

历史启动门槛：R02依赖R01及旧03/04，用户最初把真实休眠延期至R08；当前决定已改为本轮豁免，见 gate-change-2026-10-13.md。旧V04仍为UNVERIFIED。

## R01 交付

蓝色书签工作台、侧栏导航、按需详情、小窗文件夹/详情替换视图、设置分类、既有历史/导出独立入口，以及键盘和复选框修复。浏览器与原生合成数据分别验收；最终 exe hash、截图、首次失败和重测见 [R01 收据](../10-12-mb-r01-shell/evidence/receipts.md)。实际 Windows 125% 已观察，进程 150% 补充已通过；系统 150% / 跨屏切换已在 R08 的 69aebea8 真实显示器验收通过。

## 门槛调整与当前实施

旧 `.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/receipts.md` 最新真实导入核对通过，但实际 OS 休眠恢复没有证据；旧 04 的 RunEvent::Resumed 自动测试也不等于主机休眠。用户当时批准延期至R08以继续R02，随后明确豁免本轮该项。前者是历史决定，后者为当前门槛；完整记录见 gate-change-2026-10-13.md。

R02 已实现接入引导、来源状态、切换输入保护、配对到期恢复与吊销确认。实施 111+6 单元/脚本、25 浏览器通过；审查后 47 聚焦回归、7 接入浏览器通过。最终 native-70727125.json 为真实 Tauri + 两个临时 Chrome + 合成只读文件 11 项 PASS，生产构建/扫描通过。R03 可开始完整分页、组合搜索与选择；旧编辑预览竞态交 R04 处理。详细证据见 [R02 收据](../10-12-mb-r02-connection/evidence/receipts.md)。

## 工作区保护

R03已实现完整分页、交集搜索、已加载范围多选、深路径与虚拟列表。最终原生browse d23bba4d为11PASS、live f1e15a18通过，B10K647f28ce暖p95=103.2ms、三次冷启动均≤647.832ms；首次207.9ms性能失败及SQL修复证据保留。详见[R03收据](../10-12-mb-r03-browse/evidence/receipts.md)。R04实施编辑与普通批量；R05另有AI切换busy的明确交接。

已有 scripts/foundation.test.mjs 与 scripts/tauri-dev.mjs 未提交改动，实施不覆盖。未提交、归档、发布或修改日常Chrome。

## R04 交付

完成空目录创建、独立草稿、完整路径目标选择、普通批量移动/删除审查、逐项回执历史恢复及安全边界。核心原生normal7PASS、四种第40项故障各4PASS、managed8PASS；最终UI ad0def29为5PASS（exe9ac5157f），Windows经典滚动条位移问题已修复。自动检查141+6、Rust133、39浏览器通过。详见[R04收据](../10-12-mb-r04-editing/evidence/receipts.md)。

## R05 交付

详情3分区、多选本地元数据、草稿保留与离开确认、按需双预览、epoch隔离和真实失败反馈。最终原生详情e5e26b2a为6PASS（20次A/B实际延迟40次真实Response、五尺寸、离线存储、滚动返回），网页2c95c715为11PASS（65命令拒绝、会话隔离、焦点与导航限制）。冻结exe f43fa182 /23,772,160bytes；自动156+6、Rust136/3ignored、45浏览器全绿。见[R05收据](../10-12-mb-r05-details/evidence/receipts.md)。既有AI已确认操作的取消文案交R07，不能误称取消撤回已发送操作。

## R06 交付

独立历史、完整条件撤销、真实原生保存与一致缓存导出。最终exe89c17f5a，原生history61440e3d 6PASS、export951c480a 6PASS、web c3d68946 11PASS/68命令拒绝；自动167+6、Rust142/3ignored、51浏览器。全部AC和独立审查通过，见[R06收据](../10-12-mb-r06-history/evidence/receipts.md)。

## R07 交付

独立整理中心、显式范围、重复/链接/单条AI及目录审查、真实取消与历史追溯。最终exe804d9207，原生organize874dbc46为10PASS、web e34f302e为11PASS/68命令拒绝；最终自动178+6、Rust146/3ignored、58浏览器。取消竞态及误报链接完成问题已修复，首次失败保留。见[R07收据](../10-12-mb-r07-organize/evidence/receipts.md)。真实模型质量NOT_RUN。

## R08 集成进度

AC1–5 已通过，AC6 真实 OS 睡眠按用户最新指令记 WAIVED，实际 NOT_RUN，旧 V04 仍 UNVERIFIED。完整自动178+6/60 E2E、lint/typecheck PASS；沿用未变化 R07 Rust146/3ignored及构建/协议检查。当前exe仍804d9207。新原生daily c4d33b1e为7PASS；B10K1a3d7a21暖p95=129.2ms，3冷700.829–732.339ms；live e5a17113为100事件p95=82ms/max88ms；actual DPI69aebea8为3屏144/120/144和150%五尺寸PASS。睡眠观测工具probe52c7576b通过，包括实际非live apply拒绝；这不是OS睡眠通过。详见[R08收据](../10-12-mb-r08-acceptance/evidence/receipts.md)。用户已明确“这一条不用管，使用的时候也不会睡眠”；该项不再阻塞本轮完成，详见门槛调整记录。

最终文档独立复核确认无其他阻塞；R08及父task.json均completed。所有历史失败/未执行收据保留，旧任务状态不改写。
