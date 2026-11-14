# Prior-Art Research Report (`qiaomu-markbridge-bookmarks`)

- **记录日期**：2026-11-13
- **目标技能**：`qiaomu-markbridge-bookmarks` (`v0.1.0`)
- **成熟度层级**：`governed`（项目内生产治理级，涉及本机持久化 SQLite 读写与备份回滚边界）

## 1. 检索范围与指标分离说明

按 `qiaomu-meta-skill` 先例调研规范，分别从 `skills.sh`（`npx --yes skills find`）与 `SkillsMP`（`search_skillsmp.py --sort stars`）采集候选技能，严格区分两类指标，不作混同或伪造综合分：
- **`skills.sh installs`**：技能包安装采用量；
- **`SkillsMP repo_stars`**：源 GitHub 仓库 Star 数（反映宿主项目规模，不等于单技能质量评分）；
- **`public rating`**：两个公开目录均未提供可核验星级评分，统一如实标注为 `rating evidence unavailable`。

## 2. 候选先例对比与取舍矩阵

| 候选技能 | `skills.sh` 安装量 | `SkillsMP` 仓库 Stars | 公开评分 | 关键机制观察 | 决策（Keep / Adapt / Reject） |
|---|---:|---:|---|---|---|
| `karakeep-app/karakeep@karakeep` | 541 | 30,471 | `rating evidence unavailable` | 将书签增删改查、文件夹归档、标签过滤全部下沉到确定性 CLI 子命令与稳定 JSON 输出，避免模型手拼存储结构。 | **Adapt**：采用「精简 `SKILL.md` + `scripts/mb_bookmarks.py` + Rust `markbridge-skill` CLI」分层。 |
| `ginobefun/BestBlogs@bestblogs-capture` | 未收录 | 4,085 | `rating evidence unavailable` | 围绕「收藏这篇 / 打标签 / 记笔记 / 查收藏」设计高频中文口语触发词与单命令原子捕获。 | **Adapt**：支持 `add --title --url --tags --note --summary` 单事务原子写入与中英双语触发描述。 |
| `TriliumNext/Trilium@adding-llm-mcp-tools` | 未收录 | 38,876 | `rating evidence unavailable` | 本地 SQLite 知识库强调受保护系统节点（protected root/system node）拦截与稳定错误码输出。 | **Keep（保留核心守卫理念）**：对 `skills-root` 实施 `PROTECTED_NODE` 拦截，对非 `local-skills` 实施 `WRONG_PROFILE` 拦截。 |
| `cheaper-inference/OmniRoute@omni-db-backups` & `0xdarkmatter/claude-mods@sqlite-ops` | 1,200 / 111 | 86,657 / 未收录 | `rating evidence unavailable` | 对本地 SQLite 执行递归删除或批量变更前先落一致性在线备份，测试强制在隔离目录运行。 | **Adapt**：集成 `rusqlite::backup` 在线 WAL 热备（`backup` 与 `delete --recursive --backup`）及 `--allow-daily-db` 写门禁。 |
| `halcyon666/write-skills@chrome-bookmarks` / `gellenliu/devhelper@chrome-bookmark-reader` | 4–5 | 未收录 | `rating evidence unavailable` | 直接解析并改写本机 Chrome `User Data/Default/Bookmarks` JSON 文件。 | **Reject（明确拒绝）**：直接违反 Markbridge `AGENTS.md`「禁止直接改写 Chrome 的 `Bookmarks` 文件，扩展是唯一浏览器写入方」硬约束。 |

## 3. 针对 Markbridge 的原创架构收敛

1. **物理隔离本地数据源（`local-skills`）**：不向 Chrome Profile 混塞假节点（避免被 `TreeFull` 同步清空），而是在 `profiles` 表注册 `local://skills-library`（`ProfileOrigin::LocalSkills`），100% 复用 `bookmarks_cache`、`bookmark_metadata`、`tags`、`metadata_fts (trigram)` 与语义索引触发器，保持 `SCHEMA_VERSION = 8` 零破坏。
2. **Rust 唯一 SQLite 写入方闭环**：禁止在 Python 脚本中裸调 `sqlite3`，由 `crates/skill-cli` 复用 `markbridge-core::storage::Storage` 工作线程，杜绝 Windows 下 Python 内置 SQLite 缺少 `trigram` 分词器或绕过触发器的问题。
3. **桌面端免重启实时感知（`BridgeConnection::Local`）**：通过 `notify` 监听 `markbridge.sqlite` / `-wal` / `-shm`（120ms 防抖）与窗口 `Resumed` 重扫，外部 Skill 写入后运行中的桌面端自动更新 `revision` 与书签树。

---

Copyright (c) 向阳乔木
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
