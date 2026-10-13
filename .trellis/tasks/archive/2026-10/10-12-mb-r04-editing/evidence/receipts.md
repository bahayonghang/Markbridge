# R04 验证记录

2026-10-13 R03五项AC与最终原生通过后，本项按批准顺序start，implement/check manifests 11/12 validate通过。产品自动测试：NOT_RUN；浏览器功能：NOT_RUN；原生Chrome/Tauri：NOT_RUN。父级设计原型截图不能关闭本项AC。

后续逐项记录日期、版本与diff、平台、视口/缩放、命令、退出码、fixture、结果和证据路径，禁止真实书签/密钥进入日志。

前置为R03最终exe371afbe9、native-browse-d23bba4d / native-live-query-f1e15a18 / native-performance-final-647f28ce。旧V04真实休眠按用户授权仍留到R08完成前，不豁免本项批量安全验收。主线程维护本项native-*脚本，旧06会读日常路径/改注册表的harness不直接运行。

## 隔离驱动准备

- `node .trellis/tasks/archive/2026-10/10-12-mb-r04-editing/evidence/native-harness-smoke.mjs`退出0：`native-harness-smoke-9c33c2d3.json` PASS。使用R03 exe371afbe9，仅确认真实Tauri、临时Chrome155、配对和worker附加可用；临时凭据已移除、进程已关闭。**不是R04产品验收**。
- `native-driver.mjs`、`native-faults.mjs`、`native-batch.mjs`通过`node --check`。批次原生脚本等待R04最终构建，目前NOT_RUN。
- 隔离Chrome pipe启动器提取为本项`native-chrome.mjs`（允许managed样本选择既有临时stock Chromium二进制），限制用户数据目录必须位于本项新建临时根下；R02驱动和收据保持原样。新增`native-editing.mjs`与`native-managed.mjs`语法检查通过，产品运行仍NOT_RUN。

## 独立检查进行中

- 首轮只读审查发现后续step的整子树消息可能超16MiB而在部分执行后才失败；要求整批全部单步在第一次写入前完成编码/限额预检，异常路径显式冻结。由implement修复，最终验证待记录。
- 首轮只读审查发现稀疏同父删除的条件撤销位置可能使用初始snapshot位置而非逐步执行前位置，导致[A,B,C,D]删[A,C]再撤销顺序错误。原生normal已加入同父稀疏删除、整树语义/顺序与本地备注恢复核对。最终结果尚未运行。
- 首轮审查发现多根删除的累计后代可能超过既有1000-step撤销限额。实施决定：日常删除单次按去重完整子树≤1000，单条文件夹也不能绕过；超限预览/执行前拒绝并明确提示，不扩展分组撤销框架。最终边界回归待记录。
- 后续审查补充：后代数量≤1000仍可能因长标题/URL使完整逆向消息超过16MiB。要求删除/批量移动同时预检逆向帧的已知上限；实现方补Rust检查与边界回归，检查方负责历史回执恢复入口和路径选择器收起，避免并发编辑冲突。
- 浏览器首轮35/38：两条旧只读断言仍要求隐藏按钮，与R04保留草稿/禁用确认的新行为不符；另一本轮真实回归是多选工具条插入导致列表首击后位移、双击失效。检查方修成同高动作切换并保留路径信息，重测结果待记录。

## 核心与批量原生验收

2026-10-13，`pnpm build:native`退出0，日志`native-build-final.log`，exe SHA256 `f0de19a1e33cbec0e2a8ad3fc96c8092de47b737a6bc00248bb14c66e85c323a`，23,766,016字节。扩展dist合成SHA256 `7deb42c27dc23bca5e9277734d5d41a9c49d0c18d89e4b2475a703e3147b2040`。Windows 11 Pro 10.0.26300，Core Ultra 9 275HX/24线程/68,143,853,568字节RAM，Node26.7，Chrome155.0.8059.39，WebView2 155.0.4283.45，实际系统缩放125%。完整环境与隔离目录分别记录在JSON，不读取日常书签。

| 脚本参数 / 收据 | 结果与观察 |
|---|---|
| `native-batch.mjs normal` / `native-batch-normal-a1a1186d.json` | 退出0，7PASS。预览无写入、完整路径和父子去重；自身/后代/保护节点拒绝，普通书签栏可收纳；错误hash、跨Profile、旧revision拒绝；备份目录故障零Chrome写；串行移动与重复apply拒绝；稀疏同父删除后条件撤销恢复语义整树、兄弟顺序与本地备注。 |
| `native-batch.mjs disconnect_before` / `native-batch-disconnect_before-e89878be.json` | 退出0，4PASS。第40项前断连，39实际执行、1不确定、20未执行；刷新与重启均不续跑，历史可找回逐项回执。 |
| `native-batch.mjs drop_ack` / `native-batch-drop_ack-da048130.json` | 退出0，4PASS。第40项实际执行但回执丢失；离开详情后后台10秒停止，39确认/1不确定/20未执行。显式核对后40确认，重启不续跑。 |
| `native-batch.mjs pause_before` / `native-batch-pause_before-217145d7.json` | 退出0，4PASS。执行中取消只停后续：40实际执行、20未执行，状态partial/CANCELLED，不宣称撤销。 |
| `native-batch.mjs external_conflict` / `native-batch-external_conflict-15b530f1.json` | 退出0，4PASS。第40项后外部修改使下一项冲突：40执行、1冲突、19未执行，刷新/重启保持停止。 |
| `native-editing.mjs` / `native-editing-07e6687f.json` | 退出0，4PASS。真实UI空目录新建/分开的草稿/取消零写入、批量移动审查、1100×760及640×480、关闭详情换节点后从历史找回回执。此轮尚未含最后长路径修复。 |
| `native-managed.mjs` / `native-managed-c95bfa8a.json` | 退出0，8PASS。现有stock Chromium157.0.8100.0二进制，新临时Profile本地test policy；managed根/后代混选移动删除、目标均拒绝，整树不变，UI目标禁用。不修改主机策略或注册表。 |

managed首轮`native-managed-35f46678.json`退出1：普通对照条目已在目标书签栏，移动的普通前置先失败，未触达预期managed断言。修正合成对照条目放入普通子目录后重跑PASS；不是产品接受了managed写入。所有上述成功和失败运行均撤销临时配对凭据、关闭本次进程。

## 自动检查与最终UI复验

独立`check-report.md`记录：141 Vitest+6脚本、133 Rust（另3项明确ignore）、lint/typecheck/protocol/fmt/clippy/build通过；浏览器最后长路径版39PASS，五尺寸截图在`screenshots/`。首轮缓存权限、隔离凭据权限、过时断言和真实双击缺陷的失败均保留，不用最终PASS抹去。

`native-build-ui-final.log`为最后长路径浮层版，exe `c24d9b136004da59e6c6f0b815828d6f9372e1b6347778b38c4a224c14ef7df7`，核心/协议/扩展未改。`native-editing-8ee894c5.json`前4项PASS，但追加长路径测试忘记关闭窄窗详情而超时，补齐用户返回操作。随后`native-editing-b1f76136.json`与带尺寸诊断的`native-editing-3d5147b9.json`发现真实Windows横向滚动条使选择前后row Y从270.600006变为255.400009，约15.2px位移。浏览器headless没有这段滚动条占位；本项保持in_progress，修复与最终原生复验待补。


## 最终通过与AC映射

经典滚动条修复保留原目录栏的实际布局高度（visibility:hidden、aria-hidden、inert），选择栏覆盖在同一容器；不硬编码滚动条宽度。浏览器回归真实开启16px经典滚动条，修前红、修后五尺寸绿；最终39 E2E、141 Vitest、lint/typecheck/build PASS，见check报告与`check-*-scrollbar*.log`。稳定规则已同步frontend/state-management.md。

`pnpm build:native`退出0，`native-build-scrollbar-final.log`：最终exe SHA256 `9ac5157f3e53b960ef5e885ed6e9550b7012ebf433bafec95bd961921b3df780`。`node .trellis/tasks/archive/2026-10/10-12-mb-r04-editing/evidence/native-editing.mjs`退出0，`native-editing-ad0def29.json` **5/5 PASS**。Windows125%，1100×760及640×480；20层长中文路径在小窗可键盘滚动、Escape回焦，选择前后rowY同为270.600006，取消后也不移动。三个最终截图已实际查看：`native-screenshots/ad0def29-long-path-640.png`、`ad0def29-batch-review-1100.png`、`ad0def29-history-recovered-640.png`。临时凭据清理与进程关闭完成。

先前f0de19a1产物上的批量/故障/managed验收与最终9ac5157f UI产物分开记录。最后仅JSX/CSS及测试变更；`native-core-files-before-layout.json`记录215个核心/协议/扩展文件均早于核心capture，`native-core-files-after-layout.json`逐文件SHA256比较0变化，扩展dist hash也相同。因此保留已通过的核心故障收据，最后只重跑受影响UI，不冒称所有原生脚本运行在同一个hash。

| AC | 结论 | 证据 |
|---|---|---|
| AC-R04-1 | PASS | 最终native ad0def29空目录、分开创建草稿、取消零写；editing单元与浏览器创建回归。 |
| AC-R04-2 | PASS | normal a1a1186d自身/后代/根保护；managed c95bfa8a；路径选择/键盘Enter/拖放审查回归；最终20层原生路径。 |
| AC-R04-3 | PASS | normal a1a1186d与最终UI审查；父子去重、Profile/数量/路径/diff，后端预览绑定。 |
| AC-R04-4 | PASS | 四种第40项故障与重启回执恢复、备份失败零写；10秒后台超时；全正向及逆向帧预检、1000影响项边界；稀疏删除撤销恢复整树顺序/备注。 |
| AC-R04-5 | PASS | normal跨Profile/错误hash/重复apply/旧revision；deferred前端草稿/自写revision回归；pause_before取消只停剩余且重启不续跑。 |

所有R04门槛通过，允许顺序进入R05。旧真实系统休眠/系统150%仍按父计划留R08，不借本项PASS关闭。未提交、未归档、未发布、未安装到日常环境；两个用户自有脚本SHA256保持开工时值。
