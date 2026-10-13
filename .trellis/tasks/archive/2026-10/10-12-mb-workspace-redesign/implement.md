# 执行计划

2026-10-13 用户批准完整规划并要求按顺序实施，implementation_approval=granted。父任务不 start，一次实施一个通过前置验收的子任务；按 gate-change-2026-10-13.md，用户先将真实休眠验收移到 R08，后又明确豁免本轮该项；AC6为WAIVED、实际NOT_RUN，其他旧门槛不变。

顺序：R01壳层 → R02接入 → R03浏览选择 → R04编辑批量 → R05详情 → R06历史导出 → R07整理设置 → R08集成。

## 执行流程

- [x] 复核 task-map.md 依赖及旧03/04门槛；真实休眠按用户最新指令从本轮门槛移除并记WAIVED，其余阻塞先补证据，不用新UI测试替代。
- [x] 读取当前diff、baseline、子任务三份文档、父计划和相关spec，保护现有脚本改动。
- [x] 读取 trellis-before-dev，通过Trellis实施/检查子代理工作，主会话维护范围与证据。
- [x] 对实际缺口增加行为回归，实现UI与必要后端合同；优先复用。
- [x] 执行子任务检查，保留失败与重测；渲染截图而非仅看CSS。
- [x] 稳定合同写回spec；真正变动旧命令/门槛才同步原计划。
- [x] 独立通过后再开始下一子任务；提交/归档/发布/日常安装另授权。

## 命令

前端：pnpm lint、pnpm typecheck、pnpm test、pnpm build。浏览器：pnpm test:e2e。协议：pnpm protocol:check。Rust变化：cargo fmt --all -- --check、cargo clippy --workspace --all-targets -- -D warnings、cargo test --workspace --locked。

原生使用仓库当前隔离目录与临时Profile harness，先查旧13最新运行说明，不能裸启动到日常数据。pnpm build:native只证明构建扫描，不代表交互通过。具体新增用例在实现时记录真实路径。

R02 实際接入验收脚本为其 `evidence/native-connection.mjs`。R03 使用其 `evidence/native-performance.mjs final`、`native-browse.mjs`、`native-live-query.mjs`，均由任务本地驱动创建临时目录；先重建Rust `seed_profile_cache` 和最终桌面产物。R03的baseline运行只保留对照，不能关闭新查询验收。具体方法与结果分别在R03 implement.md / evidence/receipts.md，不覆盖旧05/13收据。

R04使用本项`evidence/native-batch.mjs`，分别运行normal、disconnect_before、drop_ack、pause_before、external_conflict。真实Tauri与临时Chrome验证普通批次、备份失败、第40项故障和重启无续跑；worker故障注入仅限本次测试临时加载的扩展。具体UI与自动测试结果在R04收据记录。

R05 使用本项 `evidence/native-details.mjs` 与 `native-web.mjs final`：真实标签备注离线写入、20次交替选择、小窗返回、独立预览权限/会话和暂停外开接力。main WebView 必须随 MARKBRIDGE_APP_DATA 使用临时目录，不能用全局 WEBVIEW2_USER_DATA_FOLDER 覆盖预览分区。详见 R05 implement.md 与收据。

R06 使用本项 `evidence/native-export.mjs`、`native-history.mjs`、`native-web.mjs`：实际系统保存对话框、可解析 HTML/JSON、取消、目标占用与重试、导出期间快照一致性、离线/镜像、删除 ID 与侧车恢复、外部冲突和部分批次恢复，以及新命令在远程页面的拒绝。系统对话框拒绝和 Rust 写入失败分别记录；不混称同一种失败回执。

R07 使用本项 `evidence/native-organize.mjs` / `native-web.mjs`，临时 Chrome 与真实 Rust 传输验证范围、去重审查写回、生成取消、过期方案和历史返回。AI 端点只运行任务本地合成 HTTP fixture，真实模型质量单列 NOT_RUN。首轮目录取消增加可选 requestId，沿用既有 cancellation gate，因此需要 Rust 三项门槛。

## 回退

R08 使用本项 `evidence/native-daily.mjs`、`native-performance.mjs final`、`native-live.mjs`、`native-system.mjs probe|display|sleep`。浏览器全套截图必须设置 MARKBRIDGE_EVIDENCE_DIR 到 R08 下。性能预先构建 `cargo build -p markbridge-core --example seed_profile_cache --locked`。原生脚本串行运行，真实睡眠现已由用户豁免，不再要求运行。保留脚本的可选方法：真实睡眠由用户手动选择并等待至少60秒，不调用自动休眠；Power事件按42→107或506→507配对，需同epoch、新session、revision推进、全树一致和零回放。non-live禁写由当前产物真实断连/READ_ONLY拒绝及稳定UI观察分层证明。`probe`只证明观测器可用，不等于睡眠通过。当前门槛由用户指令豁免。显示脚本只移动自有窗口到既有显示器并读取真实DPI，不修改系统设置。实际命令、收据与未完成项见R08 evidence/receipts.md。

R01 token/布局可独立回退；R03协议生成物成套；R04迁移前备份、未完成批次保留回执；R05/R07取消不撤销已应用；R06取消保存不生成成功。代码回退不等于书签恢复。

规划阶段记录见 planning-validation.md；实施实时状态见 execution-status.md，各项真实测试记录在对应子任务 evidence/receipts.md，原型不等于功能交付。

2026-10-13 最终集成结论：R01–R08按用户调整后的范围完成；真实睡眠AC6为WAIVED/NOT_RUN。独立检查确认无其他阻塞，父任务仅标完成，不start、不提交、不归档、不发布或安装。
