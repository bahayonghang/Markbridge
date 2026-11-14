# K01 执行计划

## 实施清单

- [x] 1. 阅读 `trellis-before-dev` 及 `implement.jsonl` 中全部后端规范，核对当前 `git status`。
- [x] 2. 在 `crates/core/src/storage/mod.rs` 扩展 `ProfileOrigin` 并保持既有 Chrome `PairedOrigin` 测试 100% 兼容。
- [x] 3. 新增 `crates/core/src/storage/local_space.rs`，实现 `ensure_local_skills_space`、本地树拓扑与同级 `position` 重排、文件夹/书签 CRUD、在线 `backup_database` 及 Chrome Profile 禁写保护。
- [x] 4. 新建 `crates/skill-cli` 并加入根 `Cargo.toml` workspace，实现 `markbridge-skill` 全部子命令、URL 安全校验、JSON 输出与 `--allow-daily-db` 门禁。
- [x] 5. 编写 `crates/core` 与 `crates/skill-cli` 集成测试（覆盖 AC-K01-1 至 AC-K01-3）。
- [x] 6. 运行验证命令并通过 `trellis-check`，将阶段收据写入 `evidence/check-report.md`。

## 验证命令

```powershell
cargo test -p markbridge-core
cargo test -p markbridge-skill-cli
cargo test --workspace
pnpm protocol:check
```

## 风险与回滚点

- `Cargo.toml` 新增 workspace 成员时避免升级任何已锁定依赖版本；若影响既有构建脚本（如 `scripts/native-build.mjs`），确保桌面打包仍只指定 `-p markbridge-desktop`。
