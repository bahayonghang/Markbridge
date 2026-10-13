# 01 独立检查

日期：2026-10-10，America/New_York。检查对象为子任务 01 的未提交基础源码、配置、锁文件、README、CI、spec 和验收收据。只使用合成 fixture，没有真实 Chrome 操作、系统安装、提交、归档或发布。

## 已修复问题

原生 release 产物包含本机源码路径。`pnpm --filter @markbridge/desktop tauri build --no-bundle` 退出 0，输出 `target/release/markbridge-desktop.exe`。首次产物为 8,845,824 bytes，SHA256 为 `ef0a4954ee7f417192c479822adb7ac7ee5c169b27aa71f17c6a46b37a031738`。随后 Python 对 UTF-8/UTF-16 文本执行限定模式扫描，退出 1：

```text
utf-8:windows_user_or_documents_path=457
utf-8:workspace_path=0
utf-8:private_key_header=0
utf-8:known_api_key=0
utf-16-le:windows_user_or_documents_path=0
utf-16-le:workspace_path=0
utf-16-le:private_key_header=0
utf-16-le:known_api_key=0
```

`workspace_path=0` 只对应当时完整路径的字面匹配，不能解释为所有 workspace 路径均不存在。命中来源确认包含 Cargo registry 和 Rustup 标准库源码位置。只检查路径类别，没有读取凭据。

新增 `scripts/native-build.mjs` 和 `pnpm build:native`。命令使用稳定 rustc 的 `--remap-path-prefix`，按当前 workspace、Cargo、Rustup 和用户目录动态生成映射；参数只放入该构建进程的 `CARGO_ENCODED_RUSTFLAGS`。构建调用 `tauri build --no-bundle -- --locked`，随后扫描 release EXE 的 UTF-8/UTF-16 Windows 绝对路径、私钥头和常见 API-key 模式，并输出 bytes 和 SHA256。Windows CI 已增加同一入口。原有 `pnpm build` 保持 Web 构建语义。README 和子执行计划已同步。

路径映射首次重测退出 0，产物 8,845,312 bytes，SHA256 `63c1f7aa33fcd6e38bb2e6175534aa28fd7e0b0cb7ce6a0e347e2bc100122121`。补充 `--locked` 后构建退出 0，耗时 23.34s，输出为：

```text
Native release artifact: PASS; 8845312 bytes; SHA256 f39e2b9d50427885c6b09615d53655071ba94d34437e744d5eeba18172f3a273.
```

该产物的 UTF-8/UTF-16 Windows 绝对路径、私钥头和常见 API-key 模式均未命中。该检查只证明限定模式不存在，不是任意秘密内容的完备证明；基础源码未读取密钥或环境文件。各次构建分别记录 hash，没有声称二进制可逐字节重复构建。没有运行或安装 release 应用。

后续检查确认相对 `CARGO_TARGET_DIR` 的产物定位问题。环境变量值为 `runs/relative-native-target` 时，在 workspace 根目录与 `apps/desktop/src-tauri` 分别运行 `cargo metadata --no-deps --format-version 1`，两次均退出 0，但 `target_directory` 分别位于根目录与 src-tauri 下。原脚本构建子进程继承相对值，扫描器以 workspace 根目录解析，可能读取不同目录中的旧产物。

修复只增加一个绝对 `targetDirectory`：相对输入以 workspace 根目录为基准，构建子进程的 `CARGO_TARGET_DIR` 和扫描器共用该值。README 已记录该基准。修复后以相对环境值 `CARGO_TARGET_DIR=target` 执行 `pnpm build:native`，退出 0，构建耗时 22.26s，产物位于 workspace 的 `target/release`。最终输出为：

```text
Native release artifact: PASS; 8845312 bytes; SHA256 5d07b834567111786eb31927c510378b1bae7baa04f1a667ece62c135ef33142.
```

该修复后 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `git diff --check` 均退出 0；测试仍为 Vitest 12 项、Node 4 项。未重复运行未受影响的浏览器或原生交互检查。

新增 `scripts/native-artifact.test.mjs`，检查两种编码下的合成路径与秘密反例，并确认映射后的相对构建位置可接受。首次新增正则触发 ESLint `no-control-regex`，lint 退出 1；改用 Unicode 控制字符类别后 lint 退出 0，没有禁用规则。

两处 frontend spec 的历史状态陈述与现有启动 effect/组件不一致，已报告主会话并由主会话修正。

## 检查结果

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm lint` | 0 | PASS，新增脚本后重测 |
| `pnpm typecheck` | 0 | PASS，新增入口后重测 |
| `pnpm test` | 0 | PASS，Vitest 12 项、Node 4 项；无跳过项 |
| `pnpm build` | 0 | PASS，桌面/扩展 Web 构建和资产扫描 |
| `pnpm protocol:check` | 0 | PASS |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS，Rust 2 项；其他目标 0 项 |
| `pnpm test:e2e` | 0 | PASS，1100×760 和 640×480 浏览器空态 2 项 |
| `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-01-foundation` | 0 | PASS，implement/check 各 11 项有效 |
| `git diff --check` | 0 | PASS |
| `pnpm build:native` 修复后 | 0 | PASS，最终 locked release EXE 构建和扫描 |

另有一次辅助版本读取命令因 PowerShell 双引号中的 `${}` 导致 ParserError，退出 1，没有执行该批命令；改用 `rg` 读取 Cargo.lock 后退出 0。该失败不属于产品代码错误。

生成漂移测试使用实际 Rust exporter，在临时目录分别修改 TypeScript 与 schema，并调用 CLI 共用的 `checkProtocol`；两个反例均拒绝。不存在恒真测试入口。startup IPC 先检查 main 标签，前端通过 Ajv 严格校验 unknown DTO；组件只显示固定安全错误。扩展无权限、worker、浏览器读写或网络功能。源码未实现配对、数据库或 AI。

## 未解决项

AC01-2 的原生画面、IPC 返回、窗口尺寸、错误展示和两次正常打开/关闭仍为 UNVERIFIED。主会话的进程响应结果不能替代这些验收。原生 UI pipe 失败见 `session-preflight.md`，受控终止见 `native-process.md`。托管 CI 为 NOT_RUN。

01 保持 in_progress。02 及后续子任务不得越过 01 的前置验收门槛。当前检查没有发现其他需改变模块边界或公共接口的问题。

回退按当前 diff 移除新增 native 构建/扫描脚本、对应 package/CI/文档增量；路径映射仅作用于构建子进程，不修改全局环境。保留首次失败 hash、计数和该检查记录。

## 后续依赖调整

2026-10-10 用户明确批准先实施 02。该批准仅调整 01→02 启动门槛，不改变上述原生验收结论。01 仍为 UNVERIFIED，Windows 交付前须补齐。02 当前启动记录见 [02 前置记录](../../10-10-mb-02-identity-storage-protocol/evidence/session-preflight.md)。
