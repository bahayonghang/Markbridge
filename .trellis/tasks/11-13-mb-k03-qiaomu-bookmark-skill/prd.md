# K03 qiaomu-markbridge-bookmarks 项目 Skill 包与门禁验收

## 目标与前置条件

交付父任务 [11-13-mb-skill-bookmark-db](../11-13-mb-skill-bookmark-db/prd.md) 的 R5 与 R6：遵循 `qiaomu-meta-skill`（`Governed` 模式）在独立目录 `.agents/skills/qiaomu-markbridge-bookmarks/` 下构建项目级书签操作 Skill 包，打通“Agent 触发 Skill -> `scripts/mb_bookmarks.py` -> `markbridge-skill` Rust CLI -> `markbridge.sqlite` -> 桌面端实时可见”闭环，并完成全部 Skill 评估门禁与全仓回归验收。

- **启动前置条件**：[K02](../11-13-mb-k02-desktop-local-sync/prd.md) 全部自动检查与阶段收据 PASS。

## 需求范围

1. **K03-R1（Qiaomu `Governed` 模式独立 Skill 文件夹）**：
   - 创建 `.agents/skills/qiaomu-markbridge-bookmarks/`，严格保证包内只有一个根 `SKILL.md`（若含示例或夹具一律命名 `SKILL.example.md` / `SKILL.fixture.md`）。
   - `SKILL.md` 包含高区分度中英触发 `description`（覆盖在项目中用 Skill 收藏网址、管理本地书签专夹、查书签、打标签、记书签笔记、导出本地书签；明确排除直接改写 Chrome `Bookmarks` 文件、排除扩展配对与浏览器在线同步排障）、最小工作流、安全硬边界与版权元数据（`Copyright (c) 向阳乔木`，`https://x.com/vista8`，`https://github.com/joeseesun/`）。
   - 配套交付 `agents/interface.yaml`、`README.md`（面向安装/使用者的独立文档，不复制 `SKILL.md`）、`references/command-contract.md`、`references/safety-and-rollback.md`。
2. **K03-R2（确定性包装脚本 `scripts/mb_bookmarks.py` 与测试套件）**：
   - 实现跨平台 Python 3 入口脚本 `scripts/mb_bookmarks.py`：自动定位仓库根目录与 `markbridge-skill` 二进制（未编译时按需调用 `cargo build --quiet -p markbridge-skill-cli`），统一透传参数、JSON 输出与退出码。
   - 内置 `--self-test` 模式：自动创建临时目录作为 `--app-data`，完整验证 `init -> mkdir -> add -> tag -> note -> summary -> search -> move -> backup -> delete` 全链路并清理临时目录，绝不触碰日常库。
   - 编写 Python 单元测试（`tests/test_mb_bookmarks.py`）覆盖二进制发现、日常库保护参数透传、错误码处理与 `--self-test`。
3. **K03-R3（Qiaomu 评估、报告产物与全仓集成验收）**：
   - 编写 `evals/trigger_cases.json`（涵盖正向自然表达、负向排除与近邻干扰项）与 `evals/output_cases.json`。
   - 运行 `qiaomu-meta-skill` 官方脚本生成并校验：
     - `reports/prior-art-research.md`
     - `reports/skill-ir.json`
     - `reports/trigger-eval.json`
     - `reports/creation-handoff.md`（明确列出先例借鉴、刻意拒绝项、原创设计及 `missing evidence` 边界）
   - 通过 `validate_skill.py` 与 `release_check.py --phase local --run-tests`，完成全仓回归与 `.trellis/spec/` 规范沉淀评审，汇总更新父任务 [verification.md](../11-13-mb-skill-bookmark-db/verification.md)。

## 验收标准

- [x] **AC-K03-1**：`.agents/skills/qiaomu-markbridge-bookmarks/` 结构完整、根入口唯一，通过 `validate_skill.py`、`export_skill_ir.py`、`trigger_eval.py` 与 `release_check.py --phase local --run-tests` 全部检查。
- [x] **AC-K03-2**：`python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test` 在隔离临时目录下 100% 通过，且与 `Bridge` 实时监听联调验证通过。
- [x] **AC-K03-3**：`reports/prior-art-research.md` 与 `reports/creation-handoff.md` 真实记录候选技能指标、得失取舍、优势分类（`design advantage` / `validated advantage` / `hypothesis`）及未执行远程发布的 `missing evidence` 说明。
- [x] **AC-K03-4**：全仓 `cargo test --workspace`、`pnpm protocol:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过；`.trellis/spec/` 完成必要更新评估；用户原有未提交文件完好无损。

## 不在范围

- 执行 `publish_skill.py` 向外部 GitHub 创建仓库或发布 Release。
- 未获额外明确授权前执行 `git commit`、任务归档或系统级安装。
