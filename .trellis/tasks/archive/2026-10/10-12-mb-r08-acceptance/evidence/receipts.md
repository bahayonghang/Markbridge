# R08 集成验收记录

> 2026-10-13 提交前另补条件撤销安全修复及新产物定向原生回归。本文下方保留改版验收当时的结果，804d 产物已是修复前历史；当前结论和分层证据复用范围见 [precommit-closeout.md](precommit-closeout.md)。

2026-10-13。R01–R07 均已通过各自 AC，R08 是唯一活动子任务。**AC1–5 已通过；AC6 按用户最新指令 WAIVED（豁免），实际 NOT_RUN。** 用户明确“这一条不用管，使用的时候也不会睡眠”，取代先前延期要求，真实睡眠不再阻塞本轮 R08 与改版父任务完成。旧 V04 仍 UNVERIFIED，未改写为 PASS。授权见父 gate-change-2026-10-13.md。

## 环境与隔离

Windows 11 Pro 10.0.26300；Core Ultra 9 275HX，24 逻辑 CPU，68,143,853,568 bytes RAM；Chrome 155.0.8059.39；WebView2 155.0.4283.45；Node 26.7.0。

最终桌面 exe SHA256：`804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910`，24,054,272 bytes。扩展：`567f50146319a2b6f013f773308910f29bc56585a62075dbaf0f9b3cf1ff22c5`。与 R07 最终构建一致；本项只增加指南、浏览器组合回归、测试 fixture 和验收脚本，没有修改产品源码。

所有原生脚本创建 `markbridge-r08-native-*` 直接临时目录，仅控制自己启动的应用和 Chrome PID。应用、main WebView、预览、Chrome 和凭据均隔离；沿用产品允许的 `Markbridge.Task06.r08-*` 测试命名空间。未读取或改动日常 Chrome Profile、书签、已安装扩展或系统显示设置。正常退出报告均核对临时凭据清除。SQLite 仅读取观测，写入仍由 Rust 完成。

## 本次自动与独立检查

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm lint` / `pnpm typecheck` | PASS，exit 0 | `check-lint-final.log` / `check-typecheck-final.log` |
| `pnpm test` | 178 Vitest + 6 脚本 PASS，exit 0 | `check-tests.log` |
| `pnpm test:e2e` | 60 PASS，exit 0 | `check-e2e.log`，截图仅写本项 `screenshots/check-full/` |
| 新组合用例重复运行 | 两个用例各 3 次，6 PASS | `implement-browser-settled.log` |
| 受影响接入/详情/历史/组合回归 | 21 PASS | `implement-browser-regression.log` |
| Rust / fmt / clippy / protocol / native build scan | 沿用 R07 冻结源码的 PASS：Rust 146 + 3 既有 ignored | R07 `evidence/check-report.md` 及原始日志；本项没有重复执行，不能称为新运行 |
| 独立检查 | 自动检查、真实 JSON/hash/截图及指南核对通过；睡眠按用户豁免另记 | 本项 `check-report.md` |

主会话和独立检查均保留用户脚本：`foundation.test.mjs` = `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`；`tauri-dev.mjs` = `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`。

## 当前产物的真实原生闭环

命令均从仓库根执行，脚本目录为 `.trellis/tasks/archive/2026-10/10-12-mb-r08-acceptance/evidence/`。

| 命令 | 结果与观察 | 最终 JSON |
|---|---|---|
| `node …/native-daily.mjs` | exit 0，7 PASS；两临时 Chrome 相同 chromeId 的两份备注分别从 Rust 回读；搜索/进入目录/取消新建零写/确认新建/修改/文件夹；多选标签与路径选择移动；真实回执、历史条件撤销；Win 保存 HTML/JSON 并解析；实际独立网页；离线备注、应用重启/重连、零操作回放 | `native-daily-c4d33b1e.json` |
| `node …/native-performance.mjs final` | exit 0，PASS；固定 seed 20261010，10,000 书签、1,000 文件夹、深度 20、11,004 节点；3 次冷启动 732.3387 / 700.8287 / 705.6480 ms；单独暖身 1 次后测 30 次，p50 84.6 / p95 129.2 / max 158.3 ms | `native-performance-final-1a3d7a21.json` |
| `node …/native-live.mjs` | exit 0，100 样本 PASS；真实 Chrome B10K 上 create/update/move/delete 各 25 次；每次 live；事件时间到匹配查询完成且下一帧仍满足条件，p50 34 / p95 82 / max 88 ms；最终完整树与缓存按 ID/父级/顺序/标题/URL 相等 | `native-live-e5a17113.json` |
| `node …/native-system.mjs display` | exit 0，PASS；同一自有窗口在三个实际显示器间切换，Win32 DPI 144→120→144，WebView 比例 1.5→1.25→1.5；实际 150% 下五尺寸通过，无横向溢出 | `native-system-display-69aebea8.json` |
| `node …/native-system.mjs probe` | exit 0，PROBE_PASS；本轮 Kernel-Power 事件可读、SQLite cursor 只读可用；真实断连触发 bridge-state 正控，非 live 新建禁用、预览 writable=false、实际 apply 返回 READ_ONLY；重连树一致且无 operation | `native-system-probe-52c7576b.json` |
| `node …/native-system.mjs sleep` | 实际 NOT_RUN；本轮门槛由用户豁免，预检不等于睡眠通过 | AC-R08-6 WAIVED；原始 NOT_RUN 收据保留 |

冷启动从实际 spawn 到缓存树、来源和搜索框可操作；暖搜索从 input event 前计时到匹配行渲染并进入下一帧。V03 使用同一主机时钟，在 Chrome 实际事件 listener 取起点，不把调用返回当成 UI 已完成。完整原始样本、版本与数据形状见 JSON。

daily 的撤销比较保留 ID、标题、URL、子树拓扑及顺序。Chrome 的易变 dateGroupModified 不在语义等价合同内；报告同时记录 `undoRestoredSemanticTree:true` 和 `undoRawTreeEqual:false`，没有隐藏差异。HTML 通过 DOMParser 解析并验证 Netscape 声明、文件夹和准确标题/URL；侧车 JSON 真正解析且包含本地标签与备注。

R07 在同一个冻结 exe 上的 `native-web-e34f302e.json` 仍是独立预览权限证据：11 控制 PASS，68 条注册命令均被远程页面拒绝。本项 daily 重验实际打开/关闭窗口，没有冒充重新运行全部权限矩阵。

## AC 与父门槛映射

| AC | 状态 | 依据 |
|---|---|---|
| AC-R08-1 | PASS | daily c4d33b1e 完整真实 UI 闭环，内部编号只用于断言，没有让用户输入 ID |
| AC-R08-2 | PASS（休眠单列 AC6） | daily 双 Profile、离线备注与重启无回放；live 100 外部变更；R04 既有第40步故障/丢 ack/重启分项；本项同 binary non-live apply 拒绝 |
| AC-R08-3 | PASS | 完整 60 E2E 的键盘/长路径/加载/空/错误/只读/多选；daily 125% 五尺寸与 actual150 69aebea8 五尺寸、三个真实显示器；正常首屏书签优先 |
| AC-R08-4 | PASS | V03 e5a17113 与 V06 1a3d7a21；daily 实际保存和独立预览；同 exe R07 权限收据复用，未称新运行 |
| AC-R08-5 | PASS | 用户指南、implementation-report、check-report 和本收据区分 fixture/自动/构建/原生/外部项 |
| AC-R08-6 | WAIVED | 用户 2026-10-13 明确无需此项；实际 NOT_RUN，旧 V04 UNVERIFIED；本轮不再要求真实睡眠证据，不称测试通过 |

| 父门槛 | 当前证据与结论 |
|---|---|
| G01 | PASS：R01 对比度/焦点，R08 完整浏览器和实际 125%/150% 五尺寸 |
| G02 | PASS（调整后范围）：R02 接入/身份错误/吊销、R08 两 Profile 和重启/非 live 拒绝均通过；真实睡眠 WAIVED，实际未测 |
| G03 | PASS：R03 d23bba4d 的深20层/10001同目录/分页/选择 + R08 全套浏览器和 B10K 新运行 |
| G04 | PASS：R04 单条/保护/批量分项 + R08 日常真实创建修改移动撤销 |
| G05 | PASS：R04 四种第40步故障/备份失败与 R06 条件撤销分项；R08 全套自动回归、真实重启零回放；故障注入未在 R08 重跑 |
| G06 | PASS：R05 20A/B/离线/抓取/原生预览分项 + R08 双 Profile 真实本地数据和预览，R07 同 exe 68 命令拒绝 |
| G07 | PASS：R06 文件失败/取消/镜像/侧车恢复分项 + R08 实际解析导出及历史撤销 |
| G08 | PASS：R07 874dbc46/e34f302e 同 exe 整理、默认关闭、取消、过期与权限；R08 全套自动回归 |
| G09 | PASS：本项新 V03 100 样本与 V06 3 冷/30 暖达到门槛 |
| G10 | PASS（调整后范围）：指南/自动/新原生闭环完成；真实睡眠单独标 WAIVED，不冒充运行通过 |

U01–U10 对应详细分项和原始收据链接见 `implementation-report.md`。旧 13 的安装包 V15 不是改版新验收，本项未生成/发布/安装日常安装包。外部同步 V16 无环境仍 UNVERIFIED；真实模型质量 NOT_RUN；跨平台与全库导入恢复不在本项交付范围。

## 首次失败与重测

- 浏览器包缓存权限失败后按隔离流程提升运行；保存后草稿 effect 尚未稳定的 fixture 时序失败，测试等待真实保存完成及两帧后 6 次重复和 21 项回归通过，未削弱产品草稿保护。
- daily `802d7818` 主导航与面包屑同名定位；`1184b725` 详情保留标签页导致编辑器不可见；分别明确主导航、信息 tab 后重跑。`59d1a8d7` 把 Chrome 易变时间戳误作撤销语义的一部分，改为合同规定的树/顺序比较。上述原始 FAIL 都保留。
- 初步 daily `c392630f` 未真正解析 HTML、只回读 A 的备注；独立审查补强两份 Rust 备注回读和 HTML DOM 解析，最终 c4d33b1e 通过。
- live 早期两次脚本失败是未展开筛选和空结果时错误要求 listbox 存在。初次完整 `1771d96a` 的消失计时可能命中 query 暂时清空，因此不关闭 V03；修正为已加载 1/1 或 0/0、无正在读取且下一帧重核，最终 e5a17113 才作为时序验收。
- system probe `af3e413c` 选择器误命中来源下拉框 option；限定书签列表后 b5e54198 预检通过。独立复核再补真实事件正控/实际后端拒绝，最终 52c7576b 通过。
- system sleep `755cb1cf` 在人工睡眠前取消以升级观测器，结果 NOT_RUN；最终 `34833920` 等待期间没有本轮电源事件，用户未回复，结束等待并清理后同样 NOT_RUN。两者均不是睡眠失败或成功。

## 视觉检查与剩余步骤

主会话实际查看 `native-screenshots/c4d33b1e-daily-library-1440x900.png` 与 `69aebea8-actual150-640x480.png`；独立检查另看大/小窗口、加载/错误、批量审查、B10K 与跨屏。灰侧栏、白主区、蓝色焦点/选择一致，列表是首屏主体；小窗缩为图标导航并保持内部滚动。连接与 AI 设置已移入设置，详情按需展开。

睡眠观测脚本不会自行触发睡眠或改变显示设置。用户已明确无需此项，两个隔离观测均已关闭并清理，不再等待用户睡眠。保留脚本供未来另行要求时使用；其操作方法是重新运行 `node .trellis/tasks/archive/2026-10/10-12-mb-r08-acceptance/evidence/native-system.mjs sleep`，等 readyForManualSleep，再通过 Windows 电源菜单手动睡眠至少60秒后唤醒。观测器只读本次电源事件；恢复UI采样仅统计匹配wake时间之后的数据。若恢复太快而没有调度到非 live 界面帧，明确记 NOT_OBSERVED，并结合睡前当前 exe 的非 live 原生拒绝证据和 Rust 状态锁测试，不强迫产品延迟。新 session 的 live 必须在完整树持久化后出现。

AC6以WAIVED结案，不能勾选为测试通过。门槛变更文档已通过独立复核，2026-10-13完成R08及改版父任务；历史运行JSON保持原样。不提交、不归档、不发布、不安装到日常环境。
