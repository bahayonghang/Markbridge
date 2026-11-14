# Markbridge 项目内书签操作 Skill 与本地数据库专夹

## 目标与用户价值

在仓库内构建符合 `qiaomu-meta-skill`（`Governed` 模式）规范的项目级 Skill（`.agents/skills/qiaomu-markbridge-bookmarks/`）及独立 Rust CLI 工程目录（`crates/skill-cli/`），使 AI Agent 与开发者无需启动 Chrome 或经过 MV3 扩展，即可直接读写本机 `markbridge.sqlite` 中的**独立本地书签库来源**（`Skills 书签库`，内置默认根文件夹 `Skills 书签` 及任意多层子目录），完成文件夹与书签增删改查、移动排序、本地标签/备注/摘要维护和全文检索；同时支持运行中的 Markbridge 桌面端实时感知外部数据库变更并自动刷新界面。

## 已确认事实与产品决策

1. **产品隔离形态（2026-11-13 用户确认采用推荐方案 A）**：
   - 采用**独立本地书签库来源**（`profile_id = "local-skills"`，显示名称 `Skills 书签库`，内置受保护默认根文件夹 `chrome_id = "skills-root"` / 标题 `Skills 书签`），在工作台左上角来源选择器中与已配对 Chrome Profile 并列展示，不混入已配对 Chrome Profile 左侧目录树。
   - 采用按需初始化（lazy provisioning）：全新空库在未执行 Skill 写入或未在界面显式启用本地库前保持 `profiles` 为空，保留既有首次启动引导（`apps/desktop/src/App.tsx:60` `onboarding` 判定）及全部 E2E 基线行为。
2. **唯一写入与 Schema 兼容边界**：
   - `AGENTS.md` 硬约束要求“扩展是唯一的浏览器写入方，Rust 是唯一的 SQLite 写入方，禁止直接改写 Chrome 的 `Bookmarks` 文件”。
   - `crates/core/src/storage/mod.rs:34,108-118` 当前 `SCHEMA_VERSION = 8`，使用 `rusqlite 0.40.2 (bundled, backup)`，开启 `WAL`、`foreign_keys = ON` 与 `5s busy_timeout`；`007_maintenance.sql:18-24` 定义 `metadata_fts`（`FTS5 tokenize = 'trigram'`），`008_semantic.sql:29-52` 定义 4 个语义失效触发器。Skill 严禁使用 Python/Shell 裸调系统 `sqlite3` 写表，必须经由复用 `markbridge_core::storage::Storage` 的 Rust CLI 执行写入。
   - `001_identity.sql:1-10` 的 `profiles.paired_origin` 列无 SQL 级扩展前缀约束，仅由 `crates/core/src/storage/mod.rs:55-65` 在 Rust 层校验。通过区分 Chrome 配对来源与受控本地常量来源（`markbridge-local://skills`），可**保持 `SCHEMA_VERSION = 8` 零数据库迁移**，避免升级后旧版桌面端触发 `STORAGE_NEWER_SCHEMA` 锁死。
3. **Chrome 同步隔离与桌面端实时刷新机制**：
   - 浏览器全量/增量同步（`crates/core/src/bridge/mod.rs:702-767` `Storage::replace_tree` / `replace_tree_delta`）仅作用于通过 WebSocket 鉴权的 Chrome `profile_id`，物理隔离 `local-skills`。
   - 桌面端 `Bridge::open`（`crates/core/src/bridge/mod.rs:158-202`）在内存中缓存 `ActiveProfile.nodes`；默认数据库路径由 `apps/desktop/src-tauri/src/main.rs:1140-1195` 解析为 `%APPDATA%\com.markbridge.desktop\markbridge.sqlite`（支持 `MARKBRIDGE_APP_DATA` 覆盖）。外部 CLI 提交事务并递增 `source_cursors.revision` 后，桌面端通过 `notify` 监听数据库目录变更及 `RunEvent::Resumed` 重扫重载本地节点并广播 `bridge-state`，前端 `LibraryWorkspace`（`apps/desktop/src/features/library/LibraryWorkspace.tsx:243-267,318-320`）自动重拉。
   - 架构推导与先例证据见 [architecture-analysis.md](research/architecture-analysis.md) 与 [qiaomu-skill-prior-art.md](research/qiaomu-skill-prior-art.md)。

## 需求列表

| ID | 需求描述 | 对应子任务 | 验收标准 |
|---|---|---|---|
| R1 | **本地专属书签库存储合同**：在保持 `SCHEMA_VERSION = 8` 不变的前提下，在 `markbridge-core` 中实现 `local-skills` 本地来源按需初始化、受保护根文件夹 `skills-root`（`Skills 书签`）、多层子文件夹与书签 CRUD、移动/重排、本地标签/备注/摘要写入（同步 `metadata_fts` 与语义触发器）及 `rusqlite::backup` 写前在线备份 | K01 | AC1, AC2 |
| R2 | **独立 Rust Skill CLI（`crates/skill-cli`）**：新建独立文件夹 `crates/skill-cli`（二进制 `markbridge-skill`），提供确定性 JSON 输入/输出子命令（`status`、`init`、`tree`、`list`、`search`、`get`、`mkdir`、`rename-folder`、`move`、`delete`、`add`、`update`、`tag`、`note`、`summary`、`backup`、`export`），强制区分 `--app-data <dir>` 隔离库与显式 `--allow-daily-db` 日常库保护 | K01 | AC1, AC2 |
| R3 | **Chrome 同步与凭据硬隔离**：WebSocket 握手/同步、浏览器写命令（`apply_edit`、`apply_batch_edit`、`apply_title_encoding`、`apply_organization`、`confirm_cleanup`）、重新连接、吊销配对及文件镜像关联均确定性拒绝或跳过 `local-skills`，不读写系统凭据存储 | K01, K02 | AC3 |
| R4 | **桌面端 `BridgeConnection::Local` 与实时感知**：在可信桌面 IPC（`crates/protocol/src/bridge.rs`）新增 `BridgeConnection::Local` 并生成 TS/Schema；`Bridge` 通过 `notify` 监听 SQLite/WAL 变更与 `RunEvent::Resumed` 重扫 `source_cursors.revision`，在外部 CLI 写入后自动更新内存树并推送 `bridge-state`；桌面端支持在连接设置一键初始化本地库并在书签页完整浏览、检索、打标、预览与导出 | K02 | AC4 |
| R5 | **Qiaomu 规范项目内 Skill 独立文件夹**：在 `.agents/skills/qiaomu-markbridge-bookmarks/` 下创建单一根 `SKILL.md` 的 `Governed` 模式包（含 `agents/interface.yaml`、`README.md`、`scripts/mb_bookmarks.py`、`references/`、`evals/`、`reports/`），封装对 `markbridge-skill` 的确定性调用与回滚指引 | K03 | AC5 |
| R6 | **全量质量门禁与隔离端到端验收**：全部 Rust / 前端 / 协议 / E2E 检查与 `qiaomu-meta-skill` 本地门禁通过，并在独立临时 `MARKBRIDGE_APP_DATA` 下完成“桌面端运行中外部调用 Skill 增删改书签 -> 实时可见”端到端验证 | K03 | AC1–AC6 |

## 验收标准

- [x] **AC1（本地库全生命周期与 FTS 一致性）**：在空或已初始化的临时 `markbridge.sqlite` 上运行 Skill 脚本/CLI，可幂等初始化 `local-skills` 与 `skills-root`，完成子文件夹创建、书签增删改查、移动排序、标签增删、备注与摘要维护、分页检索与 `metadata_fts` trigram 检索；`SCHEMA_VERSION` 保持为 `8`，外键与 `008_semantic` 触发器一致。
- [x] **AC2（安全守卫与在线备份）**：删除 `skills-root` 受保护根文件夹、直接修改已配对 Chrome Profile 的缓存树、传入非法 URL（非 `http/https` 或含 userinfo）或未显式声明目标就触碰 `com.markbridge.desktop` 日常库时，CLI 均返回稳定非零退出码与结构化 JSON 错误码且不落脏数据；破坏性删除/批量变更前可通过 `backup` 生成含未 checkpoint WAL 数据的有效 SQLite 备份。
- [x] **AC3（Chrome 零耦合与首次引导保持）**：模拟已配对 Chrome Profile 执行 `TreeFull` 全量替换与增量事件同步时，`local-skills` 中的文件夹、书签、标签与备注 100% 保留；对 `local-skills` 调用任何浏览器写回/配对管理命令均返回 `READ_ONLY` 或 `WRONG_PROFILE`；未初始化 `local-skills` 的全新空库仍正常进入首次连接引导页。
- [x] **AC4（桌面端实时感知与 UI 适配）**：在 `Bridge` / 桌面端运行期间，外部进程通过 `markbridge-skill` 向同一个 `markbridge.sqlite` 写入或修改节点后，桌面端无需重启即可在防抖窗口内自动递增 `revision` 并刷新列表与文件夹树；连接设置页对 `local` 来源隐藏“重新连接/吊销配对”并支持一键初始化与浏览。
- [x] **AC5（Qiaomu Skill 门禁通过）**：`.agents/skills/qiaomu-markbridge-bookmarks/` 通过 `validate_skill.py`、`trigger_eval.py`、`export_skill_ir.py` 与 `release_check.py --phase local`，根入口唯一，不含硬编码密钥、个人隐私路径或未证实的公开声明。
- [x] **AC6（仓库回归与工作树纪律）**：`cargo test`、`pnpm protocol:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过；不触碰日常 Chrome 配置，不改动或覆盖用户工作树中已有的 `10-10-mb-15-semantic-search` 未提交文件。

## 不在范围（Out of Scope）

- 直接读写或改写本机 Chrome 的 `Bookmarks` JSON 文件。
- 绕过 MV3 扩展或用户确认静默修改 Chrome 浏览器内的真实书签树。
- 在已配对 Chrome Profile 左侧目录树内混排挂载虚拟本地文件夹（已按用户决策排除选项 B）。
- 将该 Skill 公开发布至外部 GitHub 仓库、Release 或第三方技能市场。
- 修改、关闭或豁免既有未完成任务（`10-10-mb-13-windows-acceptance` 的 V12、`10-10-mb-15-semantic-search` 的 V18）及原父任务。
- 未经另行授权执行 `git commit`、任务 `archive`、`git push`、日常安装或安装包签名发布。

## 关联文档

- 技术设计：[design.md](design.md)
- 执行计划：[implement.md](implement.md)
- 子任务映射：[task-map.md](task-map.md)
- 验证矩阵：[verification.md](verification.md)
