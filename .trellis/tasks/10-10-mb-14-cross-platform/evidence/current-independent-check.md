# 14 独立源码与检查复核

日期：2026-10-13。复核在 Windows 主机执行；本报告不证明 macOS/Linux 分支的目标类型检查、链接、原生运行或 V17 验收。

## 当前结论

已完成冻结源码独立复核、全部受影响 Windows 自动检查及新二进制 Windows 预览必要回归，没有剩余具体源码阻塞。独立批准该可执行工作 checkpoint 后，主会话可清除 14 指针并继续既有独立的 15；14 本身仍未完成。13 的当前 Windows 启动例外已由独立复核批准；13/M4 的完整验收仍未完成。14 的全部 macOS/Linux 原生标准保持 NOT_RUN，真实 OS 睡眠沿用 WAIVED、实际 NOT_RUN。

## 已发现并协调修复

- `export.rs`：锁定 objc2-app-kit 0.3.2 的 NSSavePanel 类覆盖将 `setTitle` 参数定义为 `Option<&NSString>`，原分支传入 `&NSString`。实现者已改为 `Some(...)`；这是缓存 SDK 签名核查，Windows 编译不检查该分支。
- `preview.rs`：macOS 导航观察器原超时判断没有 Loading 条件，成功 Ready 页面在 30 秒后也会变 Failed。实现者加入当前 Loading、generation/Profile/request/sequence 与截止时间检查，回归覆盖未完成 29/30 秒、已完成 Ready 60 秒、较新请求与关闭窗口。
- `main.rs`：普通非 Windows 启动显式创建 main 后，共享测试仍要求自动创建。主会话已要求按平台断言，同时保持普通 Windows 配置和除 create 外的字段。
- `preview.rs`：Linux 原清理流程会创建旧目录的保留 WebContext，或在清理后留下新旧两目录冲突。实现者改为在创建原生 context 之前原子迁移已关闭的旧目录，只清理 v1；新旧同时存在或旧 context 已被保留时拒绝并保留内容，不删除保留 context 下的文件。
- `preview.rs` 测试：复核者添加规范化系统临时父目录的独占 fixture helper，避免 macOS `/var` 等系统别名被生产链接守卫拒绝；根/目标/旧目录/嵌套/兄弟链接反例保持不变。旧 PID 命名手动目录改用独占 TempDir；生产守卫未放宽。
- `.github/workflows/ci.yml`：复核确认新 macos-14 标签即将退役。经主会话批准，实现者换为 macos-15 arm64 构建 runner，保留产品最低版本 14.0、实际架构断言及 macOS 14 原生 NOT_RUN。

## 已核查边界

凭据分支保留 Windows target 编码；Keychain/Secret Service 使用 service/account，无明文或 mock 降级。远程 preview 无应用 IPC；主窗口与 Profile 会话由独立目录或稳定原生 store ID 分隔。原生对象在 UI 线程访问，GTK 注册表只保存 SendWeakRef，原生清理等待回调完成；有界超时不宣称 SessionCleared。Linux 旧目录先迁移再创建 context，只对 v1 等待原生清理完成。

构建脚本明确限制运行平台/架构及 Rust host，显式传入 target 并定位相同 target release 目录。扫描 PE/ELF/Mach-O 中的实际程序，检查真实源/缓存路径与秘密反例。打包选择当前版本及确切架构文件名；包内程序必须与打包后的 release 字节一致。临时提取根有同进程所有权、规范路径与标记校验；子链接不被递归遍历，DMG 只读挂载并在清理前正常 detach，DEB 只取唯一普通程序成员，AppImage 仅使用受控提取模式。纯 fixture 不代表目标平台提取已执行。

安全存储错误提示只显示固定文本；未知错误详情和密钥不显示，保存失败保留旧配置并允许重试。独立查看 640×480 的 AI 与连接修改后截图，提示和键盘焦点可见，维持蓝色、白色简洁界面。既有浏览器 fixture 后测日志为 6 PASS，不代表原生安全服务拒绝或锁定测试。

## 未修复或待确认

- 缺少 macOS 14+ arm64、Ubuntu 24.04 x64 完整原生环境。目标编译、桌面、Chrome、存储、实际包及安装/回滚、托管 CI 均 NOT_RUN；无可用环境时无法完成 AC14-1/2/3。
- 托管 CI 仍未运行；新 runner 标签和实际架构检查不证明构建通过。macos-14 维护修复依据 [GitHub 官方 2026-10-01 公告](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/)，退役日期为 2026-11-02。

## 最终验证

Windows 使用实际已安装 Scoop `pnpm.exe` 12.12.0、Node 26.7.0，依序执行以下命令，全部退出 0；没有并行 native launch、Cargo build 或目标平台测试。

| 检查 | 结果 | 独立日志 |
| --- | --- | --- |
| pnpm lint | PASS | [lint](current-independent-lint.log) |
| pnpm typecheck | PASS | [typecheck](current-independent-typecheck.log) |
| pnpm test | 188 Vitest、20 Node PASS，其中 native artifact 15 个 | [test](current-independent-test.log) |
| pnpm build | PASS，产物权限/路径/秘密检查通过 | [build](current-independent-build.log) |
| cargo fmt --all -- --check | PASS | [fmt](current-independent-rust-fmt.log) |
| cargo clippy --workspace --all-targets --locked -- -D warnings | PASS | [clippy](current-independent-rust-clippy.log) |
| cargo test --workspace --locked | core119 + desktop34 + protocol14 = 167 PASS；3 个既有 ignore | [Rust tests](current-independent-rust-test.log) |
| pnpm protocol:check | PASS，无生成漂移 | [protocol](current-independent-protocol-check.log) |
| 受影响安全提示浏览器 fixture | 主会话修改后 6 PASS，已独立读日志/查看上述两图 | [UI](current-ui-after.log) |
| git diff --check | PASS，仅既有 LF→CRLF 提示 | 复核命令实际退出 0 |

初次命令误用 `pnpm.cmd`，它解析到 Codex fallback 11.25.0，因仓库引擎要求 12.12.0 而在 lint 执行前失败。保留 [初次工具失败](current-independent-lint-first-tool.log)，校验正确 pnpm/Node 后重试通过；没有用安装依赖来绕过版本要求。构建保留既有超过 500 kB chunk 提示，不将其当原生性能通过。

冻结的源码与脚本完整 hash 列表在 [source hashes](current-independent-source-hashes.json)，九份本地 gate 日志的字节/hash 在 [log hashes](current-independent-log-hashes.json)。关键源码：main `ddafad588123957d03bd8bdf16cf4d15ae8f93fc8b7bb474badbc03285a49df3`，preview `f2ba81e34dcc1960859306bb9fe5aa3cfc3dc18acdec90357232f271a60b764e`，export `70dd9161b77c9ef82baba514b3c9c4b465f2b1aea2ea8cacd8325d4ad8abcb9b`，Cargo.lock `1b6a002ab38eec147b8b5152e1ce023b02e61e166019b8230dfdd63e790f6530`。

上述结果不能证明被 Windows cfg 排除的原生平台分支通过目标类型检查、链接或运行。macOS/Linux V17、托管 CI、实际目标包及安装仍 NOT_RUN；AC14-1/2/3 和任务完成状态不得据此勾选。

## 当前 Windows 原生必要回归

主会话构建实际 Windows `x86_64-pc-windows-msvc` release 成功；复核者重新读取并运行静态扫描，实际程序为 24,214,016 字节，SHA256 `2c31f83c9124aa61a2b9651320663a423bba5b52b9a173aa238d7e73e587068c`。与主会话原生收据中的 copied exe hash 一致。

独立读取 [f81cc8f7 原始收据](../../10-10-mb-13-windows-acceptance/evidence/current-preview-persistence-f81cc8f7-36f8-4120-83fd-f4c3fe4c450a-receipt.json)，实际 PASS、errors 空；完整收据 SHA256 `cf00c73086af8d944af427a20ae4bcfa059197d78e757726a9eaecd9d0e981e0`。66 字符生产长度的合成 Profile、五次打开/关闭和六次不同 page UUID 绑定的观察，证明本 fixture 中 A 立即重开、经过 B 再开及受控旧目录迁移后，均恢复 A 的 persistent cookie/localStorage；B 保持自己的值，所有 main canary 均为 null。五次实际 OS 记录精确 main/对应 v1 目录与 EBWebView 子目录，目录存在且属于应用 PID 153068。

正常 main exitCode 0、signal null；六个已观察 WebView 的原 PID+完整 UTC creation ticks 均 absent，没有靠复用 PID 推断原进程状态。最终 fixture processes/listeners 均空，无强杀或寿命观察器。对应 [独立断言](current-independent-native-assertions.log) 实际退出 0。

该 probe 的 installation、Chrome、model 均明确 NOT_RUN；这不是当前 14 安装包验收，也不证明 macOS/Linux 原生 store。当前 Windows package 尚未构建，后续 15 最终源集成后的正式打包/隔离安装需新 hash 和实际完整收据。历史 13 `4f/269c` 安装证据不可替代后续二进制验收。
