# 技术设计（Markbridge 项目内书签操作 Skill 与本地数据库专夹）

## 1. 架构边界与模块职责

```text
.agents/skills/qiaomu-markbridge-bookmarks/   ── Qiaomu Governed Skill 包（路由、契约、Python 确定性包装器、评估与报告）
        │  JSON CLI 调用（默认要求显式 --app-data 或 --allow-daily-db）
        ▼
crates/skill-cli/ (bin: markbridge-skill)     ── 独立 Rust CLI 工程目录；参数解析、路径安全门禁、JSON 输出契约
        │  异步调用唯一 SQLite 写入层
        ▼
crates/core/src/storage/local_space.rs        ── local-skills 空间生命周期、文件夹/书签事务、标签备注复用、在线备份
        │  WAL 模式 + source_cursors.revision 单调递增
        ▼
%APPDATA%\com.markbridge.desktop\markbridge.sqlite (或 MARKBRIDGE_APP_DATA/markbridge.sqlite)
        │  notify 监听数据库目录 (-wal / 主文件) + RunEvent::Resumed 重扫
        ▼
crates/core/src/bridge/ + apps/desktop/       ── BridgeConnection::Local 状态映射、内存树热重载、UI 来源浏览与初始化
```

| 模块路径 | 归属子任务 | 核心职责 |
|---|---|---|
| `crates/core/src/storage/local_space.rs`（及 `storage/mod.rs` 导出） | K01 | 维护 `local-skills` 专属 Profile、受保护根文件夹 `skills-root`、本地树拓扑校验、节点 CRUD、移动重排、`source_cursors.revision` 原子递增及 `rusqlite::backup` 快照 |
| `crates/skill-cli/` | K01 | Workspace 新增独立二进制包 `markbridge-skill`；提供完整无头 JSON CLI，严格限制只操作 `local-skills` |
| `crates/protocol/src/bridge.rs` & `packages/protocol/` | K02 | 在可信桌面 IPC `BridgeConnection` 枚举新增 `Local`（`"local"`），重生成 JSON Schema、TS 类型与静态校验器 |
| `crates/core/src/bridge/`（`mod.rs`、`local_watch.rs` 等） | K02 | 加载/初始化 `local-skills`，拦截浏览器写回/配对动作，通过 `notify` + `cursor` 版本对比热重载外部 CLI 写入并发布 `bridge-state` |
| `apps/desktop/src/` & `apps/desktop/src-tauri/src/main.rs` | K02 | 新增 `ensure_local_library` Tauri 命令（仅 `main` 窗口可调）；适配 `source-status.ts`、`App.tsx`、`ConnectionSettings.tsx`、`LibraryWorkspace.tsx` |
| `.agents/skills/qiaomu-markbridge-bookmarks/` | K03 | 按 `qiaomu-meta-skill` `Governed` 标准交付完整 Skill 包、包装脚本、评估集与验证报告 |

---

## 2. 数据库存储合同（保持 `SCHEMA_VERSION = 8` 零迁移）

### 2.1 专属身份常量
- **`LOCAL_SKILLS_PROFILE_ID`**：`"local-skills"`（合法 `Id`）
- **`LOCAL_SKILLS_INSTANCE_ID`**：`"local-skills"`（合法 `Id`）
- **`LOCAL_SKILLS_ORIGIN`**：`"markbridge-local://skills"`
- **`LOCAL_SKILLS_SESSION_ID`**：`"local-skills"`
- **`LOCAL_SKILLS_DISPLAY_NAME`**：`"Skills 书签库"`
- **`LOCAL_SKILLS_ROOT_FOLDER_ID`**：`"skills-root"`（默认根文件夹标题 `"Skills 书签"`，`parent_id = NULL`，`position = 0`，`node_kind = 'folder'`）

### 2.2 为什么零数据库迁移且完全安全
1. `001_identity.sql` 中 `profiles.paired_origin` 为普通 `TEXT NOT NULL`；在 `crates/core/src/storage/mod.rs` 中保留 `PairedOrigin`（仅接受 `chrome-extension://[a-p]{32}`，继续用于所有 WebSocket 握手与 Chrome Profile 创建），同时为 `StoredProfile` 引入 `ProfileOrigin` 枚举：
   - `ProfileOrigin::Chrome(PairedOrigin)`
   - `ProfileOrigin::LocalSkills`（精确匹配 `"markbridge-local://skills"` 且要求 `id == "local-skills"` 且 `credential_reference.is_none()`）
2. WebSocket 传输层 `transport.rs` 仍使用 `PairedOrigin::new` 解析 HTTP `Origin` 请求头，任何外部 WebSocket 客户端均不可能通过 `"markbridge-local://skills"` 鉴权。
3. `SCHEMA_VERSION` 保持 `8`，不触发升级迁移，已安装的 v8 桌面端二进制也可安全打开同一数据库而不报 `STORAGE_NEWER_SCHEMA`。

### 2.3 事务与索引不变式
- **按需幂等初始化（`Storage::ensure_local_skills_space`）**：在单个写事务内确保 `profiles("local-skills")`、`bookmarks_cache("skills-root")` 与 `source_cursors("local-skills")` 存在；若已存在则无副作用返回当前状态与 `revision`。
- **写操作原子性**：每次文件夹或书签增删改/移动重排，均在单个 `Storage` 串行工作线程事务内：
  1. 校验 `profile_id == "local-skills"`（严禁通过本地直写接口修改任何 `ProfileOrigin::Chrome` 的缓存树）；
  2. 保护根文件夹 `skills-root` 不可删除、不可移动到其他父节点、不可改为书签节点；所有新建节点必须位于 `skills-root` 或其后代文件夹下，严禁产生环、悬空 `parent_id`、把书签当父节点或同级 `position` 冲突（复用 `TreeSnapshot` 拓扑规则，节点上限 `100_000`、深度上限 `256`）；
  3. 同步维护同级 `position` 连续性（`0..N-1`）与 `node_json`（完整序列化 `BookmarkNode`）；
  4. 删除文件夹时：默认非空拒绝（返回 `CONFLICT`），显式传入 `recursive = true` 时在单事务内将子树节点标记 `deleted_at = now`（保留墓碑以兼容外键与历史引用），并清理或保留关联元数据；
  5. 递增 `source_cursors.revision` 与 `last_seq`，更新 `profiles.last_synced_at = now`。
- **标签、备注与摘要**：
  - 标签与备注直接复用 `Storage::mutate_tags` / `Storage::tag_catalog`（自动同步 `metadata_fts` trigram 索引与 `tag_journal`）；
  - 摘要写入复用 `Storage::set_summary`（自动同步 `metadata_fts` 并触发 `008_semantic.sql` 失效触发器）。
- **写前在线备份（`Storage::backup_database`）**：复用 `rusqlite::backup::Backup`，支持在批量删除或移动前将含未 checkpoint WAL 的一致性快照写入 `{app_data}/backups/skill-backup-{timestamp}-{nonce}.sqlite`（不覆盖已有文件，不在 DTO/日志中暴露敏感正文）。

---

## 3. `crates/skill-cli` 命令行契约

二进制名称：`markbridge-skill`（位于 `crates/skill-cli/src/main.rs`）。

### 3.1 全局安全参数
- `--app-data <ABS_PATH>`（或环境变量 `MARKBRIDGE_APP_DATA`）：指定包含 `markbridge.sqlite` 的绝对目录。若路径不含 `com.markbridge.desktop`，视为隔离环境直接放行。
- `--allow-daily-db`：当未传 `--app-data`（默认解析至 Windows `%APPDATA%\com.markbridge.desktop`）或路径指向日常库时，**读命令默认允许，任何写命令必须显式附带 `--allow-daily-db`**（Skill 包装脚本在用户明确操作应用书签库时传入，在自动化评估/单测中永不传入，从根源杜绝测试污染日常数据）。

### 3.2 子命令与输出格式
所有子命令标准输出均为单行或格式化 UTF-8 JSON：
- 成功：`{"ok": true, "command": "<cmd>", "revision": 3, "data": { ... }}`，退出码 `0`
- 失败：`{"ok": false, "errorCode": "INVALID_MESSAGE" | "PROTECTED_NODE" | "CONFLICT" | "READ_ONLY" | ..., "message": "<脱敏说明>"}`，退出码非 `0`

支持子命令：
1. `status`：返回数据库是否存在、`local-skills` 是否已初始化、`schemaVersion`、文件夹数、书签数、标签数、当前 `revision`（不输出完整本地隐私路径或凭据）。
2. `init`：幂等创建 `local-skills` 与 `skills-root`（`Skills 书签`）。
3. `tree [--folder-id <id>] [--depth <n>]`：返回文件夹及书签层级或扁平节点列表。
4. `list [--folder-id <id>] [--offset <n>] [--limit <n>]`：分页列出指定文件夹子项（默认 `skills-root`）。
5. `search [--query <text>] [--folder-id <id>] [--scope all|subtree|children] [--tag <name_or_id>] [--include-summary] [--include-note] [--limit <n>] [--offset <n>]`：直接调用 `Storage::query_library`（支持标题、URL、标签交集及 `metadata_fts` trigram 备注/摘要搜索）。
6. `get --id <chrome_id>`：返回单节点详情、祖先路径、标签、备注与摘要。
7. `mkdir --title <title> [--parent-id <id>] [--position <n>]`：在 `skills-root`（默认）或指定子文件夹下创建新文件夹（生成形如 `local-f:<hex>` 的唯一 `chrome_id`）。
8. `add --title <title> --url <http_or_https_url> [--parent-id <id>] [--position <n>] [--tags <t1,t2>] [--note <text>] [--summary <text>]`：一站式校验 `http/https` URL（拒绝 userinfo 与控制字符，复用桌面端 URL 安全规则），插入书签（`local-b:<hex>`）并可选在同次操作写入标签、备注与摘要。
9. `update --id <chrome_id> [--title <title>] [--url <url>]`：重命名文件夹/书签或更新书签 URL（禁止修改 `skills-root` 类型）。
10. `move --id <chrome_id> --parent-id <folder_id> [--position <n>]`：移动文件夹或书签并重排同级 `position`（拦截环路与 `skills-root` 移动）。
11. `delete --id <chrome_id> [--recursive] [--backup]`：删除书签或文件夹（非空文件夹未传 `--recursive` 返回 `CONFLICT`；传 `--backup` 先执行 SQLite 在线备份）。
12. `tag <add|remove|rename|delete|list> ...`、`note --id <chrome_id> --text <note>`、`summary --id <chrome_id> --text <summary>`：维护本地侧车元数据。
13. `backup` / `export --format html|json --output <abs_file>`：执行一致性 SQLite 备份或导出 `local-skills` 书签数据。

---

## 4. 桌面端实时感知与界面集成设计

### 4.1 协议扩展（`crates/protocol` & `packages/protocol`）
- 在 `crates/protocol/src/bridge.rs` 的 `BridgeConnection` 枚举新增 `Local`（序列化为 `"local"`）。
- 运行 `pnpm protocol:generate` 同步更新 JSON Schema、TypeScript 类型与静态 Ajv 校验器，确保 `pnpm protocol:check` 零漂移。
- MV3 扩展只消费 `wire.rs` 协议，不受 `BridgeConnection::Local` 影响。

### 4.2 `Bridge` 本地空间加载、保护与外部写入监听
- **启动加载**：`Bridge::open_with_ai` 读取 `storage.profiles()` 时，若存在 `ProfileOrigin::LocalSkills`，将其构建为 `connection: BridgeConnection::Local` 的 `ActiveProfile`；若不存在则不自动注入，保持空库 `profiles: []`。
- **显式初始化命令**：`Bridge::ensure_local_library(&self) -> Result<BridgeState>`（对应主窗口 Tauri 命令 `ensure_local_library`），供桌面端用户在尚未使用 CLI 时也可一键开启 `Skills 书签库`。
- **浏览器路径硬拦截**：
  - `revoke_pairing`、`reconnect_profile`、`associate_file_mirror`、`preview_edit`（`writable: false`）、`apply_edit`、`preview_batch_edit`（`writable: false`）、`apply_batch_edit`、`preview_title_encoding`、`apply_title_encoding`、`propose_organization`、`apply_organization`、`confirm_cleanup` 遇到 `local-skills` 一律返回 `ErrorCode::ReadOnly`（或只读预览），绝不写 `operations` 浏览器队列或系统凭据。
  - 查询、详情、本地标签/备注（`tag_state` / `tag_command`，拦截 `SetEncoding`）、全文检索、内容预览、独立网页预览、HTML/Sidecar 导出全部对 `local-skills` 正常开放。
- **外部数据库写入实时感知（`notify` + `Resumed`）**：
  - `Bridge::open_with_ai` 在数据库所在父目录上启动轻量 `notify::RecommendedWatcher`（过滤文件名为 `markbridge.sqlite`、`markbridge.sqlite-wal`、`markbridge.sqlite-shm` 的写入事件，合并 120ms 防抖窗口），并在 `apps/desktop/src-tauri/src/main.rs` 的 `RunEvent::Resumed` 中同步调用 `bridge.reload_local_space()`。
  - `reload_local_space()` 查询 `storage.local_skills_snapshot()`：
    - 若此前内存中无 `local-skills` 而数据库中已创建：加载节点并插入 `inner.profiles`，调用 `self.publish(&mut inner)`；
    - 若数据库中 `cursor.revision != in_memory_revision`（或侧车元数据更新时间变化）：更新 `profile.nodes`、`node_count`、`revision`、`last_synced_at`，调用 `self.publish(&mut inner)` 向主窗口发送 `bridge-state` 事件。
  - `Bridge::shutdown` 时先停止该 watcher 再关闭 `Storage`，确保临时目录测试退出后无句柄残留。

### 4.3 前端状态文案与交互适配
- `apps/desktop/src/features/settings/source-status.ts`：
  - `connectionLabels.local = '本地书签库'`
  - `profileNextStep('local') = '由本机 SQLite 直接存储，可通过项目 Skill 增删改查，不会同步或改写 Chrome。'`
- `apps/desktop/src/App.tsx`：顶栏连接状态在选中 `local` 来源时显示 `'本地书签库 · 数据库直连'`。
- `apps/desktop/src/features/library/LibraryWorkspace.tsx`：`accessNote` 对 `local` 来源显示 `'本地专属书签库。可通过项目 Skill 管理节点，本页可直接维护标签与备注。'`，并隐藏针对 Chrome 的新建/批量移动删除入口（或保持只读提示），标签与备注面板完整可用。
- `apps/desktop/src/features/settings/ConnectionSettings.tsx`：
  - 对 `profile.connection === 'local'` 卡片保留“浏览此资料”，隐藏“重新连接”与“吊销配对”，并在只读镜像“验证关联”下拉框中过滤掉 `local` 来源；
  - 若当前尚未创建 `local-skills`，在连接设置页提供轻量“启用本地 Skills 书签库”入口按钮，点击即调用 `ensure_local_library` 并可一键跳转浏览。

---

## 5. Qiaomu Skill 包设计（`.agents/skills/qiaomu-markbridge-bookmarks/`）

遵循 `qiaomu-meta-skill` 单一根入口与 `Governed` 门禁规范：

1. **命名与元数据**：
   - 包名：`qiaomu-markbridge-bookmarks`（满足中文场景优先、`qiaomu-` 前缀且不超过 3 个连字符段）。
   - 版权信息：按 `qiaomu-meta-skill` 默认规范包含 `Copyright (c) 向阳乔木`、`https://x.com/vista8`、`https://github.com/joeseesun/`。
2. **目录与资源职责分离**：
   - `SKILL.md`：仅放精准 frontmatter `description`（中英自然触发词 + 明确排除项：排除直接改写 Chrome `Bookmarks` 文件、排除未配对浏览器实时同步配置、排除通用网页抓取）、最小工作流、常用命令速查与安全硬边界。
   - `agents/interface.yaml`：声明输入输出契约、工具权限（本地进程调用 `markbridge-skill`、本地 SQLite 读写）与回滚边界。
   - `scripts/mb_bookmarks.py`：确定性跨平台包装器。优先查找预编译的 `target/release/markbridge-skill(.exe)` 或 `target/debug/markbridge-skill(.exe)`，若不存在或源码更新则自动执行 `cargo build --quiet -p markbridge-skill-cli` 后调用二进制，透传结构化 JSON 输出与退出码，并提供 `--self-test`（在自动创建的 `tempfile.TemporaryDirectory` 下跑通完整 CRUD 自检，零污染日常库）。
   - `references/command-contract.md` & `references/safety-and-rollback.md`：详细参数表、错误码恢复策略、备份还原步骤。
   - `evals/trigger_cases.json` & `evals/output_cases.json`：覆盖正向触发、负向排除（如“帮我直接改 Chrome Bookmarks 文件”、“给扩展生成配对码”）与近邻边界用例。
   - `reports/`：保存 `prior-art-research.md`、`skill-ir.json`、`trigger-eval.json`、`creation-handoff.md`（如实标注未执行的外部发布/真实安装门禁为 `missing evidence`）。
   - `README.md`：面向项目使用者的产品级说明（价值、前置条件、自然对话示例、命令示例、风险与排障），不复制粘贴 `SKILL.md`。

---

## 6. 兼容性、风险与回滚方案

1. **零日常数据风险**：所有开发、单测、E2E 与 Skill 评估均强制注入临时 `--app-data` / `MARKBRIDGE_APP_DATA`；CLI 对不含 `--allow-daily-db` 的日常库写请求直接拒绝。
2. **Windows 文件句柄释放**：`notify` watcher 在 Windows 下若监听文件本体偶发阻止临时目录清理，实现时监听 `markbridge.sqlite` 所在目录（`RecursiveMode::NonRecursive`）并在 `Bridge::shutdown` 中显式 drop watcher、等待后台任务退出。
3. **回滚路径**：
   - 由于 `SCHEMA_VERSION` 保持 `8` 且不改既有表结构，代码回滚后无需降级数据库；若在日常库创建过 `local-skills`，可通过备份恢复或单条受控清理移除 `profile_id = 'local-skills'` 相关行，不影响任何已配对 Chrome Profile。
