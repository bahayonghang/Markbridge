# qiaomu-markbridge-bookmarks

为 **Markbridge（签桥）** 桌面书签工作台打造的项目级本地书签操作技能包。通过确定性脚本 `scripts/mb_bookmarks.py` 调用工作区 Rust 二进制 `markbridge-skill` 直接读写 `markbridge.sqlite` 中的隔离专属空间 `Skills 书签库`（`profileId = "local-skills"`，根文件夹 `Skills 书签`），无需打开 Chrome 浏览器、无需配对 MV3 扩展，且正在运行的 Markbridge 桌面端会在约 120ms 内自动热刷新显示新书签。

## 为什么需要独立的 `Skills 书签库`？

Markbridge 中已配对的 Chrome Profile 以浏览器扩展同步的真实树为准（全量同步会覆盖未在浏览器中存在的节点），且 `AGENTS.md` 硬约束禁止直接改写 Chrome 的 `Bookmarks` 文件或未经用户确认写回浏览器。

`qiaomu-markbridge-bookmarks` 采用**物理隔离的本地数据源方案**：
- 专属来源：`profileId = "local-skills"`（显示名 `Skills 书签库`，连接状态 `本地书签库`）
- 受保护根文件夹：`chromeId = "skills-root"`（标题 `Skills 书签`），支持任意多层子文件夹
- 完整侧车能力：复用 `rusqlite (bundled)`、WAL 并发模式、标签归一化、备注/摘要 FTS5 `trigram` 全文索引与 `rusqlite::backup` 在线热备

## 安装与位置（Installation）

本技能已内置于 Markbridge 仓库的 `.agents/skills/qiaomu-markbridge-bookmarks/`，在仓库内使用支持 Agent Skills 的工具（Antigravity、Claude Code、Codex、Cursor 等）时会自动发现。

若未来将本技能单独同步至公开仓库后跨环境安装，可使用标准安装命令：

```bash
npx skills add <owner>/<repo> --skill qiaomu-markbridge-bookmarks
```

前置环境要求：
- Python `>= 3.10`
- Rust 工具链（`cargo`，首次未编译 `markbridge-skill` 时由包装脚本自动编译 `crates/skill-cli`）

## 你可以直接这样说

在当前项目对话中，你可以直接这样说：

- 「帮我把 `https://tokio.rs/tokio/tutorial` 收藏到签桥的本地书签库，放到『Rust 异步』文件夹，打上 `rust,async` 标签并记一下『官方异步入门教程』」
- 「在 Markbridge 的 Skills 书签专夹下新建『架构参考』和『前端设计』两个目录」
- 「搜一下我在本地书签库里记过『并发读写』笔记的所有书签」
- 「把签桥本地 Skills 书签库导出成一份 HTML 和一份侧车 JSON 到桌面备份目录」
- 「查看当前本地 Skills 书签库有多少个文件夹和书签」

> 在桌面端查看：打开 Markbridge 桌面应用，在左上角书签来源下拉框切换至 **`Skills 书签库（本地库）`**（若首次从空白环境启用，也可在 `设置 -> 连接` 点击 **`启用本地 Skills 书签库`**）。

## 常用命令行速查

```bash
# 1. 在临时隔离目录运行 20 步端到端自检（绝不触碰日常数据库）
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test

# 2. 查看日常库中本地 Skills 书签库状态（只读，不创建空库）
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py status

# 3. 向日常库创建文件夹并收藏书签（写日常库须显式带 --allow-daily-db）
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --allow-daily-db mkdir --title "AI 工程"
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --allow-daily-db add \
  --title "Model Context Protocol" \
  --url "https://modelcontextprotocol.io" \
  --tags "ai,spec" \
  --note "协议规范主页"

# 4. 在指定隔离目录 (--app-data) 操作数据库
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --app-data "D:/Temp/mb-demo" init
```

完整子命令、参数与退出码请查阅 [`references/command-contract.md`](references/command-contract.md)，安全隔离与备份回滚说明请查阅 [`references/safety-and-rollback.md`](references/safety-and-rollback.md)。

## 验证与门禁（Verification）

```bash
# 运行包装器单元测试与端到端隔离自检
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test
python -m unittest discover -s .agents/skills/qiaomu-markbridge-bookmarks/tests -p "test_*.py" -v

# 运行 Qiaomu Skill 包结构校验、触发边界评估、Skill IR 导出与本地门禁审查
python ~/.gemini/antigravity-cli/skills/qiaomu-meta/scripts/validate_skill.py .agents/skills/qiaomu-markbridge-bookmarks
python ~/.gemini/antigravity-cli/skills/qiaomu-meta/scripts/trigger_eval.py .agents/skills/qiaomu-markbridge-bookmarks --cases evals/trigger_cases.json --output reports/trigger-eval.json
python ~/.gemini/antigravity-cli/skills/qiaomu-meta/scripts/export_skill_ir.py .agents/skills/qiaomu-markbridge-bookmarks --output reports/skill-ir.json
python ~/.gemini/antigravity-cli/skills/qiaomu-meta/scripts/release_check.py .agents/skills/qiaomu-markbridge-bookmarks --phase local --run-tests
```

## Troubleshooting

- **报错 `"errorCode": "READ_ONLY"`（退出码 `2`）**：
  - 原因：命令试图修改用户日常数据库（路径含 `com.markbridge.desktop`），但未显式传入 `--allow-daily-db`。
  - 解决：若是用户真实要求写入签桥日常本地库，加上 `--allow-daily-db`；若是测试或演练，改传 `--app-data <绝对临时目录>`。
- **报错 `"errorCode": "PROTECTED_NODE"`（退出码 `2`）**：
  - 原因：试图重命名、移动或删除受保护根文件夹 `skills-root`（`Skills 书签`）。请在 `skills-root` 下操作子文件夹或书签节点。
- **报错 `"errorCode": "CONFLICT"`（退出码 `2`）**：
  - 原因：删除非空文件夹未加 `--recursive`，或 `export` 目标文件已存在且未加 `--overwrite`。删除非空文件夹时请传入 `--recursive --backup <绝对备份路径>`。
- **桌面端未看到 `Skills 书签库`**：
  - 确认操作的目标库与桌面端打开的是同一个 `app-data` 目录；在左上角来源切换器中选择 `Skills 书签库（本地库）`，或在 `设置 -> 连接` 点击 `启用本地 Skills 书签库`。

## 致谢与上游启发（Upstream Inspiration）

架构与触发设计参考并适配了以下开源技能机制（`karakeep-app/karakeep@karakeep, ginobefun/BestBlogs@bestblogs-capture, TriliumNext/Trilium@adding-llm-mcp-tools`）：
- `karakeep-app/karakeep@karakeep`：轻 `SKILL.md` 路由 + 确定性 CLI 子命令与 JSON 输出；
- `ginobefun/BestBlogs@bestblogs-capture`：中文自然表达触发（收藏链接 + 打标签 + 记笔记一体化）；
- `TriliumNext/Trilium@adding-llm-mcp-tools`：本地 SQLite 受保护节点守卫与结构化错误码。

---

Copyright (c) 向阳乔木
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
