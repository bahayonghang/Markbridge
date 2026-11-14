# 子任务映射（Task Map）

父任务 `11-13-mb-skill-bookmark-db` 仅负责需求收敛、跨层架构设计与最终集成核验，不执行 `task.py start`。实施获批后严格按 `K01 → K02 → K03` 顺序逐一启动并通过验收。

| 顺序 | 子任务目录 | 交付边界 | 覆盖父需求 | 启动前置条件 |
|---|---|---|---|---|
| 1 | [11-13-mb-k01-local-skill-cli](../11-13-mb-k01-local-skill-cli/prd.md) | `crates/core` 本地专属书签库存储（保持 `SCHEMA_VERSION = 8`）+ 独立目录 `crates/skill-cli`（`markbridge-skill` JSON CLI、路径隔离守卫、在线备份与 Rust 测试） | R1, R2, R3（存储层） | 用户明确批准父子完整规划 |
| 2 | [11-13-mb-k02-desktop-local-sync](../11-13-mb-k02-desktop-local-sync/prd.md) | `BridgeConnection::Local` 协议同步、`Bridge` 外部 SQLite 变更实时感知（`notify` + `Resumed`）、浏览器写回硬拦截与桌面端 UI 浏览/初始化适配 | R3（桥接与前端）, R4 | K01 全部自动检查与阶段验收 PASS |
| 3 | [11-13-mb-k03-qiaomu-bookmark-skill](../11-13-mb-k03-qiaomu-bookmark-skill/prd.md) | 独立目录 `.agents/skills/qiaomu-markbridge-bookmarks/`（Qiaomu `Governed` 包、`mb_bookmarks.py`、触发/输出评估、Skill IR）及全仓集成验收 | R5, R6（及 R1–R6 端到端集成） | K02 全部自动检查与阶段验收 PASS |

注：本父子任务树独立于原 `10-10-markbridge-workspace`；原 `13/V12` 与 `15/V18` 验收状态保持不变。
