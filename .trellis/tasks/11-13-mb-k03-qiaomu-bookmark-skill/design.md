# K03 技术设计（`qiaomu-markbridge-bookmarks` 项目 Skill 包）

## 1. 目录结构

```text
.agents/skills/qiaomu-markbridge-bookmarks/
├── SKILL.md
├── README.md
├── LICENSE
├── agents/
│   └── interface.yaml
├── scripts/
│   └── mb_bookmarks.py
├── references/
│   ├── command-contract.md
│   └── safety-and-rollback.md
├── evals/
│   ├── trigger_cases.json
│   └── output_cases.json
├── tests/
│   └── test_mb_bookmarks.py
└── reports/
    ├── prior-art-research.md
    ├── skill-ir.json
    ├── trigger-eval.json
    └── creation-handoff.md
```

## 2. 触发边界（`SKILL.md` description 设计要点）

- **正向触发**：在 Markbridge 项目中通过 Skill 添加/收藏书签、创建书签文件夹、整理或移动本地书签、给书签打标签/写备注/写摘要、检索本地书签库、备份或导出 Skills 专属书签库（如“帮我把这个链接存到书签应用”、“在书签库建个 Rust 资料文件夹”、“搜一下我收藏过的 Tauri 文章”、“给这条书签加个标签和笔记”）。
- **负向排除（Exclusions）**：
  - 不用于直接读取或修改 Chrome 浏览器的 `Bookmarks` 文件；
  - 不用于配置 Chrome MV3 扩展配对、排查 WebSocket 连接或修改已配对 Chrome Profile 内的浏览器书签树；
  - 不用于通用外部网页爬取或发布外部软件包。

## 3. `scripts/mb_bookmarks.py` 确定性契约

- 自动推导 Markbridge 仓库根目录（向上查找含 `Cargo.toml` 且含 `crates/skill-cli` 的工作区根）。
- 二进制解析优先级：环境变量 `MARKBRIDGE_SKILL_BIN` -> `target/release/markbridge-skill(.exe)`（当不早于 `crates/skill-cli` 与 `crates/core` 源码修改时间）-> `target/debug/markbridge-skill(.exe)` -> 自动执行 `cargo build --quiet -p markbridge-skill-cli` 后使用 debug 二进制。
- 默认安全策略：透传 `--app-data` 与 `--allow-daily-db`；当用户在真实对话中明确要求写入应用日常本地书签库时，按照 `SKILL.md` 规则显式传入 `--allow-daily-db`，而破坏性删除（`delete --recursive`）默认要求带 `--backup`。
