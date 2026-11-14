# K03 执行计划

## 实施清单

- [x] 1. 确认 K02 阶段收据已 PASS，阅读 `trellis-before-dev`、`qiaomu-meta-skill` 门禁文档及 `implement.jsonl` 中全部规范。
- [x] 2. 创建 `.agents/skills/qiaomu-markbridge-bookmarks/`，先行编写 `SKILL.md`、`agents/interface.yaml` 与 `evals/trigger_cases.json`，运行 `trigger_eval.py` 验证触发边界后再扩展其余文件。
- [x] 3. 实现 `scripts/mb_bookmarks.py`、`tests/test_mb_bookmarks.py`、`references/`、`evals/output_cases.json`、`README.md` 与 `LICENSE`。
- [x] 4. 运行 `mb_bookmarks.py --self-test` 及与 `markbridge-core::bridge::Bridge` 的端到端联调测试。
- [x] 5. 运行 `validate_skill.py`、`export_skill_ir.py`、`trigger_eval.py`、`release_check.py --phase local --run-tests`，生成并核验 `reports/` 下全部证据与 `creation-handoff.md`。
- [x] 6. 运行全仓质量回归，加载 `trellis-update-spec` 判断是否需将 `local-skills` 规范写入 `.trellis/spec/backend/database-guidelines.md`，汇总更新父任务 `verification.md` 与 `evidence/check-report.md`。

## 验证命令

```powershell
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test
python -m unittest discover -s .agents/skills/qiaomu-markbridge-bookmarks/tests -p "test_*.py"
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\validate_skill.py" .agents/skills/qiaomu-markbridge-bookmarks
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\export_skill_ir.py" .agents/skills/qiaomu-markbridge-bookmarks --output .agents/skills/qiaomu-markbridge-bookmarks/reports/skill-ir.json
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\trigger_eval.py" .agents/skills/qiaomu-markbridge-bookmarks --cases .agents/skills/qiaomu-markbridge-bookmarks/evals/trigger_cases.json --output .agents/skills/qiaomu-markbridge-bookmarks/reports/trigger-eval.json
python "C:\Users\lyh\.gemini\antigravity-cli\skills\qiaomu-meta\scripts\release_check.py" .agents/skills/qiaomu-markbridge-bookmarks --phase local --run-tests
cargo test --workspace
pnpm protocol:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 风险与回滚点

- 确保 `.agents/skills/qiaomu-markbridge-bookmarks/` 内不存在第二个 `SKILL.md`（防止递归技能发现冲突）；运行 `release_check.py --phase local` 阻断秘密信息或个人绝对路径写入报告。
