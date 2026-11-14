# K01 本地专属书签库存储与 Rust Skill CLI

## 目标与前置条件

交付父任务 [11-13-mb-skill-bookmark-db](../11-13-mb-skill-bookmark-db/prd.md) 的 R1、R2 及存储层 R3：在保持 `SCHEMA_VERSION = 8` 零迁移兼容的前提下，于 `markbridge-core` 实现独立本地书签库来源 `local-skills`（内置受保护根文件夹 `skills-root` / `Skills 书签`）的完整事务存储，并在新建独立目录 `crates/skill-cli` 下交付无头 JSON 命令行工具 `markbridge-skill`。

- **启动前置条件**：用户在后续消息中明确批准父子完整规划摘要；实施前执行 `task.py start .trellis/tasks/11-13-mb-k01-local-skill-cli`。

## 需求范围

1. **K01-R1（`ProfileOrigin` 与 `local-skills` 按需初始化）**：
   - 在 `crates/core/src/storage/mod.rs` 保持 Chrome `PairedOrigin::new`（`chrome-extension://[a-p]{32}`）不变，为 `StoredProfile` 区分 `ProfileOrigin::Chrome(PairedOrigin)` 与 `ProfileOrigin::LocalSkills`（仅匹配 `id == "local-skills"`、`paired_origin == "markbridge-local://skills"` 且 `credential_reference IS NULL`）。
   - 提供 `Storage::ensure_local_skills_space()`：单事务幂等写入 `profiles("local-skills")`、根文件夹 `bookmarks_cache(chrome_id="skills-root", title="Skills 书签", node_kind="folder", parent_id=NULL, position=0)` 与 `source_cursors("local-skills")`；`SCHEMA_VERSION` 保持 `8`。
2. **K01-R2（专属树 CRUD、元数据与备份存储接口）**：
   - 在 `crates/core/src/storage/local_space.rs` 提供仅针对 `local-skills` 的文件夹创建、重命名、书签创建/更新、同级与跨目录移动重排、书签/文件夹删除（非空文件夹默认返回 `CONFLICT`，显式 `recursive=true` 时单事务墓碑化子树），每次变更原子递增 `source_cursors.revision` 与 `last_seq` 并更新 `profiles.last_synced_at`。
   - 保护 `skills-root` 不可删除、不可挂到其他父节点、不可改为书签；拒绝任何针对 Chrome Profile 的本地直写调用。
   - 标签、备注、摘要与分页检索直接复用 `Storage::mutate_tags`、`Storage::tag_catalog`、`Storage::set_summary`、`Storage::query_library`（确保 `metadata_fts` trigram 与 `008_semantic.sql` 触发器完整同步）。
   - 提供 `Storage::backup_database(dest)`（基于 `rusqlite::backup::Backup` 生成不覆盖已有文件的完整快照）。
3. **K01-R3（独立目录 `crates/skill-cli` 与安全门禁）**：
   - Workspace 新增成员 `crates/skill-cli`（二进制 `markbridge-skill`），支持全局 `--app-data <ABS_DIR>`（及 `MARKBRIDGE_APP_DATA`）与 `--allow-daily-db`。当目标路径包含 `com.markbridge.desktop`（或默认解析至日常库）且执行写子命令时，未传 `--allow-daily-db` 必须立即返回错误且不打开写事务。
   - 实现结构化 JSON 输出子命令：`status`、`init`、`tree`、`list`、`search`、`get`、`mkdir`、`add`、`update`、`move`、`delete`、`tag`、`note`、`summary`、`backup`、`export`。
   - `add`/`update` 对书签 URL 执行严格的 `http://` / `https://`、无 userinfo、无控制字符校验，日志与错误输出遵守脱敏规范。

## 验收标准

- [x] **AC-K01-1**：在空临时目录运行 `markbridge-skill --app-data <tmp> init/mkdir/add/update/move/delete/tag/note/summary/search/get/tree/list`，所有命令返回 `{"ok": true, ...}` JSON；`SCHEMA_VERSION` 仍为 `8`，`metadata_fts` trigram 可命中 1–2 字及 3+ 字备注/摘要，更新标题或摘要时 `008_semantic` 触发器正常生效无报错。
- [x] **AC-K01-2**：尝试删除/移动 `skills-root`、在非空目录不带 `--recursive` 删除、构造父子环路、将书签作为父目录、传入 `javascript:` / `file:` / 带 `user:pass@` 的 URL、或尝试修改同库内已存在的 Chrome Profile 节点时，全部返回对应 `ErrorCode` 且事务回滚无残留。
- [x] **AC-K01-3**：未传 `--allow-daily-db` 对含 `com.markbridge.desktop` 的路径执行写子命令被确定性拒绝；`backup` 子命令可将含未 checkpoint WAL 写入的数据完整备份至新文件并可独立打开验证。
- [x] **AC-K01-4**：`cargo test --workspace` 全部通过，阶段验证收据落盘于 `evidence/`。

## 不在范围

- `crates/protocol` / `packages/protocol` 变更、`Bridge` 文件监听与前端界面修改（归属 K02）。
- `.agents/skills/` 下的 Skill 包封装与 `qiaomu-meta-skill` 评估脚本执行（归属 K03）。
