# 顺序执行计划（Markbridge 项目内书签操作 Skill 与本地数据库专夹）

## 0. 启动前门禁（Pre-Start Gates）

- [x] 用户在后续消息中明确批准本最新完整规划摘要（Goal / Scope / AC / Decisions / 子任务拆分）后，才可将目标子任务置为 `in_progress`。
- [x] 父任务 `11-13-mb-skill-bookmark-db` 仅作需求协调与最终集成，**严禁对父任务执行 `task.py start`**。
- [x] 严格按 `K01 → K02 → K03` 顺序一次实施一个子任务；前序子任务自动检查与阶段收据未 PASS 前，不得对后续子任务执行 `task.py start`。
- [x] 检查工作树：完整保留用户在 `.trellis/spec/backend/semantic-search.md` 与 `.trellis/tasks/10-10-mb-15-semantic-search/` 中的既有未提交改动，不混改、不覆盖。

---

## 1. 阶段实施顺序

### 阶段 1：[K01 本地专属书签库存储与 Rust Skill CLI](../11-13-mb-k01-local-skill-cli/prd.md)
1. 在 `crates/core/src/storage/` 实现 `ProfileOrigin`（保留 Chrome `PairedOrigin` 严格校验，新增 `LocalSkills` 受控常量 `markbridge-local://skills`）与 `local_space.rs`（`ensure_local_skills_space`、文件夹/书签 CRUD、移动重排、`skills-root` 保护、Chrome Profile 禁写守卫、`source_cursors.revision` 递增、`backup_database`）。
2. 新建 workspace 成员 `crates/skill-cli`（二进制 `markbridge-skill`），实现 `status`、`init`、`tree`、`list`、`search`、`get`、`mkdir`、`add`、`update`、`move`、`delete`、`tag`、`note`、`summary`、`backup`、`export` 子命令及 `--app-data` / `--allow-daily-db` 路径安全门禁。
3. 编写 Rust 单元与集成测试（空库按需初始化、`SCHEMA_VERSION == 8` 保持、`metadata_fts` trigram 检索、`008_semantic` 触发器联动、非空删除拦截、环路拦截、Chrome Profile 越界写拒绝、含未 checkpoint WAL 的在线备份恢复）。
4. 产出 K01 阶段验证收据后进入 K02。

### 阶段 2：[K02 桌面端本地书签库展示与数据库实时感知](../11-13-mb-k02-desktop-local-sync/prd.md)
1. 在 `crates/protocol/src/bridge.rs` 为 `BridgeConnection` 新增 `Local`，运行 `pnpm protocol:generate` 与 `pnpm protocol:check` 同步 Schema、TS 类型与静态校验器。
2. 在 `crates/core/src/bridge/` 支持加载 `ProfileOrigin::LocalSkills` 为 `BridgeConnection::Local`，实现 `ensure_local_library`，为所有浏览器写回/配对/镜像关联入口补齐 `ReadOnly` / `WrongProfile` 拦截，并实现基于 `notify` 目录监听 + `source_cursors.revision` 对比的 `reload_local_space`（含 `shutdown` 干净退出）。
3. 在 `apps/desktop/src-tauri/src/main.rs` 暴露主窗口专属命令 `ensure_local_library` 并在 `RunEvent::Resumed` 触发本地库重扫；在 `apps/desktop/src/`（`source-status.ts`、`App.tsx`、`ConnectionSettings.tsx`、`LibraryWorkspace.tsx`、`backend.ts`）完成本地来源状态展示、一键启用、隐藏无效 Chrome 配对按钮及首次引导保持。
4. 补齐 Rust Bridge 并发实时感知测试（外部 `markbridge-skill` 进程写同一个临时 `markbridge.sqlite` 后 `Bridge::subscribe()` 自动收到新 `revision` 与新节点）及前端 Vitest / Playwright 用例。
5. 产出 K02 阶段验证收据后进入 K03。

### 阶段 3：[K03 qiaomu-markbridge-bookmarks 项目 Skill 包与门禁验收](../11-13-mb-k03-qiaomu-bookmark-skill/prd.md)
1. 创建 `.agents/skills/qiaomu-markbridge-bookmarks/` 完整目录（`SKILL.md`、`agents/interface.yaml`、`README.md`、`scripts/mb_bookmarks.py`、`references/command-contract.md`、`references/safety-and-rollback.md`、`evals/trigger_cases.json`、`evals/output_cases.json`）。
2. 运行 `mb_bookmarks.py --self-test` 及临时 `MARKBRIDGE_APP_DATA` 下的端到端测试（验证 Skill 脚本 -> `markbridge-skill` -> SQLite -> `Bridge` 实时感知全链路）。
3. 执行 `qiaomu-meta-skill` 验证脚本导出 `reports/prior-art-research.md`、`reports/skill-ir.json`、`reports/trigger-eval.json`、`reports/creation-handoff.md`，并运行 `release_check.py --phase local`。
4. 执行全仓质量检查与 `.trellis/spec/` 规范同步判断，汇总父任务 [verification.md](verification.md)。

---

## 2. 验证命令清单

```powershell
# Rust 存储、Bridge 与 Skill CLI 测试
cargo test --workspace

# 协议漂移与静态校验器检查
pnpm protocol:check

# 前端静态检查、单测与构建
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# 受影响浏览器 E2E 回归
pnpm exec playwright test tests/e2e/shell.spec.ts tests/e2e/workspace-layout.spec.ts --workers=1

# Qiaomu Meta Skill 质量门禁（在 .agents/skills/qiaomu-markbridge-bookmarks 目录执行）
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\validate_skill.py" .agents/skills/qiaomu-markbridge-bookmarks
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\export_skill_ir.py" .agents/skills/qiaomu-markbridge-bookmarks --output .agents/skills/qiaomu-markbridge-bookmarks/reports/skill-ir.json
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\trigger_eval.py" .agents/skills/qiaomu-markbridge-bookmarks --cases .agents/skills/qiaomu-markbridge-bookmarks/evals/trigger_cases.json --output .agents/skills/qiaomu-markbridge-bookmarks/reports/trigger-eval.json
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\release_check.py" .agents/skills/qiaomu-markbridge-bookmarks --phase local --run-tests
```

---

## 3. 关键风险与回滚点

| 风险点 | 受影响文件 | 缓解与回滚策略 |
|---|---|---|
| 空库首次启动误注入本地 Profile 导致 `onboarding` 回归失败 | `crates/core/src/bridge/mod.rs`, `apps/desktop/src/App.tsx` | 严格采用按需创建（lazy provisioning）；若任何既有 `shell.spec.ts` 失败，立即回退自动创建逻辑 |
| `BridgeConnection::Local` 引发协议 Schema 漂移或前端穷举报错 | `crates/protocol/src/bridge.rs`, `packages/protocol/`, `source-status.ts` | 修改后立即执行 `pnpm protocol:generate && pnpm protocol:check && pnpm typecheck`；回滚只需还原 `bridge.rs` 并重生成协议 |
| Windows 下 `notify` 监听句柄阻塞临时目录清理 | `crates/core/src/bridge/` | 监听父目录非递归事件并在 `Bridge::shutdown` 中显式停止任务；集成测试断言临时目录可完整删除 |
| 测试误写用户日常 `%APPDATA%\com.markbridge.desktop` | `crates/skill-cli/src/main.rs`, `scripts/mb_bookmarks.py` | 写命令无 `--allow-daily-db` 且未指定非日常 `--app-data` 时直接硬拒绝；单测专门覆盖该拒绝分支 |
