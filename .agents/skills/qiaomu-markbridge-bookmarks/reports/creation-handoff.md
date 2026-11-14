# Creation Handoff Report (`qiaomu-markbridge-bookmarks` v0.1.0)

- **包名**：`qiaomu-markbridge-bookmarks`
- **版本**：`0.1.0`
- **路径**：`.agents/skills/qiaomu-markbridge-bookmarks`
- **模式**：`governed` (`context_budget_tier: "production"`)
- **日期**：2026-11-13

## 1. 交付组件清单

- `SKILL.md`：唯一技能入口（`< 14KB` 生产上下文预算），含中英触发边界、`Router Rules`、`Compact Workflow`、`Gate Ladder`、`Output Contract` 与版权声明。
- `manifest.json` & `agents/interface.yaml`：版本、成熟度、平台兼容目标（`openai`、`claude`、`generic`、`agent-skills-compatible`）、信任与文件系统权限边界声明。
- `scripts/mb_bookmarks.py`：确定性 Python 3 包装器，支持自动定位工作区根、按源码修改时间解析或构建 `markbridge-skill` 二进制、透传 JSON 与退出码，以及 20 步隔离临时目录 `--self-test`。
- `tests/test_mb_bookmarks.py`：`unittest` 自动化测试套件（二进制解析、缺失路径脱敏失败、`com.markbridge.desktop` 日常库 `--allow-daily-db` 写保护、跨 Profile 拒绝、`--self-test` 全生命周期）。
- `references/command-contract.md` & `references/safety-and-rollback.md`：完整子命令参数表、退出码矩阵、并发与备份回滚手册。
- `evals/trigger_cases.json` & `evals/output_cases.json`：26 条正向/负向/近邻触发评估集与隔离输出回归用例。
- `README.md` & `LICENSE`：面向使用者的安装、自然语言调用示例、验证命令与故障排查文档（MIT License）。

## 2. 先例取舍与优势归类（Advantage Classification）

- **Validated Advantage（已验证优势）**：
  1. **100% 遵循 Rust 唯一 SQLite 写入方与 FTS5 trigram 触发器一致性**：经 `cargo test -p markbridge-skill-cli`、`mb_bookmarks.py --self-test`（20 步断言）与 `Bridge` 实时监听测试验证，新增/更新备注与摘要立即可通过 `trigram` 检索命中，同时正确触发 `008_semantic.sql` 失效触发器且不触碰 Chrome。
  2. **日常库防误写硬门禁与零路径泄露**：未带 `--allow-daily-db` 时向含 `com.markbridge.desktop` 的目录发起写命令确定性返回退出码 `2`（`READ_ONLY`）且不创建空库文件；错误 JSON 不包含本机绝对路径。
  3. **运行中桌面端免重启实时可见**：外部进程通过 `mb_bookmarks.py` 写入 `markbridge.sqlite` 后，挂载 `local_watch` 的 `Bridge` 在 120ms 防抖窗口后自动广播更新后的 `BridgeConnection::Local` 状态与最新 `revision`，`shutdown()` 后临时目录立即可完整删除。
  4. **触发边界冒烟评估 26/26 全通过**：`reports/trigger-eval.json` 验证 12 条中英正向请求、8 条无关请求与 6 条 Chrome 文件/扩展配对近邻干扰项全部按预期分流（`pass_rate = 1.0`）。
- **Design Advantage（架构设计优势）**：
  - 独立 `local-skills` Profile 与 `skills-root` 受保护根文件夹将 AI Skill 的自由目录整理能力与 Chrome 书签同步树彻底解耦，避免 `TreeFull` 覆盖冲突，同时允许未配对浏览器的纯本地使用场景。
- **Hypothesis（待实际长期使用检验的假设）**：
  - 在超大规模本地书签库（例如单次连续调用数十次 CLI 批量导入上千条书签）下，逐命令短进程调用相比未来可选的 `batch-import` JSONL 子命令可能存在进程启动开销，后续可按真实使用频率评估是否扩展批量导入子命令。

## 3. 证据边界与缺失证据声明（Evidence Boundary & Missing Evidence）

1. **远程仓库 PR / GitHub Release / `npx skills add` 在线干净安装证据：`missing evidence`**
   - 原因：本任务明确限定为 Markbridge 仓库内功能与项目级 `.agents/skills/qiaomu-markbridge-bookmarks/` 实现，未获授权向外部 GitHub 推送分支、创建独立公开仓库、打 Tag 发布 Release 或执行联网 `npx skills add <owner>/<repo>` 安装验证。`release_check.py --phase local --run-tests` 中 `clean_install` 门禁按预期保留为 `warn (missing evidence)`。
2. **外部多模型 Provider 在线盲测 / 人工盲评证据（`reports/output-evidence.json`）：`missing evidence`**
   - 原因：当前验证采用本地确定性 Rust/Python 集成测试与隔离临时数据库真实执行收据，未运行外部商业模型 API 对照盲评或人工双盲打分；按 `qiaomu-meta-skill` 诚实声明规范不伪造 `provider_backed` / `human_blind_review` 证书，`provider_or_human_output_evidence` 保持为 `warn (missing evidence)`。
3. **当前工作树脏状态（`clean_worktree`）**：
   - 原因：遵循 `AGENTS.md` 硬约束，未获用户单独明确授权前不执行 `git commit`，且严格保留用户工作区原有的未提交文件（`semantic-search` 相关文档与脚本）。因此本地阶段 `clean_worktree` 为预期的 `warn`。

---

Copyright (c) 向阳乔木
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
