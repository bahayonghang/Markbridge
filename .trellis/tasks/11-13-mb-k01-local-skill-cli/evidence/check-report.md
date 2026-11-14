# K01 阶段验证与质量收据（`11-13-mb-k01-local-skill-cli`）

- **日期**：2026-11-13
- **任务状态**：已完成实施与本地自动化验收（`PASS`）
- **变更文件**：
  - `Cargo.toml` / `Cargo.lock`（新增 workspace 成员 `crates/skill-cli`，未升级任何现有依赖版本）
  - `crates/core/src/storage/mod.rs`（新增 `ProfileOrigin`、`StoredIdentity`，保护 `local-skills` 不被扩展树同步、重置或吊销覆盖）
  - `crates/core/src/storage/local_space.rs`（实现 `local-skills` 与 `skills-root` 幂等初始化、树拓扑/同级 `position` 重排 CRUD、标签/备注/摘要单事务游标递增、导出与 `rusqlite::backup::Backup` 在线快照）
  - `crates/core/src/storage/tags.rs`（暴露包内单事务标签应用辅助方法）
  - `crates/core/src/bridge/mod.rs`（适配 `StoredIdentity` 类型签名）
  - `crates/skill-cli/Cargo.toml`、`crates/skill-cli/src/main.rs`（实现 `markbridge-skill` 16 个 JSON 子命令、URL 安全校验、脱敏错误信封与 `--allow-daily-db` 日常库写门禁）

## 验收标准核对（AC-K01-1..4）

| 验收项 | 结论 | 证据摘要 |
|---|---|---|
| `AC-K01-1` | `PASS` | `markbridge-skill` 单元测试 `tests::full_lifecycle_crud_fts_trigram_and_export` 及真实 `markbridge-skill.exe` 临时目录冒烟通过：`SCHEMA_VERSION = 8` 保持不变，`status/init/mkdir/add/update/move/delete/tag/note/summary/search/get/tree/list/export` 全链路返回 `{"ok": true, ...}`；1–2 字与 3+ 字备注/摘要通过 `metadata_fts` trigram 与回退路径命中；`008_semantic` 触发器在标题/摘要变更与删除时正常触发无报错。 |
| `AC-K01-2` | `PASS` | `markbridge-core` 单元测试 `storage::local_space::tests::*` 与 `markbridge-skill` 测试 `tests::enforces_safety_gates_root_protection_url_rules_and_chrome_isolation` 通过：删除/移动/修改 `skills-root` 返回 `PROTECTED_NODE`；非空目录未传 `--recursive` 返回 `CONFLICT`；环路或挂到书签节点返回 `INVALID_TREE`；`javascript:` / `file:` / 含 `user:pass@` URL 返回 `INVALID_MESSAGE`；同库 Chrome Profile 完全不受本地写入影响且本地接口拒绝访问其他 Profile（`WRONG_PROFILE`）。 |
| `AC-K01-3` | `PASS` | `tests::enforces_safety_gates_root_protection_url_rules_and_chrome_isolation` 及真实 CLI 冒烟验证：指向 `com.markbridge.desktop` 且未传 `--allow-daily-db` 时写命令立即以退出码 `2` 返回 `READ_ONLY` 且不创建/修改数据库文件；`tests::backup_preserves_uncheckpointed_wal_and_semantic_triggers_fire` 验证未 checkpoint WAL 数据经 `backup` 完整写入独立快照文件。 |
| `AC-K01-4` | `PASS` | `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`（`markbridge-core` 146 passed、`markbridge-desktop` 35 passed、`markbridge-protocol` 16 passed、`markbridge-skill` 3 passed，0 failed）与 `pnpm protocol:check` 全部退出码 `0`。 |

## 实跑命令摘录

1. `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && pnpm protocol:check` -> 退出码 `0`
2. 真实 CLI 临时目录冒烟（`target/debug/markbridge-skill.exe --app-data <TEMP>`）：
   - `init` -> `{"command":"init","ok":true,"status":{"bookmarkCount":0,"displayName":"Skills 书签库","folderCount":1,"initialized":true,...,"profileId":"local-skills","revision":1,"rootId":"skills-root","schemaVersion":8,"sourceEpoch":1}}`
   - `mkdir --title "AI 论文"` + `add --parent local-f:7bb7227a71de3d3c --title "SQLite WAL 文档" --url "https://www.sqlite.org/wal.html" --tag "数据库" --note "并发读写参考"` + `tag add --id local-b:c52d82af942f6fa6 --name "Rust"`
   - `search --query "并发读写"` -> `total: 1, revision: 4`
   - 默认日常库门禁测试（隔离伪造 `APPDATA` 下不传 `--allow-daily-db` 执行 `init`）-> 退出码 `2`，`{"errorCode":"READ_ONLY","message":"Daily database write requires --allow-daily-db","ok":false}`
