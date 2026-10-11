# 01 基础实现检查收据

日期：2026-10-10，America/New_York。检查区间约 23:21–23:32 -04:00。代码状态：main 工作树未提交；新建基础 workspace、桌面/扩展/协议、测试、CI 和 README。没有提交、归档、发布、日常安装或真实 Chrome 书签操作。

环境、批准记录、bootstrap 前置验收和原生 UI 工具失败见 [session-preflight.md](session-preflight.md)。原生进程启动及受控终止见 [native-process.md](native-process.md)。Node 26.7.0、pnpm 12.12.0、Rust/Cargo 1.99.0；Tauri 2.12.3、tauri-build 2.7.2。Chrome for Testing 156.0.8078.4，Playwright 1.64.0。浏览器使用 Playwright 的隔离临时上下文，没有使用日常 Chrome Profile。

原始命令输出及首次失败摘要保存在 [check-output.txt](check-output.txt)。完整临时运行输出在被忽略的 `runs/foundation/`，正式收据保留所需错误和重测结果。

独立 Trellis check 结果、原始 release 路径泄漏及修复后原生产物验证见 [check-review.md](check-review.md)。原检查区间之后补充的结果在该文件分别记录。

## 命令结果

| 检查 | 退出码 | 状态 | 证据 |
|---|---:|---|---|
| `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-01-foundation` | 0 | PASS | implement/check 清单引用有效；批准/start 由主会话记录 |
| `pnpm install` | 0 | PASS | 4 个 workspace、214 个包；生成 pnpm-lock.yaml |
| `cargo generate-lockfile` | 0 | PASS | 408 个 Rust 包；保持 Tauri 2，未采用搜索结果中的 3.0 alpha |
| `pnpm protocol:generate` | 0 | PASS | Rust serde/schemars 生成 draft 2020-12 schema，再生成 TS |
| `pnpm lint` 首次 / 重测 | 1 / 0 | PASS | 首次误扫 `.omp` harness；入口改为产品/测试/配置路径 |
| `pnpm typecheck` 首次 / 重测 | 1 / 0 | PASS | 首次缺失 jest-dom Vitest 类型；桌面 tsconfig 加载该类型 |
| `pnpm test` 首次 / 重测 | 1 / 0 | PASS | 首次 Ajv 拒绝未知 uint8 format；显式注册整数 0–255 校验，未关闭 strict |
| `pnpm test` 最终行为结果 | 0 | PASS | Vitest 12 项；Node 4 项，含原生扫描反例；无跳过项 |
| `pnpm build` | 0 | PASS | 桌面和 MV3 扩展生产构建、协议消费者类型检查、产物扫描 |
| `pnpm protocol:check` | 0 | PASS | 已跟踪生成结果无漂移 |
| `cargo fmt --all -- --check` | 0 | PASS | Rust 格式检查 |
| `cargo clippy --workspace --all-targets -- -D warnings` 首次 / 重测 | 101 / 0 | PASS | 首次缺少 icon.ico；添加所需 PNG/ICO 资源后通过 |
| `cargo test --workspace --locked` | 0 | PASS | 2 项 Rust 行为测试；其余测试目标为 0，未虚构原生测试 |
| `pnpm install --frozen-lockfile` | 0 | PASS | 根目录锁文件安装通过 |
| `pnpm --dir runs/foundation/clean-install install --frozen-lockfile` | 0 | PASS | 隔离目录首次没有 node_modules，仅复制根/3 包 manifests、workspace 配置和锁文件；从 store 重建 214 包 |
| `pnpm exec playwright install chromium` | 0 | PASS | 下载专用测试浏览器；不代表 Chrome 扩展已安装 |
| `pnpm test:e2e` | 0 | PASS | 2 项浏览器测试；1100×760 和 640×480；空态、只读、无动作按钮、键盘焦点、无水平溢出 |
| 托管 Windows CI | — | NOT_RUN | workflow 已创建，尚未提交或触发远程执行 |
| 原生打开/关闭两次、空态/尺寸/错误/退出交互 | — | UNVERIFIED | 原生 UI pipe 不可用；编译和浏览器截图不能替代 |
| 原生开发进程启动 | 受控终止 -1 | PASS | 编译后创建有标题窗口且 Responding；未验证页面和正常关闭，详见 native-process.md |
| `pnpm build:native` | 0 | PASS | release EXE 构建及 UTF-8/UTF-16 路径/秘密模式扫描；首次泄漏及修复见 check-review.md；不生成安装包 |
| Chrome 原生扩展加载/同步、外部同步、macOS/Linux | — | NOT_RUN | 不属于 01 的产物检查结论 |

首次 E2E 退出 0，但 `NO_COLOR` 和 Playwright 的 `FORCE_COLOR` 同时存在，Node 发出颜色环境提示。只在重测 shell 移除 `NO_COLOR`，重测退出 0 且无该提示；没有修改应用颜色策略或全局环境。

## Fixture 和反例

唯一 IPC fixture 为 `tests/fixtures/protocol/startup-state.json`：`{"protocolVersion":1,"state":"unpaired"}`，2 个字段，不包含身份、凭据、书签或路径。Rust 测试检查 fixture 往返及额外字段拒绝。Ajv 测试覆盖正常输入、null、缺字段、版本不兼容、未知状态、未知字段、字符串版本、负数、小数和超过 uint8 的版本。

`scripts/protocol.test.mjs` 在 OS 临时目录写入实际生成结果，先确认一致，再分别修改 TypeScript 和 schema。两种修改都触发与 CLI 相同的 `checkProtocol` 漂移检查并拒绝。测试 finally 清理自己创建的临时目录，未改写已跟踪生成文件。

桌面组件测试覆盖真实加载分支的成功和失败状态。失败状态显示固定提示，测试确认原始后台错误未呈现。该组件测试不代表原生 IPC 错误已人工验收。

MV3 manifest 和 main capability 测试检查权限边界。扩展没有 permissions、host_permissions、background、content_scripts 或 externally_connectable。主窗口 capability 仅匹配 main，无 remote 字段。生产产物扫描拒绝 source map、绝对 Windows 用户/文档路径、私钥头和常见密钥模式。模式扫描未证明任意形式的秘密均不存在；基础源码没有读取密钥或 `.env`。

## 浏览器截图

- [1100×760 空态](browser-empty-1100x760.png)
- [640×480 空态](browser-empty-640x480.png)

两张截图均经读取查看。文字可读，空态没有伪造资料或尚未实现的操作按钮；最小高度可通过滚动访问底部说明。截图来自 Chromium 浏览器，不能用作 Tauri/WebView2 原生截图。

## 验收映射

| 标准 | 状态 | 范围 |
|---|---|---|
| AC01-1 | PASS | 依赖锁文件、隔离 JS 重建、build 和 Rust gates；非全新 Windows 机器验收 |
| AC01-2 | UNVERIFIED | 合法 MV3 生产产物通过；原生窗口打开/关闭及行为待验收 |
| AC01-3 | PASS | README 记录实际版本、Windows 前置条件、命令与证据边界 |
| AC01-4 | PASS | 生成漂移反例、Web 资产扫描及修复后的原生 release EXE 扫描通过；模式扫描边界见独立检查 |
| V01 本地自动检查 | PASS | 上表命令退出 0；首次失败及修复路径均保留 |
| 01 完成门槛 | UNVERIFIED | 独立 check 已执行；必要原生交互仍待验收，保持任务进行中，不启动 02 |

## 回退与后续

按当前 diff 只回退 01 新建的产品源码/配置和相应 `.gitignore` 增量；保留既有 Trellis、ref 和用户改动。没有真实数据库、凭据、浏览器写入或安装状态需要回滚。独立 Trellis check 已审核和修复已证实的产物问题，主会话记录原生进程与 UI 验收边界。
