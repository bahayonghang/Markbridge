# K03 阶段验收收据（`qiaomu-markbridge-bookmarks` 项目 Skill 包与门禁验收）

验证日期：2026-11-13  
分支：`dev`  
目标子任务：`11-13-mb-k03-qiaomu-bookmark-skill`

## 1. 交付摘要

1. **Qiaomu `Governed` 模式项目内独立 Skill 包（`.agents/skills/qiaomu-markbridge-bookmarks/`）**：
   - 包内仅包含唯一根入口 `SKILL.md`（UTF-8 大小 `< 14,000` 字节，满足生产上下文预算），含中英触发边界、`Router Rules`、`Compact Workflow`、`Gate Ladder`、`Output Contract` 与版权声明（`Copyright (c) 向阳乔木`）。
   - 配套交付 `manifest.json`（`v0.1.0`、`maturity_tier: "governed"`）、`agents/interface.yaml`、`README.md`、`LICENSE`、`references/command-contract.md`、`references/safety-and-rollback.md`、`evals/trigger_cases.json`、`evals/output_cases.json`。
2. **确定性包装脚本与自动化联调测试**：
   - `scripts/mb_bookmarks.py`：自动解析工作区根与 `markbridge-skill` 可执行文件（缺失或过期时自动 `cargo build --quiet -p markbridge-skill-cli --bin markbridge-skill`），内置 20 步隔离临时目录 `--self-test`。
   - `tests/test_mb_bookmarks.py`：5 项 `unittest` 用例覆盖二进制定位、缺失二进制脱敏拒绝、`com.markbridge.desktop` 日常库 `--allow-daily-db` 写保护、跨 Profile 拒绝与 `--self-test`。
   - `crates/skill-cli/tests/live_bridge_skill.rs`：跨进程集成测试验证 `python mb_bookmarks.py -> markbridge-skill -> markbridge.sqlite -> Bridge notify 实时重载 -> FTS5 trigram 查询 -> shutdown 立即删库` 全链路。
3. **证据报告与 `.trellis/spec/` 规范沉淀**：
   - 生成并核验 `reports/prior-art-research.md`、`reports/skill-ir.json`、`reports/trigger-eval.json`、`reports/creation-handoff.md`（明确标注远程安装与外部多模型/人工盲评为 `missing evidence`）。
   - 按 `trellis-update-spec` 将 `local-skills` 存储与 CLI 契约沉淀至 `.trellis/spec/backend/database-guidelines.md` 与 `.trellis/spec/backend/directory-structure.md`（未触碰用户修改中的 `semantic-search.md`）。

## 2. 验证矩阵与结果

| 检查项 | 命令 | 结果 | 关键证据 |
|---|---|---|---|
| 包装器隔离自检 | `python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test` | **PASS** | `stepsPassed: 20, tempCleaned: true` |
| Python 单元测试 | `python -m unittest discover -s .agents/skills/qiaomu-markbridge-bookmarks/tests -p "test_*.py" -v` | **PASS** | `Ran 5 tests in 1.182s — OK` |
| 跨进程 `Bridge` 实时联调 | `cargo test -p markbridge-skill-cli --test live_bridge_skill` | **PASS** | `skill_wrapper_drives_live_bridge_reload_fts_query_and_clean_shutdown ... ok (0.48s)` |
| 触发边界冒烟评估 | `trigger_eval.py .agents/skills/qiaomu-markbridge-bookmarks` | **PASS** | `26/26 passed, false_positive: 0, false_negative: 0, pass_rate: 1.0` |
| Skill IR 导出 | `export_skill_ir.py .agents/skills/qiaomu-markbridge-bookmarks --output reports/skill-ir.json` | **PASS** | `schema_version: "2.0.0-qiaomu-lite", version: "0.1.0"` |
| Qiaomu 包契约校验 | `validate_skill.py .agents/skills/qiaomu-markbridge-bookmarks` | **PASS** | `ok: true, failures: [], warnings: []` |
| 本地发布就绪审计 | `release_check.py .agents/skills/qiaomu-markbridge-bookmarks --phase local --run-tests` | **PASS** | `ok: true, pass: 6, warn: 3 (clean_worktree / clean_install / provider_or_human_output_evidence), block: 0` |
| 全仓联合回归 | `pnpm protocol:check && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && pnpm lint && pnpm typecheck && pnpm test && pnpm build` | **PASS** | Rust 203 passed, Vitest 274 passed, Node 35 passed, Web/MV3 build & artifact scan passed |

## 3. 验收标准核对

- [x] **AC-K03-1**：`.agents/skills/qiaomu-markbridge-bookmarks/` 根入口唯一，0 失败 0 警告通过 `validate_skill.py`、`export_skill_ir.py`、`trigger_eval.py` 与 `release_check.py --phase local --run-tests`。
- [x] **AC-K03-2**：`mb_bookmarks.py --self-test` 20 步隔离断言通过，`live_bridge_skill.rs` 跨进程 `Bridge` 实时监听联调通过。
- [x] **AC-K03-3**：`reports/prior-art-research.md` 与 `reports/creation-handoff.md` 完整记录双目录指标、优势分类与 `missing evidence` 边界。
- [x] **AC-K03-4**：全仓质量检查通过，`.trellis/spec/` 完成沉淀，用户原有未提交文件完好无损。
