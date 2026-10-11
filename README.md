# Markbridge（签桥）

本地优先的 Tauri 2 书签工作台。当前源码包含子任务 01 工程基础和子任务 02 的共享协议、身份隔离与 SQLite 存储模块。02 的本地模块验收已通过，见 [02 收据](.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/receipts.md)。桌面保持空态，尚未接入数据库。配对、同步、编辑、预览和 AI 尚未实现。应用不读取或修改 Chrome 书签，不创建桥接监听端口。

## 开发环境

首版原生验收目标为 Windows 11 x64。macOS/Linux 尚未验收。当前核对环境：Windows 11 x64、Node 26.7.0、pnpm 12.12.0、Rust/Cargo 1.99.0、Visual Studio 18 Enterprise、WebView2 154.0.4258.62。MSVC 工具链已用于 Rust workspace 构建。构建和浏览器检查的实际结果见[子任务收据](.trellis/tasks/10-10-mb-01-foundation/evidence/receipts.md)。

Windows 需要 Rust 的 `x86_64-pc-windows-msvc` 工具链、Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载、Windows SDK 和 Microsoft Edge WebView2 Runtime。已有工具版本不代表原生交互已经通过验收。缺失系统组件由用户安装；项目脚本不安装系统组件。参见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。

`package.json` 固定 JS 直接依赖，`pnpm-lock.yaml` 固定传递依赖。`Cargo.lock` 固定 Rust 解析结果。当前关键版本：

| 依赖 | 版本 |
|---|---|
| Tauri Rust / JS API / CLI / tauri-build | 2.12.3 / 2.12.3 / 2.12.2 / 2.7.2 |
| React / React DOM | 19.3.0 |
| TypeScript | 5.9.3，符合 typescript-eslint 的 `<6.1.0` 范围 |
| Vite / React plugin | 8.3.4 / 6.1.2 |
| serde / serde_json / schemars | 1.0.229 / 1.0.152 / 1.2.2 |
| Ajv / json-schema-to-typescript | 8.20.0 / 16.0.0 |
| rusqlite / libsqlite3-sys / tokio | 0.40.2 / 0.38.2 / 1.53.2；SQLite bundled |
| tempfile（Rust 测试） | 3.27.0 |
| Vitest / Playwright | 5.0.3 / 1.64.0 |

pnpm 12 的首次解析为 Tauri API/CLI 2.12.x 的精确版本添加了 `minimumReleaseAgeExclude`；名单保存在 `pnpm-workspace.yaml`。没有关闭全局供应链检查。

## 重建与启动

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @markbridge/desktop tauri dev
```

开发服务器仅绑定 `127.0.0.1:1420`。开发服务器提供前端资源，未实现扩展桥接服务。浏览器预览入口为 `pnpm --filter @markbridge/desktop dev`，预览采用未配对状态，不代表原生 IPC 已验收。

扩展构建位于 `apps/extension/dist`，只包含 MV3 弹窗，不申请浏览器或网络权限，不包含 service worker。基础检查只核对构建产物和 manifest。后续 Chrome 实验使用单独的临时 Profile，不加载到日常 Profile。

桌面基础配置只有 `main` capability，无 remote capability。`get_startup_state` 再次核对调用窗口标签。生产 CSP 禁止 frame；完整网页预览留给子任务 09。子任务 01 禁用安装包生成，`tauri build` 仅构建可执行文件。安装包及隔离安装验收归子任务 13。

Windows release 验证使用 `pnpm build:native`。该命令以当前 workspace、Cargo、Rustup 和用户目录生成临时编译路径映射，使用 `--locked` 构建 `target/release/markbridge-desktop.exe`，随后扫描可执行文件。不生成安装包，不安装或运行应用；自定义 `CARGO_TARGET_DIR` 时，相对路径以 workspace 根目录为基准，构建子进程和扫描器共用同一绝对目录。直接运行 Tauri build 不经过该路径映射和扫描入口，产物不满足该 release 验证合同。

## 验证命令

| 命令 | 检查范围 |
|---|---|
| `pnpm lint` | 产品 TS/JS、测试和工具配置，ESLint 不修改文件 |
| `pnpm typecheck` | 桌面、扩展、协议和测试工具的严格类型检查 |
| `pnpm test` | Vitest 启动/协议行为与双语言互通；Node manifest、capability、生成漂移和原生产物扫描反例 |
| `pnpm build` | 前端和扩展生产构建，协议消费者检查，产物扫描 |
| `pnpm build:native` | Windows release 可执行文件构建、编译路径映射、UTF-8/UTF-16 产物扫描；不生成安装包 |
| `pnpm protocol:generate` | Rust serde/schemars → JSON Schema → TypeScript |
| `pnpm protocol:check` | 在内存重新生成并比较已跟踪 schema/类型；漂移退出非零 |
| `pnpm test:e2e` | Playwright 浏览器空态、键盘焦点和窗口尺寸；没有原生 Tauri 或已安装扩展断言 |
| `cargo fmt --all -- --check` | Rust 格式 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust workspace lint |
| `cargo test --workspace --locked` | Rust 协议边界、存储隔离与恢复、未配对启动 |
| `pnpm --filter @markbridge/desktop tauri dev` | 原生开发窗口，需人工验收 |

首次浏览器测试需先运行 `pnpm exec playwright install chromium`，下载 Playwright 的专用测试浏览器。浏览器数据不使用日常 Chrome Profile。

Web 生产资产扫描拒绝 sourcemap、绝对 Windows 用户/文档路径、私钥头及常见密钥模式。`build:native` 对 release 可执行文件分别扫描 UTF-8 和 UTF-16 的 Windows 绝对路径、私钥头及常见密钥模式。模式扫描只能证明所列模式未出现。源码不读取凭据或 `.env`，不添加遥测。不要把凭据放入前端环境变量或扩展资源。

生成源为 `crates/protocol/src/lib.rs` 和 `wire.rs`，输出在 `packages/protocol/src/generated/`。StartupState 只描述 `protocolVersion: 1` 和 `state: unpaired`；WireMessage 定义共享传输合同。运行时通过严格 Ajv 和语义校验处理未知输入，组件不直接断言 IPC 返回类型。解析成功只证明数据符合合同，03 仍须验证实际配对身份、Origin 和凭据。

## 证据边界

本地命令、jsdom、浏览器 E2E、Windows 原生交互、Chrome 扩展加载和托管 CI 分别记录。编译通过不能代替原生打开/关闭两次、窗口尺寸、空态、错误展示和退出验收。未执行项目保持 `NOT_RUN` 或 `UNVERIFIED`。没有发布、日常安装、真实书签试验或跨设备同步证据。

02 存储模块位于 `crates/core/src/storage`，由单工作线程通过有限队列和异步回复串行访问 SQLite，启用 WAL 和外键。全树缓存与来源游标在同事务更新；本地 metadata 以独立 bookmarkId 关联。测试只创建临时数据库。升级先生成一致性备份，失败保留旧库；旧版本拒绝读取更高 schema，不通过删除数据库恢复。02 没有 GUI 数据库入口，未创建日常用户数据库。

源码回退应保留 Trellis、`ref/`、既有文件和用户数据。已有数据库须使用兼容版本或验证后的迁移前备份恢复；代码回退不能降级数据库 schema。没有浏览器变更需要撤销。不要用递归清理命令代替按当前 diff 审核回退。
