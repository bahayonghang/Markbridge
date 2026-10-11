# 02 实现报告

日期：2026-10-11。此报告记录实现代理的源码恢复、定向检查和首次失败。主会话负责独立检查、完整门槛、原生构建及任务状态。

## 改动

- `crates/protocol/src/wire.rs`：替换损坏源码，按现有 schema、TypeScript 校验器、fixture 和任务合同恢复 Rust DTO、受限字段、时间转换、树校验、受保护节点集合及帧编解码。恢复后的四个生成文件逐字节通过 `pnpm protocol:check`，未改写生成文件。
- `crates/protocol/src/wire_tests.rs`：增加 update/move/delete 的有效输入、额外字段拒绝及 JSON 整数写法回归测试。
- `crates/core/src/storage/tests.rs`：增加非空且未编号数据库的拒绝与原文件、旧行保留测试。
- `packages/protocol/src/wire.test.ts`：Rust 消费临时文件中的 TypeScript 现场序列化结果；共享接受/拒绝样本由 37 个增至 47 个，增加 mutation、空事件额外字段和整数表示形式。

恢复期间修正了三个已实测差异：普通书签不继承 folderType 文件夹的节点保护；Serde 空事件和 delete 使用空结构变体以拒绝额外字段；Rust 数值反序列化接受 schema 合法的 `1.0`、`1e0` 整数写法，同时保留边界与安全整数检查。OperationReceipt 的 Rust payload 使用 `Box<Receipt>` 降低枚举占用；JSON 和 TypeScript 合同保持一致。

## SOURCE_CORRUPTION

首次命令：`cargo test -p markbridge-core -p markbridge-protocol --locked`。退出 101；Rust 编译器报告 `crates/protocol/src/wire.rs:1:1` 存在空字节。文件为 22,009 字节，非零字节数为 0，SHA-256 为 `9F20FF1A40087F4B9DC00CE17AAA38F1A9887808D4279EEE913B5B9A889596CB`。原因未查明。

证据为 `wire-source-failure.json`、`wire-source-corrupt.bin` 和 `implement-rust-initial.log`。检查时未观察到 Code/editor/cargo/rustc 写入进程；文件修改时间早于当前代理启动时间。项目和临时目录中未找到同名源码副本。实现代理没有停止其他进程。

并行首次 `pnpm protocol:check` 退出 0，日志为 `implement-protocol-initial.log`。该结果不用于恢复后源码验收；源码恢复后已触发 Rust 重新编译，并重新执行漂移检查。

## 修复期间失败

| 日志 | 结果 | 后续修复 |
|---|---|---|
| `implement-rust-recovery-1.log` | FAIL；core 9 通过、1 失败；保护集合 7 个，预期 5 个 | folderType 只保护节点自身，managed 保护后代 |
| `implement-rust-recovery-2.log` | FAIL；core 10 通过；protocol 7 通过、1 失败；空事件接受额外字段 | import_began/import_ended/delete 改为空结构变体 |
| `implement-corpus-expanded-initial.log` | FAIL；TS wire 7 通过、1 失败；样本 45 的双语言结果不同 | 数值 visitor 接受合法整数表示 `1.0` 和 `1e0` |
| `implement-rust-final.log` | FAIL；fmt 通过、core 11 通过、protocol 9 通过；clippy 报 large_enum_variant | OperationReceipt 的 payload 使用 Box |

日志均保留原始失败输出。`implement-rust-recovery-3.log`、`implement-corpus-expanded-final.log`、`implement-clippy-final.log` 分别记录中间修复后通过结果。

## 最终定向结果

| 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|
| `cargo fmt --all -- --check` | 0 | PASS | `implement-final-focused.log` |
| `cargo test -p markbridge-core -p markbridge-protocol --locked` | 0 | PASS；core 11、protocol 9；共 20 项 | `implement-final-focused.log` |
| `cargo clippy -p markbridge-core -p markbridge-protocol --all-targets -- -D warnings` | 0 | PASS | `implement-final-focused.log` |
| `pnpm protocol:check` | 0 | PASS；四个生成文件无漂移 | `implement-final-ts.log` |
| `pnpm exec vitest run packages/protocol/src/wire.test.ts packages/protocol/src/index.test.ts` | 0 | PASS；2 个文件、18 项；共享 corpus 47 个样本 | `implement-final-ts.log` |
| `pnpm lint` | 0 | PASS | `implement-final-ts.log` |
| `pnpm typecheck` | 0 | PASS | `implement-final-ts.log` |

AC02-1 覆盖同 chromeId 的两个 Profile、重复 URL、缺失/重复 folderType、managed、侧车隔离及 sourceEpoch 重置。AC02-2 覆盖现场双向序列化、未知版本/写命令、额外字段、缺失 nullable envelope 字段、字符与数值边界、事件和 mutation 变体。AC02-3 覆盖 metadata/bookmarkId 保留、tombstone、非法树和写入前故障注入。AC02-4 覆盖空库、v1 升级、包含未 checkpoint WAL 的备份、migration 回滚、备份失败、高版本拒绝与非空未编号数据库保留。

## 边界

上述证据使用合成 fixture 和临时 SQLite。实际 Chrome 身份、配对和浏览器认证未运行，归任务 03。任务 01 原生验收保持 UNVERIFIED。实现代理未运行最终 workspace 完整门槛、Windows 原生构建或安装；主会话及独立检查代理负责对应结果。未提交、归档、发布、安装或修改日常 Chrome 数据。
