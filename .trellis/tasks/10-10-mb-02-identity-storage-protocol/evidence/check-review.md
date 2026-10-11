# 02 独立检查报告

日期：2026-10-11。检查角色：trellis-check。检查对象为当前未提交源码；最终相关文件 SHA-256 见 `check-source-manifest.jsonl`。检查代理未修改产品源码、生成文件或公共合同。主会话负责父任务、spec、最终收据与原生构建。

实测工具版本：Node v26.7.0、pnpm 12.12.0、cargo 1.99.0 (5f94df478 2026-08-27)、rustc 1.99.0 (b940084d7 2026-09-28)。

## Findings (fixed)

没有发现需要机械修复的问题。已核对恢复后的 Rust 源码及实际执行路径，没有沿用损坏源码恢复前的通过结果。

## Findings (not fixed)

没有未修复的源码问题。

任务设计文档中共享 corpus 的 37 个样本记录已过时，当前测试为 47 个样本。主会话已接收同步请求，文档更新归主会话。

`wire.rs` 原先 22,009 字节全为空字节，原因未查明。首次失败、损坏副本和恢复过程记录保留在 `wire-source-failure.json`、`wire-source-corrupt.bin`、`implementation-report.md` 及 `implement-*.log`。独立检查覆盖恢复后的源码；没有将源码恢复解释为损坏原因已解决。

## 验收映射

| 验收 | 结论 | 运行证据 |
|---|---|---|
| AC02-1 | PASS（合成数据、临时 SQLite） | 两个 Profile 使用相同 chromeId；重复 URL 分配独立 bookmarkId；缺失和重复 folderType、managed 及后代保留；本地 metadata 与 epoch 隔离。见 `profiles_epochs_duplicates_managed_and_sidecars_remain_separate`。独立 mirror 表和操作/快照字段经 reopen 验证。 |
| AC02-2 | PASS | TypeScript 测试调用 Rust typed DTO 现场序列化，生成 typed TS DTO 临时文件再由 Rust 解析和重新编码；47 个共享接受/拒绝样本结果相同。未知版本、未知写命令、额外字段、缺少 nullable envelope 字段、字段和帧边界、事件及 mutation 变体有反例。见 `check-test.log` 和 `check-rust-test.log`。 |
| AC02-3 | PASS | 刷新保留 bookmarkId/metadata，删除产生 tombstone，重新出现清除 tombstone；环、重复 ID、缺父节点、错误 Profile、旧 revision 拒绝。缓存与 cursor 写入后、commit 前注入 Cancelled，重开数据库后两者均保持旧值。 |
| AC02-4 | PASS | 空库初始化 WAL/foreign_keys/schema；v1 备份包含未 checkpoint 的 WAL 行；迁移失败回滚 schema 与旧行，重开后成功升级；两个备份均保留；备份失败停止迁移；高版本和非空未编号数据库拒绝且原文件、旧行保留。 |

## Verification

全部命令退出 0。开始/结束时间、退出码和原始日志路径见 `check-gates.jsonl`。

| 命令 | 状态 | 日志 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `check-install.log` |
| `pnpm lint` | PASS | `check-lint.log` |
| `pnpm typecheck` | PASS | `check-typecheck.log` |
| `pnpm test` | PASS；Vitest 3 文件、20 项；Node 4 项 | `check-test.log` |
| `pnpm build` | PASS；Web 资产扫描通过 | `check-build.log` |
| `pnpm protocol:check` | PASS；四个生成文件无漂移 | `check-protocol.log` |
| `cargo fmt --all -- --check` | PASS | `check-fmt.log` |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | `check-clippy.log` |
| `cargo test --workspace --locked` | PASS；core 11、protocol 9，共 20 项 | `check-rust-test.log` |

Rust core 11 项包含存储 10 项与 startup 1 项；protocol 9 项包含 wire 8 项与 startup 1 项。未将空测试目标计入测试数。pnpm test 包含协议生成漂移的故意失败反例，该测试整体通过。

## 证据边界与回退

源码复核确认：SQLite 仅由有界队列后的专用线程访问；缓存、tombstone、last_synced_at 与 cursor 在同一事务提交；新 epoch 保留旧缓存与侧车并分配新身份；Origin 只允许完整扩展 Origin，数据库保存凭据引用；02 没有建立实际认证或浏览器写入通路。

数据库升级前用 SQLite backup API 创建不覆盖旧文件的备份。旧二进制拒绝较新 schema。回退需使用兼容版本读取保留旧库或已验证的升级前备份；不删除数据库恢复。恢复与故障反例的审计证据见上述原始日志及实现报告。

检查代理未重复运行 `pnpm build:native`，主会话在最终源码上运行并记录该结果。任务 01 原生桌面验收保持 UNVERIFIED；真实 Chrome Profile、配对、Origin/凭据认证及浏览器行为属于任务 03，保持 NOT_RUN。此报告不声明 V02 的真实 Chrome 部分通过。未提交、归档、发布、安装或修改日常 Chrome 数据。
