# K01 技术设计（本地专属书签库存储与 Rust Skill CLI）

## 1. 存储层设计（`crates/core/src/storage/`）

- **常量定义**（`crates/core/src/storage/local_space.rs`）：
  - `LOCAL_SKILLS_PROFILE_ID = "local-skills"`
  - `LOCAL_SKILLS_ORIGIN = "markbridge-local://skills"`
  - `LOCAL_SKILLS_ROOT_ID = "skills-root"`
  - `LOCAL_SKILLS_DISPLAY_NAME = "Skills 书签库"`
  - `LOCAL_SKILLS_ROOT_TITLE = "Skills 书签"`
- **`ProfileOrigin` 建模**（`crates/core/src/storage/mod.rs`）：
  - `PairedOrigin` 保持不变，专用于 Chrome 扩展鉴权与 `create_profile`。
  - `StoredProfile` 增加 `pub origin: ProfileOrigin`（`Chrome(PairedOrigin)` | `LocalSkills`），`profiles()` 查询时若 `paired_origin == LOCAL_SKILLS_ORIGIN && id == LOCAL_SKILLS_PROFILE_ID && credential_reference.is_none()` 则解析为 `ProfileOrigin::LocalSkills`，其余走 `PairedOrigin::new`（伪造的本地行直接报错 `InvalidMessage`）。
- **同级 `position` 与拓扑维护**：
  - 每次 `mkdir` / `add` / `move` / `delete` 在 `Storage::call` 单事务内读取 `local-skills` 当前未删除节点，构造变更后的 `Vec<BookmarkNode>`，调用 `TreeSnapshot::validate()` 级别的不变式校验（无重复 ID、无悬空父节点、无环、父节点必为 `Folder`、同级 `position` 从 `0` 连续递增、总节点 ≤ `100_000`、深度 ≤ `256`），通过后再写回受影响行与 `node_json`，并更新 `source_cursors.revision += 1`。
  - 新节点 `chrome_id` 生成规则：文件夹 `local-f:<16位随机小写hex>`，书签 `local-b:<16位随机小写hex>`（满足 `Id` 正则 `^[A-Za-z0-9][A-Za-z0-9._:-]*$`）。

## 2. CLI 设计（`crates/skill-cli/`）

- `Cargo.toml`（根 workspace `members` 加入 `"crates/skill-cli"`）：依赖 `markbridge-core`、`markbridge-protocol`、`serde`、`serde_json`、`tokio`（无需引入重型第三方参数库或仅用最小手写/标准参数解析，保持锁文件精简稳定）。
- **默认数据目录解析**：
  - 若传入 `--app-data <dir>` 或存在 `MARKBRIDGE_APP_DATA`：要求必须为绝对路径。
  - 否则在 Windows 解析 `%APPDATA%\com.markbridge.desktop`（macOS `~/Library/Application Support/com.markbridge.desktop`，Linux `$XDG_DATA_HOME/com.markbridge.desktop` 或 `~/.local/share/com.markbridge.desktop`）。
  - **日常库写保护**：若最终数据库目录字符串（大小写不敏感）包含 `com.markbridge.desktop` 且当前子命令属于写操作（`init`/`mkdir`/`add`/`update`/`move`/`delete`/`tag` 写分支/`note`/`summary`/`backup`），未传 `--allow-daily-db` 时立即输出 `{"ok":false,"errorCode":"READ_ONLY","message":"Daily database write requires --allow-daily-db"}` 并以退出码 `2` 退出。
