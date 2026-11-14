# 验证矩阵（Verification Matrix）

所有未实际运行的检查项必须保持 `NOT_RUN` 或 `UNVERIFIED`，严禁把规划命令写成已通过证据。

| 验证编号 | 验证维度 | 对应需求 / AC | 目标子任务 | 当前状态 | 证据位置 |
|---|---|---|---|---|---|
| V-K01 | `local-skills` 幂等初始化、多层文件夹/书签 CRUD、移动重排、`metadata_fts` trigram 与 `008_semantic` 触发器一致性（`SCHEMA_VERSION == 8`） | R1 / AC1 | K01 | **PASS** | [K01 check-report.md](../11-13-mb-k01-local-skill-cli/evidence/check-report.md) |
| V-K02 | `markbridge-skill` CLI 安全守卫（保护 `skills-root`、禁写 Chrome Profile、非法 URL 拒绝、未带 `--allow-daily-db` 拒写日常库、含未 checkpoint WAL 的在线备份恢复） | R1, R2, R3 / AC2, AC3 | K01 | **PASS** | [K01 check-report.md](../11-13-mb-k01-local-skill-cli/evidence/check-report.md) |
| V-K03 | `pnpm protocol:check` 零漂移 + Chrome `TreeFull`/增量事件同步不覆盖 `local-skills` + 浏览器写回/配对命令对 `local-skills` 返回 `READ_ONLY`/`WRONG_PROFILE` | R3, R4 / AC3 | K02 | **PASS** | [K02 check-report.md](../11-13-mb-k02-desktop-local-sync/evidence/check-report.md) |
| V-K04 | 桌面端 `Bridge` 运行中外部进程执行 `markbridge-skill` 写入同一个临时 `markbridge.sqlite` 后自动递增 `revision` 并推送状态 + 前端界面/首次引导回归（Vitest + Playwright 51 passed） | R4 / AC3, AC4 | K02 | **PASS** | [K02 check-report.md](../11-13-mb-k02-desktop-local-sync/evidence/check-report.md) |
| V-K05 | `.agents/skills/qiaomu-markbridge-bookmarks` 通过 `validate_skill.py`（0 警告）、`trigger_eval.py`（26/26）、`export_skill_ir.py`、`release_check.py --phase local --run-tests`（0 block）、`mb_bookmarks.py --self-test`（20 步）及跨进程 `live_bridge_skill` 联调 | R5, R6 / AC5 | K03 | **PASS** | [K03 check-report.md](../11-13-mb-k03-qiaomu-bookmark-skill/evidence/check-report.md) & Skill `reports/` |
| V-K06 | 全仓联合回归（`cargo test --workspace` 203 passed、`pnpm lint`、`pnpm typecheck`、`pnpm test` 274+35 passed、`pnpm build`）及工作树既有无关文件零污染核查 | R6 / AC6 | K03 | **PASS** | [K03 check-report.md](../11-13-mb-k03-qiaomu-bookmark-skill/evidence/check-report.md) |
| V-REMOTE | 外部独立 GitHub 仓库/PR/Release 发布、`npx skills add` 联网安装与商业多模型/人工双盲打分（不在本次项目内授权范围） | 超出范围边界声明 | — | `NOT_RUN` (`missing evidence`) | `.agents/skills/qiaomu-markbridge-bookmarks/reports/creation-handoff.md` |
