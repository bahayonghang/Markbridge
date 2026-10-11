# 02 验收收据

日期：2026-10-11，America/New_York。恢复已批准的 02，工作树保留 01、02 及规划的既有未提交改动。检查使用合成协议数据和临时 SQLite；桌面尚未接入数据库。真实 Chrome、日常用户数据、凭据和安装环境未用于检查。

结论：AC02-1～4 和 V01 本地自动检查 PASS。V02 仅通过存储/协议部分，真实 Chrome 身份与认证留给 03。02 的实现和本地验收已完成；未获提交或归档授权，task.json 保留 in_progress，并单独记录验收结论。

平台：Microsoft Windows 11 专业版 10.0.26300，64-bit；Intel(R) Core(TM) Ultra 9 275HX，24 个逻辑处理器，内存 63.46 GiB。版本见 [启动记录](session-preflight.md)。代码基线为 main 的 `84d189f` 加当前未提交工作树；独立复核冻结 22 个协议、存储、fixture、生成和依赖文件的 SHA256，见 [源码清单](check-source-manifest.jsonl)。

## 首次失败

| 检查 | 结果 | 原始证据 |
|---|---|---|
| `cargo test -p markbridge-core -p markbridge-protocol --locked` | FAIL，退出 101 | `implement-rust-initial.log`；编译器报告 wire.rs 含 NUL，协议定义缺失 |
| 损坏源码取样 | FAIL | `wire-source-failure.json`；22,009 字节，非零字节 0，SHA256 `9F20FF1A40087F4B9DC00CE17AAA38F1A9887808D4279EEE913B5B9A889596CB` |
| 同期 protocol:check | UNVERIFIED | 返回 0，但未证明损坏源码可编译；恢复后须重新编译并检查 |

源码损坏原因未查明。实施子代理未找到可恢复的本地源码备份，已按现有 schema、生成类型、协议校验器、测试和已批准设计恢复 wire.rs。恢复后已重新编译并检查，四个生成文件逐字节一致。恢复期间的保护集合、额外字段、数值表示和 clippy 失败均保留，修复与重测对应关系见 [实现报告](implementation-report.md)。独立检查未发现需修复的源码问题，见 [复核报告](check-review.md)。

## 最终命令

独立检查的开始/结束时间和退出码见 [命令收据](check-gates.jsonl)。全部命令退出 0。

| 命令 | 结果 | 原始日志 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | [check-install.log](check-install.log) |
| `pnpm lint` | PASS | [check-lint.log](check-lint.log) |
| `pnpm typecheck` | PASS | [check-typecheck.log](check-typecheck.log) |
| `pnpm test` | PASS；Vitest 20、Node 4 | [check-test.log](check-test.log) |
| `pnpm build` | PASS；Web 资产扫描通过 | [check-build.log](check-build.log) |
| `pnpm protocol:check` | PASS；四个生成文件无漂移 | [check-protocol.log](check-protocol.log) |
| `cargo fmt --all -- --check` | PASS | [check-fmt.log](check-fmt.log) |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | [check-clippy.log](check-clippy.log) |
| `cargo test --workspace --locked` | PASS；core 11、protocol 9，共 20 | [check-rust-test.log](check-rust-test.log) |
| `pnpm build:native` | PASS；Windows release 构建与扫描 | [native-build.log](native-build.log) |

最终产物：`target/release/markbridge-desktop.exe`，8,848,896 bytes，SHA256 `23ae31e88e4b98f432db2d180d1b2cd3d1470da6f42fc5c10bd5a5c9ace364f0`。扫描该产物的 UTF-8/UTF-16LE Windows 绝对路径、私钥头和已配置密钥模式，结果通过。模式扫描只覆盖所列模式。没有生成安装包、安装或运行该产物。

## 验收映射

| 项目 | 状态 |
|---|---|
| AC02-1 Profile 与本地身份隔离 | PASS；合成双 Profile 同 ID、重复 URL、动态根属性、managed、epoch、独立 mirror 和 metadata |
| AC02-2 双语言协议与边界拒绝 | PASS；现场双向序列化、47 个共享样本、字段/树/帧/Unicode 边界、未知版本与 mutation 拒绝 |
| AC02-3 原子缓存替换和非法树保留旧状态 | PASS；保留 bookmarkId/metadata、tombstone、非法树拒绝、commit 前故障注入后重开验证缓存和 cursor |
| AC02-4 初始化、升级备份与失败恢复 | PASS；空库、含未 checkpoint WAL 的 v1 备份、migration 回滚、备份失败、高版本与非空未编号数据库拒绝并保留旧数据 |
| 独立 Trellis check | PASS；完整源码审查及正式自动检查，无产品源码修改 |
| 最终 Windows release 构建和扫描 | PASS；对应上述 hash |
| 真实 Chrome 身份与配对 | NOT_RUN，属于 03 |
| 01 原生空态、窗口尺寸、错误展示与正常关闭 | UNVERIFIED，Windows 交付前补齐 |
| 当前源码的浏览器 E2E、原生交互、托管 CI、安装包、外部同步、跨平台 | NOT_RUN；02 未改 UI 行为；01 旧浏览器/进程证据保持历史边界 |

详细测试名和断言点见独立复核的 AC02-* 映射。Rust 20 项中存储为 10 项，wire 为 8 项，其余为两项 startup 测试；空测试目标未计数。

## 回退与审计

只按当前 diff 回退 02 源码，保留现有用户数据和其他任务改动。迁移使用 SQLite backup API 创建不覆盖旧备份的一致性副本；故障测试证明迁移失败保留旧 schema 和旧行。旧版本不能读取更高 schema，恢复须使用兼容版本或已验证的迁移前备份，不能删除数据库恢复。故障日志、损坏源码副本、源码哈希、独立命令收据和最终产物 hash 保留作为审计证据。

提交、归档、发布和日常环境安装均未执行。

最终文档检查：15 份交付文档的相对链接错误为 0；独立复核冻结的 22 个文件哈希未变；父子 task.json 与原生 hash 一致；git diff --check 退出 0，见 [收尾检查](closeout-check.json)。02 上下文清单再次校验通过（9＋9 项）。开发日志已用 add_session.py --no-commit 记录，未生成提交。
