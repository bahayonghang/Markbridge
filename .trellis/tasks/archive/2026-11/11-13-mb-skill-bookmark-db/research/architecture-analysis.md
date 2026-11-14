# 架构可行性与实现路径分析（Skill 直连 SQLite 操作独立书签文件夹）

## 1. 已确认的仓库现状与硬约束

1. **数据库路径与隔离机制**
   - 桌面端在 `apps/desktop/src-tauri/src/main.rs:1140-1195` 通过 `app.path().app_data_dir()`（Windows 默认 `%APPDATA%\com.markbridge.desktop\markbridge.sqlite`）打开 SQLite，并支持通过环境变量 `MARKBRIDGE_APP_DATA` 指向独立绝对目录用于测试与验收。
   - 现有 `crates/core/examples/seed_profile_cache.rs:20-28` 已建立安全惯例：测试/夹具工具显式拦截包含 `com.markbridge.desktop` 的日常库路径；真实生产工具则需显式区分日常库与 `--app-data` 隔离库，且写操作前支持 SQLite 在线备份。

2. **“Rust 是唯一的 SQLite 写入方”与底层引擎约束（禁止裸调 `sqlite3` / Python `sqlite3`）**
   - `AGENTS.md` 硬约束明确规定：**“扩展是唯一的浏览器写入方。Rust 是唯一的 SQLite 写入方。前端只消费经过校验的 DTO。”**
   - `crates/core/src/storage/mod.rs:34,108-118` 当前 `SCHEMA_VERSION = 8`，使用 `rusqlite = 0.40.2 (bundled, backup)`，强制开启 `journal_mode = WAL`、`foreign_keys = ON`、`busy_timeout = 5s`。
   - `crates/core/src/storage/migrations/007_maintenance.sql:18-24` 创建了 `metadata_fts USING fts5(..., tokenize = 'trigram')`；`008_semantic.sql:29-52` 在 `bookmark_metadata` 与 `bookmarks_cache` 上挂载了 4 个语义索引失效触发器（`AFTER INSERT/UPDATE/DELETE`）。
   - **技术结论**：如果 Skill 脚本直接用系统 `sqlite3` 或 Python 内置 `sqlite3` 写表，在 Windows 环境下极易因缺少 `trigram` 分词器或 SQLite 版本不一致而在触发器/FTS 同步阶段直接报错，还会绕过 `markbridge_protocol` 的 `Id`、`Title`、`Url`、`Position` 与 `node_json` 校验。因此，“直接操作数据库”的正确工程落地必须是：**Skill 调用本仓库编译的受控 Rust CLI（复用 `markbridge_core::storage::Storage`）直连 `markbridge.sqlite`**，无需启动 Chrome 或经过 MV3 扩展。

3. **为什么必须“创建一个单独的文件夹/空间”（Chrome 同步覆盖陷阱）**
   - `crates/core/src/storage/migrations/001_identity.sql:1-33` 中，现有书签存于 `profiles` + `bookmarks_cache(profile_id, source_epoch, chrome_id)`，且 `PairedOrigin::new`（`crates/core/src/storage/mod.rs:56-65`）强制要求 `chrome-extension://[a-p]{32}`。
   - 当 Chrome 扩展连接并发送 `WireMessage::TreeFull`（`crates/core/src/bridge/mod.rs:702-767`）时，`Storage::replace_tree` 会以 Chrome 真实书签树为准原子替换整个 `profile_id` 的缓存，将不在 Chrome 中的节点标记为墓碑（`deleted_at`）。
   - 若直接往已配对 Chrome Profile 的普通缓存目录塞入节点，下次 Chrome 同步时会被立刻抹除；反之若写回 Chrome，则违反“写入 Chrome 前必须有用户确认的 apply 且只能经扩展调用 `chrome.bookmarks`”的硬约束。
   - **因此用户提出的“创建一个单独的文件夹，实际上是直接操作数据库”完全命中核心架构矛盾**：为 Skills 建立一个与 Chrome 同步树解耦的专属本地文件夹/空间，所有增删改查、子目录管理、标签与备注全部直接落盘本机 SQLite，既不触碰 Chrome，也不会被 Chrome 同步冲掉。

4. **桌面端运行时的并发读写与 UI 实时刷新问题**
   - **SQLite 并发安全**：因 `Storage::open` 已开启 `WAL` + `5s busy_timeout`，外部 Rust Skill CLI 与正在运行的 Tauri 桌面进程可安全并发读写同一个 `markbridge.sqlite`。
   - **内存态陈旧问题**：`Bridge::open`（`crates/core/src/bridge/mod.rs:158-202`）在桌面端启动时将 `ActiveProfile.nodes` 读入内存，后续 `tree`、`list`、`search`、`get`、`count`（`crates/core/src/bridge/mod.rs:458-521`）均直接读内存 `profile.nodes`，仅 `query_library` 查库且依赖 `BridgeProfile.revision` 触发前端 `useLibraryQuery` 重拉（`apps/desktop/src/features/library/LibraryWorkspace.tsx:243-267,318-320`）。
   - **刷新方案**：复用 `markbridge-core` 已有的 `notify = 6.1.1` 文件监听能力（参考 `crates/core/src/bridge/file_mirror.rs`）及窗口恢复事件 `RunEvent::Resumed`（`apps/desktop/src-tauri/src/main.rs:1152-1160`），监听 `markbridge.sqlite` / `-wal` 变化并结合 SQLite `PRAGMA data_version`（或 `settings` 表中的本地版本号）做防抖检测：一旦检测到外部 Skill CLI 提交了新事务，`Bridge` 自动从 `Storage` 重载本地书签树、递增 `revision` 并向 `main` 窗口广播 `bridge-state`，前端无需重启即可实时看到 Skill 新增/修改的书签与文件夹。

---

## 2. “单独的文件夹”两种产品/数据隔离形态对比

### 形态 A（推荐）：独立本地数据源（Local Space / Local Profile）+ 内置根文件夹树
- **表现形式**：在数据库提供专属本地来源（如 `profile_id = "local-skills"`，显示名如 `Skills 书签库`，内含默认根文件夹 `Skills 书签` 并支持任意多层子文件夹）。用户在工作台左上角来源选择器切换到该本地库（若尚未配对 Chrome，打开应用默认即可浏览它）。
- **实现要点**：
  - 数据库存储层允许唯一的本地内置 Profile 身份（例如受控常量 `local://skills` 或迁移 `009_local_skills_space.sql` 显式区分 `profile_kind IN ('chrome', 'local')`），完全复用现有 `bookmarks_cache`、`bookmark_metadata`、`tags`、`bookmark_tags`、`metadata_fts` 与 `Storage::query_library`！
  - `Bridge` 将本地空间的连接状态呈现为本地就绪态（不走 WebSocket 配对，不向扩展发命令，桌面端可选支持本地直接编辑或只读浏览 + 标签备注编辑）。
- **优势**：
  - **100% 物理隔离 Chrome 同步**：`replace_tree` / `replace_tree_delta` 永远只作用于 Chrome `profile_id`，零误删、零串写风险。
  - **改动面最小、复用率最高**：搜索、分页、标签过滤、备注/摘要 trigram FTS5、网页预览、内容预览全部开箱即用，无需改动 MV3 扩展。
  - **无 Chrome 亦可独立使用**：新环境未配对浏览器时，Skill 与桌面端立即可用。
- **代价**：与 Chrome Profile 分属不同来源，需在左上角切换来源查看，不能与 Chrome 书签栏在同一次单 Profile 搜索中混排。

### 形态 B：在当前已配对 Chrome Profile 树内挂载受保护的本地根文件夹（如与「书签栏 / 其他书签」并列的「Skills 书签」）
- **表现形式**：不切换来源，直接在当前 Profile 左侧文件夹树中出现一个固定本地根文件夹（如 `chrome_id = "local:skills-root"`，标题 `Skills 书签`），其下子文件夹和书签均使用 `local:*` ID。
- **优势**：无需切换来源，同一个视图下同时浏览/搜索 Chrome 书签与 Skills 书签。
- **代价与风险**：
  - 必须改造 `Storage::replace_tree` 与 `replace_tree_delta`，在每次 Chrome 全量/增量同步时显式保留 `local:*` 节点不落墓碑；
  - 必须在 `editing::plan`、`batch_edit`、`organization`、`maintenance`（重复链接清理）、`export_html` 中全面增加跨命名空间守卫（严禁把 `local:*` 节点下发给扩展调用 `chrome.bookmarks`，严禁把 Chrome 节点移入 `local:*` 文件夹或反之）；
  - 若用户尚未配对任何 Chrome Profile，仍需兜底虚拟 Profile 才能展示。

---

## 3. Rust CLI + Project Skill 分层架构草案

```text
[AI Agent (Codex / Claude / Antigravity / Cursor)]
        │  触发项目内 Skill (.agents/skills/qiaomu-markbridge-bookmarks/SKILL.md)
        ▼
[Skill Deterministic Wrapper (scripts/mb_bookmarks.py)]
        │  参数校验 / 默认隔离保护 / JSON 输出格式化
        ▼
[Rust CLI Binary (cargo run -q -p markbridge-core --bin markbridge-skill -- ... 或独立 crates/skill-cli)]
        │  唯一 SQLite 写入方：复用 Storage Worker + rusqlite(bundled) + FTS5 trigram + 触发器 + 在线备份
        ▼
[markbridge.sqlite (WAL 模式)]  ───(notify WAL 监听 + data_version 防抖)───▶ [运行中的 Markbridge 桌面端实时刷新 UI]
```

### 计划支持的 Skill / CLI 核心原子操作
1. `status`：查看本地书签空间状态、数据库路径（脱敏摘要）、文件夹与书签计数、Schema 版本。
2. `tree` / `list` / `search` / `get`：浏览专属文件夹树、分页列出子项、按关键词 + 标签 + 备注/摘要（FTS5 trigram）检索书签详情。
3. `mkdir` / `rename-folder` / `move` / `rmdir`：在专属文件夹内创建、重命名、移动、删除子文件夹（带非空保护或显式递归参数 + 操作前自动快照/备份）。
4. `add` / `update` / `remove`：新增书签（校验 `http/https` URL、标题、目标子文件夹、位置）、修改标题/URL/目录、软删除或恢复书签。
5. `tag` / `note` / `summary`：为书签增删改查本地标签、写入备注与摘要（自动同步 `metadata_fts` 与语义索引失效状态）。
6. `backup` / `export`：通过 `rusqlite::backup` 生成一致性 SQLite 备份或导出专属文件夹的 Netscape HTML / JSON。
