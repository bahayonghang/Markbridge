# R01 验证记录

2026-10-13 用户批准后启动 R01。实施由 trellis-implement 子代理执行，主线程维护隔离原生证据，结束前进行独立 trellis-check。父级设计原型截图不能关闭本项 AC。

后续逐项记录日期、版本与diff、平台、视口/缩放、命令、退出码、fixture、结果和证据路径，禁止真实书签/密钥进入日志。

## 前置与首次检查

- 工作区原有 `scripts/foundation.test.mjs`、`scripts/tauri-dev.mjs` 改动保留；初始 SHA-256 见 `preexisting-hashes.json`。
- `cargo build -p markbridge-core --example seed_profile_cache --locked`：退出 0，11.47 秒。仅编译用于临时缓存的 Rust seeder。
- `pnpm protocol:check`：首次沙盒执行因 pnpm 引擎缓存锁访问权限失败；经工具审批在正常本机权限下重试退出 0，协议生成物一致。
- 实施代理首次类型检查发现现有 `apps/desktop/vite.config.ts` 导入 `scripts/dev-port.mjs` 缺少声明（TS7016）。主线程新增对应 `scripts/dev-port.d.mts`，未改变端口选择逻辑。最终重测另记。

## 隔离原生方法

`native-shell.mjs` 启动本次构建的 `target/release/markbridge-desktop.exe`，使用唯一临时 `MARKBRIDGE_APP_DATA`、凭据命名空间和 WebView2 数据目录。现有 Rust seeder 写入纯合成、无凭据的只读缓存。原生窗口由 `native-window.ps1` 按捕获 PID 调整实际客户区大小，WebView2 CDP 截取实际页面；不使用浏览器 viewport 模拟冒充原生缩放。只关闭本次启动的进程。

## 最终验收（2026-10-13）

实施与独立检查分别见 [implementation-report.md](implementation-report.md)、[check-report.md](check-report.md)。独立检查修复 checkbox 键盘冒泡与焦点被活动行抢走，并增加 history 模式断线确认回归。最终产品文件已重新构建。

| 检查 | 结果 / 证据 |
|---|---|
| 全量测试（独立检查前） | `pnpm test` 退出 0，104 Vitest + 6 Node；`test-verified.log` |
| 最终 lint / typecheck | 均退出 0；`check-lint-final.log`、`check-typecheck-final.log` |
| 独立检查后的相关回归 | 组件 38 PASS；新增历史用例后 library 17 PASS；最终 shell 12 PASS。命令与顺序见 check-report |
| 浏览器完整检查（独立检查前） | 17 PASS；`browser-final-17.log`；之后受修改影响的 shell 全部复测 |
| `pnpm build:native` 最终构建 | 退出 0，40.09 秒；`native-build-final.log`；产物扫描 PASS |
| 最终生产资源扫描 | `node scripts/check-artifacts.mjs` 退出 0 |
| `pnpm protocol:check` | 退出 0；协议无改动 |
| 差异与用户脚本保护 | `git diff --check` 退出 0；两个已有脚本 SHA-256 与初始记录一致 |
| 原生系统 125% | `node .trellis/tasks/archive/2026-10/10-12-mb-r01-shell/evidence/native-shell.mjs` 退出 0；[native-report.json](native-report.json)，五尺寸 PASS、无页面异常、正常关闭 |
| 原生进程 150% 补充 | 同一脚本，临时 `MARKBRIDGE_R01_SCALE=1.5`；退出 0；[native-report-150-runtime.json](native-report-150-runtime.json)，五尺寸 PASS，实测 DPR=1.5 |

原生环境为 Windows 11 Pro x64，10.0.26300，WebView2 Edg/154.0.4258.62，Node v26.7.0。最终 exe 23,039,488 bytes，SHA-256 `77832b3a18d1262e6e99b158cf3f0a7633895dfd6611a8d40245b857ab362b41`。系统显示缩放保持 125%；150% 仅通过 WebView2 独立进程参数覆盖，不能证明 Windows 显示设置切换和跨屏 DPI 事件。后者保留给 R08 原生集成，当前 UNVERIFIED，没有修改用户系统显示设置。

原生脚本使用真实 Tauri IPC 读取本轮合成缓存并执行搜索，检查只读状态、16px checkbox、五个实际客户区无文档溢出、640×480 详情返回焦点、整理/历史/设置导航、AI 默认关闭、返回后搜索与勾选保留。截图在 `native-screenshots/` 与 `native-screenshots-150-runtime/`；已人工查看 1100×760 列表、640×480 详情及 150% AI 设置。未连接 Chrome、未安装应用、未创建真实浏览器写入。临时目录保留在报告中供复查。

首次原生运行的限制分别记录在 `native-first-failure.json`、`native-second-failure.json`、`native-third-failure.json`：沙盒环境下 WebView2 target 空白、PowerShell 辅助脚本执行策略未传入、来源 select 的精确 label 匹配含 option 文本。调整测试运行环境、脚本进程级执行参数及选择器后通过。前两次遗留的本轮 PID 已核对启动时间和可执行路径后关闭；最终两次均正常关闭。`native-initial-pass.json` 为独立检查修复前的辅助运行，最终结论只使用上表最终 hash 的两份报告。

## AC 结论

- AC-R01-1：PASS。书签优先；配置迁入设置；四个工作区和原有历史/导出可达；导航状态保留。
- AC-R01-2：PASS。浏览器合成用例覆盖未接入、加载、错误、空库、只读；原生缓存真实呈现未连接只读。
- AC-R01-3：PASS。全部五尺寸浏览器与最终原生通过，分区滚动、替换视图返回及控件边界有断言和截图。
- AC-R01-4：PASS。控件尺寸、中文长标题、焦点、skip link、设置键盘标签、checkbox 独立键盘行为和 reduced-motion 通过。

R01 完成并保持未提交、未归档。R02 仍受旧 03/04 的 V04 真实 OS 休眠门槛约束，本项不替代该证据。
