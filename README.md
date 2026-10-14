# Markbridge（签桥）

本地优先的 Tauri 2 书签工作台，提供 Chrome 配对与实时镜像、离线只读、确认编辑与条件撤销、本地标签备注、内容与独立网页预览、历史导出、可选 AI 整理及库维护。Chrome 写入只经 MV3 扩展的 chrome.bookmarks；Rust 串行写入本机 SQLite。原 01–12 与新版工作台已完成；当前 13–15 及原父任务状态见 [实施状态](docs/implementation-status-2026-10-13.md) 和 [当前集成证据](.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md)。使用方法见 [操作指南](docs/user-guide.md)。

当前源码新增 macOS/Linux 适配和独立默认关闭的本地语义检索。平台原生验收、真实 embedding 模型及人工标注质量/性能证据仍缺失，不能声明支持或达标。语义检索只索引确认范围的标题与已保存摘要，SQLite 保存派生向量，Rust 有界精确排名；无 ANN 服务或后台全库抓取。功能与模型验收分层见 [任务 15 评测说明](.trellis/tasks/10-10-mb-15-semantic-search/evidence/evaluation.md)。

## 开发环境

首版原生验收目标为 Windows 11 x64、Chrome 134 及以上。macOS/Linux 尚未验收。当前已测环境：Windows 11 Pro build 26300、Chrome 155.0.8059.39、WebView2 155.0.4283.45；开发工具为 Node 26.7.0、pnpm 12.12.0、Rust/Cargo 1.99.0、Visual Studio 18 Enterprise。当前源码、构建、浏览器、原生与安装证据分别记录；没有主机或模型的验收保持未完成。

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

开发服务器只绑定 `127.0.0.1`。优先使用端口 1420；若该端口不可绑定，Vite 改用下一个候选端口。`just dev` 会把 Tauri 的 `devUrl` 设成同一个端口。浏览器预览入口为 `pnpm --filter @markbridge/desktop dev`，预览采用未配对状态，不代表原生 IPC 已验收。设置 `MARKBRIDGE_DEV_PORT` 时只尝试该端口。

扩展构建位于 `apps/extension/dist`，包含 MV3 service worker、配对设置与 Chrome 书签适配器。加载已解压扩展与配对步骤见操作指南。实验仅使用单独临时 Profile；日常 Profile 和已安装扩展不作为验收对象。

桌面可信 capability 只授予 `main`，命令再次校验调用窗口。生产 CSP 禁止 frame；完整网页在独立 `preview-*` WebviewWindow 中，不授予应用 IPC、密钥或文件权限。默认禁用自动 bundle，正式本地安装包与隔离验收使用下述入口。

原生 release 验证使用 `pnpm build:native`。该命令检查实际 Node 平台/架构和 Rust 工具链 host，并显式选择 Windows x64、macOS arm64 或 Linux x64 对应原生 target，避免继承的跨平台配置指向旧产物。以当前 workspace、Cargo、Rustup、target 和用户目录生成临时路径映射，使用 `--locked` 构建，再扫描 `<CARGO_TARGET_DIR>/<host-target>/release/markbridge-desktop[.exe]`。默认 target 根为 workspace 下的 `target`；相对自定义值也从 workspace 解析，构建和扫描共用同一绝对目录。不生成安装包，不安装或运行应用。直接运行裸 Tauri build 不经过该映射和扫描入口，不能替代此产物门槛。

`pnpm build:package` 先运行上述构建和扫描，再以同一 host、映射、`--no-sign`、`--no-binary-patching` 生成 Windows 当前用户 NSIS、macOS app/dmg 或 Linux deb/AppImage。检查实际包内程序的格式/架构和内容扫描；deb、NSIS、app 与 dmg 必须与打包后的 release 字节一致，AppImage 只允许动态链接元数据不同；Mac 使用只读 DMG 挂载，Linux 不执行 AppRun。Windows 提取需要 7-Zip，macOS 使用系统 plutil/hdiutil，Linux 使用 dpkg-deb/tar 及 AppImage 自身提取入口。脚本只构建和验证，不安装或发布；跟踪配置的 `bundle.active` 仍是 false。当前实际验收只有 Windows，macOS/Linux 入口和 CI 源码不能作为平台通过证据。平台前提和支持边界见 [原生平台指南](docs/native-platforms.md)。

## 验证命令

| 命令 | 检查范围 |
|---|---|
| `pnpm lint` | 产品 TS/JS、测试和工具配置，ESLint 不修改文件 |
| `pnpm typecheck` | 桌面、扩展、协议和测试工具的严格类型检查 |
| `pnpm test` | Vitest 启动/协议行为与双语言互通；Node manifest、capability、生成漂移和原生产物扫描反例 |
| `pnpm build` | 前端和扩展生产构建，协议消费者检查，产物扫描 |
| `pnpm build:native` | 当前原生 host 的 release 程序构建、格式/架构检查、路径映射及 UTF-8/UTF-16 扫描；不生成安装包 |
| `pnpm build:package` | 先执行 `build:native`，再生成当前 host 包并核对/扫描实际包内程序；不安装或发布 |
| `pnpm protocol:generate` | Rust serde/schemars → JSON Schema → TypeScript |
| `pnpm protocol:check` | 在内存重新生成并比较已跟踪 schema/类型；漂移退出非零 |
| `pnpm test:e2e` | Playwright 浏览器空态、键盘焦点和窗口尺寸；没有原生 Tauri 或已安装扩展断言 |
| `cargo fmt --all -- --check` | Rust 格式 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Rust workspace lint |
| `cargo test --workspace --locked` | Rust 协议边界、存储隔离与恢复、未配对启动 |
| `pnpm --filter @markbridge/desktop tauri dev` | 原生开发窗口，需人工验收 |

首次浏览器测试需先运行 `pnpm exec playwright install chromium`，下载 Playwright 的专用测试浏览器。浏览器数据不使用日常 Chrome Profile。

Web 生产资产扫描拒绝 sourcemap、绝对 Windows 用户/文档路径、私钥头及常见密钥模式。`build:native` 对实际 release 程序分别扫描 UTF-8/UTF-16 的 Windows 绝对路径、POSIX 用户路径、当前配置的真实构建前缀、私钥头及常见密钥模式，并验证 PE/ELF/Mach-O 与目标架构。模式扫描只能证明所列模式未出现。运行时密钥放在 OS 凭据存储，React 和扩展不接收密钥；不添加遥测。不要把凭据放入前端环境变量或扩展资源。

共享 DTO 在 `crates/protocol/src/` 定义，生成 schema、类型与运行时校验器到 `packages/protocol/src/generated/`。StartupState 描述初始入口，实际来源状态来自 Bridge 订阅；WireMessage 定义传输合同。严格 Ajv 与语义校验处理未知输入，组件消费已校验 DTO。配对身份、Origin 和凭据由 Rust 与扩展认证，不以显示名或载荷字段代替认证。

## 证据边界

本地命令、jsdom、浏览器 E2E、Windows 原生交互、Chrome 扩展加载和托管 CI 分别记录。编译通过不能代替原生打开/关闭两次、窗口尺寸、空态、错误展示和退出验收。未执行项目保持 `NOT_RUN` 或 `UNVERIFIED`。没有发布、日常安装、真实书签试验或跨设备同步证据。

存储模块位于 `crates/core/src/storage`，由单工作线程通过有限队列和异步回复串行访问 SQLite，启用 WAL 和外键。桌面启动接入本机数据库；全树缓存与来源游标在同事务更新，metadata 以独立 bookmarkId 关联。实验使用隔离数据根，main WebView 明确绑定其 main-webview，preview 使用各 Profile 独立会话；不得设置全局 WEBVIEW2_USER_DATA_FOLDER。升级先生成一致性备份，失败保留旧库；旧版本拒绝读取更高 schema，不通过删除数据库恢复。

卸载验收仅限已授权临时目录，核对实际安装程序、版本、退出与注册项恢复，并比较安装目录外的数据库和完整应用数据清单。当前各次原始失败、正常卸载和数据保留证据见 13 当前集成报告；部分控制通过不等于整个生命周期通过。安装包未签名、未发布，日常安装需要单独授权。

源码回退应保留 Trellis、`ref/`、既有文件和用户数据。已有数据库须使用兼容版本或验证后的迁移前备份恢复；代码回退不能降级数据库 schema。已确认的浏览器变更按历史回执与条件撤销处理，不能用文件改写或递归清理代替恢复。
