# 13 显式脱敏诊断导出：实施与检查

日期：2026-10-13。此记录只覆盖本轮新增诊断产品能力；Windows 安装、真实保存对话框和 V01–V16 集成由主会话另记。没有更改历史收据、验收状态或真实睡眠豁免。

## 结果与范围

`设置 → Chrome 连接 → 导出诊断 JSON` 由用户点击触发，未连接和首次接入也可使用，浏览器界面预览禁用。进入页面、重新渲染或导航不导出、不抓取、不发模型请求。

固定 v1 文件字段见 [设计](../design.md)：编译应用/协议/当前 schema 版本、平台/架构枚举、监听布尔值/稳定错误码、六种连接状态计数与三种文件状态计数。无 Profile/扩展/来源身份、名称、书签标题/URL/树、正文、标签、备注、摘要、路径、端口、时间、日志、模型配置或凭据。读取 Bridge 已发布状态，不调用有配对过期副作用的 `Bridge::state`，不查询书签/日志或网络。

Rust `save_diagnostics` 无输入，仅接受 trusted main 窗口；与书签导出共用 `SaveGuard`、系统保存位置、完整写入、sync 和原子替换。诊断默认文件 `markbridge-diagnostics.json`。IPC 仅 `status/errorCode`，没有文件正文和路径。取消不写入；写入失败保护已存在目标，清理本次临时文件；错误只显示固定说明。

产品文件：`crates/protocol/src/diagnostics.rs`、`crates/core/src/diagnostics.rs`、`apps/desktop/src-tauri/src/{main,export,preview}.rs`、`apps/desktop/src/backend.ts`、`features/settings/{DiagnosticExport,ConnectionSettings}.tsx`、`packages/protocol/src/diagnostics.ts` 与对应测试。Rust DTO 注册到 schema 导出器及 `scripts/protocol.mjs`，生成两组 schema、TS 和独立 Ajv 校验器。desktop 增加已有 workspace `serde_json` 依赖；Cargo.lock 只增加此依赖，没有升级版本。其他已有生成文件没有内容差异。

## 执行记录

工具实读：Node `v26.7.0`；pnpm `12.12.0`；Rust `1.99.0 (b940084d7 2026-09-28)`；Cargo `1.99.0 (5f94df478 2026-08-27)`。自动浏览器为 Playwright headless Chromium；窗口值由测试 `setViewportSize` 设置，不是原生 DPI 验收。

| 命令 / 检查 | 退出码 | 实际结果 |
| --- | --- | --- |
| 修改前 `pnpm exec playwright test tests/e2e/diagnostics.spec.ts --workers=1` | 0 | 当时的 baseline 测试 2 PASS：1440×900 / 640×480；测试文件随后替换为产品行为验收，没有用新源码重拍 before |
| `cargo check --offline -p markbridge-protocol` | 0 | 仅为 desktop 新依赖更新离线 lockfile，未下载 |
| `pnpm protocol:generate` | 0 | 完整生成诊断 DTO schema、TS 和 CSP 安全校验器 |
| `pnpm lint`（最终产品后独立执行） | 0 | 无 lint 警告 |
| `pnpm typecheck`（最终产品后独立执行） | 0 | protocol、desktop、extension 与 tools 通过 |
| `pnpm exec vitest run apps/desktop/src/features/settings/diagnostics.test.tsx apps/desktop/src/backend.test.tsx apps/desktop/src/App.test.tsx packages/protocol/src/diagnostics.test.ts` | 0 | 4 文件，31 测试 PASS |
| `cargo test -p markbridge-core diagnostics --locked` | 0 | 2 PASS，119 filtered；全部固定连接/文件状态、敏感 canary、额外字段拒绝、无监听/无来源路径 |
| `cargo test -p markbridge-desktop --locked` | 0 | 18 PASS；含取消/对话框错误/写入错误/重试、真实临时文件与锁定目标保护、main capability 和所有命令 guard |
| `pnpm protocol:check` | 0 | 当前 Rust 与全部已跟踪生成输出一致 |
| `cargo fmt --all -- --check` | 0 | 通过 |
| `pnpm exec playwright test tests/e2e/diagnostics.spec.ts tests/e2e/connection.spec.ts --workers=1` | 0 | 13 PASS（诊断 6，相邻连接 7） |
| 最终版 `pnpm exec playwright test tests/e2e/diagnostics.spec.ts --workers=1` | 0 | 6 PASS；五种窗口、Enter 触发、40px 控件、无页面溢出、取消/失败/拒绝/成功和重试 |
| `git -c core.safecrlf=false diff --check` | 0 | 通过（检查时也包含主会话与 harness 并行文件） |

首次失败保留：未经环境权限扩展的 pnpm baseline 命令退出 1，`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`，pnpm engine store 的 `all-stores.lock` 访问被拒；同一已授权测试使用环境权限后退出 0。首次协议生成退出 1，`--locked` 拒绝尚未纳入 lockfile 的 desktop serde_json 依赖；离线 Cargo 更新后同一生成命令退出 0。没有把上述失败记为通过，也没有绕过 drift 检查。

## UI 证据与视觉检查

沿用现有 `styles.css`，无新 CSS 策略/字体/图标。蓝色 `#1767d2` 选择与焦点、白色 `#ffffff` 主区、灰色 `#eceff4` 侧栏、`7px` 控件圆角和 Segoe UI/中文系统字体保持一致。单个无卡片区块复用 `connection-panel`、`panel-heading`、secondary 文案与 40px 按钮。仅按用户操作显示状态，没有新动画。最终标题使用与相邻区块相同的 17px 样式，压短说明以消除孤行。

执行时只为当次命令指定 `MARKBRIDGE_EVIDENCE_DIR`；每一轮独立目录，未覆盖旧任务或本轮首次截图：

- `diagnostics-before-20261013/`：修改前 1440×900、640×480。
- `diagnostics-after-20261013/`：第一版五窗口 + 重试截图，另有连接回归截图。
- `diagnostics-after-20261013-final/`：最终 1440×900、1100×760、640×760、1100×480、640×480 及重试截图。

实际打开并检查了修改前 1440×900、第一版 1440×900 / 640×480、最终 1440×900 / 640×480 PNG。标题、说明、焦点和状态不重叠；最小窗有可用滚动，按钮完整可见。其余三窗口由实际 browser E2E 检查并保存 PNG。所有行为通过页面导航、实际 DOM 按钮/键盘触发，IPC 返回由测试路由 mock，**不代表原生文件保存已通过**。

## 证据边界与后续

本记录的原生系统保存对话框、已安装 exe 的保存/取消、预览页拒绝新增命令为 NOT_RUN，交由当前安装验收 harness。Rust 真实临时文件单测不等于用户保存对话框；DOM mock 不等于 Tauri IPC。实际模型、Floccus、macOS/Linux 和 NSIS 结论不在此记录。未提交、归档、发布、签名或安装。本轮只读取 ui/frontend-design 技能，沿用成熟设置组件。
