# Qiaomu Meta Skill 先例研究与 Skill 包设计方案

记录日期：2026-11-13

## 1. 先例发现（Built-in Prior-Art Discovery）

按 `qiaomu-meta-skill` 双目录规范，分别检索 `skills.sh`（`npx --yes skills find`）与 `SkillsMP`（`search_skillsmp.py --sort stars`），指标严格分离记录（`skills.sh installs` 为安装采用量，`SkillsMP repo_stars` 为源仓库 GitHub Stars，均不代表评分；公开评分统一记为 `rating evidence unavailable`）：

| 候选 Skill | 来源与指标 | 核心机制观察 | 处置结论 |
|---|---|---|---|
| `karakeep-app/karakeep@karakeep` | `skills.sh`: 541 installs<br>`SkillsMP`: 30,471 repo stars<br>rating: `unavailable` | 官方书签管理器配套 Skill，不在提示词中手拼底层存储结构，而是将增删改查、列表归档、标签操作全部收敛到确定性 CLI 子命令与 JSON 输出。 | **Adapt（适配）**：采用“轻 `SKILL.md` 路由 + 确定性 CLI 子命令”模式，将 SQLite 事务细节收敛到 Rust CLI。 |
| `ginobefun/BestBlogs@bestblogs-capture` | `SkillsMP`: 4,085 repo stars<br>rating: `unavailable` | 中文优先触发词设计（“收藏这篇 / 加个笔记 / 看我的收藏”），围绕书签 + 笔记高频动作映射到单一 CLI。 | **Adapt（适配）**：借鉴自然中文触发词与“收藏链接 + 打标签 + 记笔记”一体化工作流，同时显式排除浏览器实时配对写回。 |
| `TriliumNext/Trilium@adding-llm-mcp-tools` | `SkillsMP`: 38,876 repo stars<br>rating: `unavailable` | 本地 SQLite 知识库工具设计：强调事务原子性、受保护系统节点守卫（protected/system-note guards）、结构化错误码返回而非裸异常。 | **Keep（保留理念）**：在 Rust CLI 中内置受保护根文件夹守卫（禁止删除专属根文件夹、禁止越界修改 Chrome 同步节点）与稳定 JSON 错误码。 |
| `cheaper-inference/OmniRoute@omni-db-backups` & `0xdarkmatter/claude-mods@sqlite-ops` | `OmniRoute`: `skills.sh` 1.2K installs / `SkillsMP` 86,657 stars<br>`sqlite-ops`: `skills.sh` 111 installs<br>rating: `unavailable` | 对本地 SQLite 执行批量或破坏性变更前先行生成在线一致性备份，支持回滚与隔离验证。 | **Adapt（适配）**：复用 `rusqlite::backup` 在批量删除/移动前生成快照备份，测试默认强制使用临时 `--app-data`。 |
| `halcyon666/write-skills@chrome-bookmarks` / `gellenliu/devhelper@chrome-bookmark-reader` | `skills.sh`: 4–5 installs<br>rating: `unavailable` | 直接读写本机 Chrome `Bookmarks` JSON 文件。 | **Reject（明确拒绝）**：直接违反 Markbridge `AGENTS.md` 硬约束（禁止直接改写 Chrome `Bookmarks` 文件，扩展是唯一浏览器写入方）。 |

*注：`research_prior_art.py` 在 Windows 下直接子进程调用无后缀 `npx` 触发 `WinError 2`，本次已改用等效底层目录命令 `npx --yes skills find` 与 `search_skillsmp.py` 完整采集双源数据。*

---

## 2. Qiaomu Skill 模式与目录边界设计

### 模式选择：`Governed`（项目内生产复用 + 数据库写入/回滚边界）
- 该 Skill 会直接读写本机持久化 SQLite 数据库（`markbridge.sqlite`），涉及数据完整性、受保护节点边界、批量删除回滚与日常库隔离，按 `qiaomu-meta-skill` 门禁阶梯应采用 `Production` / `Governed` 标准（含 `agents/interface.yaml`、`evals/trigger_cases.json`、`reports/skill-ir.json`、权限与回滚声明、隔离库输出验证）。
- 本次任务为项目内创建与验证（除非用户后续明确要求公开发布 GitHub Release，否则不触发 `publish_skill.py` 远程发布）。

### 计划创建的单独文件夹与包结构
1. **项目内 Skill 独立目录**：`.agents/skills/qiaomu-markbridge-bookmarks/`（与现有 `.agents/skills/trellis-*` 同级，遵循单一根 `SKILL.md` 隔离规范，版权与作者元数据按 `qiaomu-meta-skill` 规范配置或按用户要求定制）：
   ```text
   .agents/skills/qiaomu-markbridge-bookmarks/
   ├── SKILL.md                      # 路由触发描述、核心命令速查、安全硬边界（绝不直写 Chrome / 裸调 sqlite3）
   ├── README.md                     # 面向使用者的安装/使用示例、前置条件、排障说明
   ├── agents/
   │   └── interface.yaml            # 平台中立接口声明与权限边界
   ├── scripts/
   │   └── mb_bookmarks.py           # 确定性入口脚本：定位/调用预编译或 cargo 编译的 Rust CLI，统一 JSON 输出与退出码
   ├── references/
   │   ├── command-contract.md       # 子命令参数、JSON 输出 Schema、幂等与分页约定
   │   └── safety-and-rollback.md    # 日常库 vs --app-data 隔离库、自动备份恢复、与 Chrome 同步的隔离规则
   ├── evals/
   │   ├── trigger_cases.json        # should-trigger / should-not-trigger / near-neighbor 触发用例
   │   └── output_cases.json         # 隔离临时库 CRUD / 搜索 / 越界拒绝回归断言
   └── reports/
       ├── prior-art-research.md     # 先例研究正式报告
       ├── skill-ir.json             # export_skill_ir.py 产物
       └── trigger-eval.json         # trigger_eval.py 产物
   ```
2. **Rust 数据库操作 CLI 独立模块/目录**：
   - 可选放在独立 workspace crate `crates/skill-cli/`（二进制名 `markbridge-skill`）或 `crates/core/src/bin/markbridge-skill.rs`，完全复用 `markbridge-core::storage::Storage` 的事务队列、迁移、FTS5 trigram 索引与备份能力。

---

## 3. 建议的 Trellis 子任务拆分草案（待核心产品决策确认后收敛）

一旦用户确认专属书签文件夹的隔离形态，由于该需求跨越 **Storage/CLI 后端**、**Bridge/UI 实时感知** 与 **Qiaomu Skill 包及评估门禁** 三个可独立验收的交付物，建议在父任务 `11-13-mb-skill-bookmark-db` 下拆分为 3 个顺序子任务：

1. **K01 — 本地专属书签空间存储与 Rust CLI**：完成 SQLite 本地专属文件夹/空间存储合同、受保护边界、在线备份与 `markbridge-skill` Rust CLI 全部 CRUD/检索/标签子命令及 Rust 集成测试。
2. **K02 — 桌面端展示适配与数据库变更实时刷新**：完成 `Bridge` 对 `markbridge.sqlite` 外部写入的防抖感知（`notify` + `data_version` + `Resumed`）、`LibraryWorkspace` 展示适配，确保桌面端开启时用 CLI 增删书签可自动刷新且不触碰 Chrome 扩展。
3. **K03 — `qiaomu-markbridge-bookmarks` Skill 封装与门禁验收**：按 `qiaomu-meta-skill` 完成 `.agents/skills/qiaomu-markbridge-bookmarks/`、`validate_skill.py`、`trigger_eval.py`、`export_skill_ir.json`、`release_check.py --phase local` 及隔离 `MARKBRIDGE_APP_DATA` 端到端验收。
