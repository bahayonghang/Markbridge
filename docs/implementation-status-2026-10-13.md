# 实施收尾审计（2026-10-13）

上一轮用户授权检查、提交当时改动、归档已完成任务，并准备后续实施 Prompt；相关提交和归档记录在下文。继续实施另获 13→14/15 启动例外、临时安装闭环及必要重测授权。2026-10-13 晚用户再授权拆分提交当时尚未提交的改动，并明确目前默认 Windows、其他平台先不管。该决定只把 14 移出活动队列，不把 V17 记为 PASS，也不豁免 V12 或 V18。未授权 push、发布、签名或日常安装。

## 已完成范围

原计划 01–12 的产品能力均已实现；新版 R01–R08 完成蓝色简洁工作台及连接、浏览搜索、编辑与批量整理、详情标签、历史导出和条件撤销。改版父任务及 R01–R08 共 9 项，加上同步验收决定后的旧 03/04，共 11 项纳入本轮归档。

用户“这一条不用管，使用的时候也不会睡眠”适用于同一个真实 OS 休眠/唤醒观察项。旧 03/04 其余 AC 已有通过证据，本轮同步此决定后结案。真实睡眠仍为 NOT_RUN，原始 V04 仍为 UNVERIFIED；验收决定为 WAIVED，不是测试 PASS。详细映射见各任务的 `evidence/closeout-2026-10-13.md`。

提交前复核发现：撤销新建文件夹只比较文件夹本身，可能递归删除后来由 Chrome 加入的内容。本轮在既有条件撤销范围修复，并补规划期冲突与执行前树变化的回归。最终检查和原生复测见改版 R08 的 `evidence/precommit-closeout.md`。修复前原生 exe `804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910` 的性能、DPI、权限等收据保留为历史分层证据，不冒充修复后同一二进制的重新运行。

## 尚未完成

| 任务 | 剩余工作 | 完成限制 |
|---|---|---|
| 13 Windows 集成与安装包 | 最终 4fc/284478 包、3ee4/eee73 隔离安装闭环、schema8 脱敏诊断、80 command 拒绝和 6c7e B10K 通过 | 真实模型 V12 缺失，13/M4 未完成；V16 无 Floccus 环境 UNVERIFIED |
| 14 macOS / Linux | 可执行平台适配完成；167 Rust、188 Vitest、20 Node 及 Windows 2c 生产资料预览回归通过，独立检查批准 | 用户明确其他平台先不管，任务离开活动队列；V17 仍 NOT_RUN，不声明支持 |
| 15 可选本地语义检索 | 默认关闭 embedding、范围确认、SQLite 008、取消/失效/删除/隔离和 UI 已实现；完整独立检查及最终 73edf 原生合成功能 9 控制通过，评测工具完成 | 依赖 12、13，不依赖 14；缺实际模型与人工标签，20 条 Recall@5 ≥ 0.8/B10K 暖态 p95 ≤ 1 s 的 V18 NOT_RUN |
| 原父任务 | R01–R16 覆盖、依赖、分层证据、指南和支持矩阵已同步，全部可执行集成收尾完成 | 14 已按 Windows 默认范围移出；V12/V18 未通过，13、15 与父任务继续 in_progress |

本次从既有 13 恢复，当前 Windows 条件满足 [启动例外](../.trellis/tasks/10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md)，按依赖完成 14 可执行适配/检查，记录主机缺口后清除指针并完成独立15实现及确定性/原生合成功能检查。没有重复任务或重做改版。最终独立检查为192 Rust（3既有ignored）、217 Vitest、20 Node、3指标测试、80 E2E及完整静态/构建/协议门槛PASS。模型与外部同步的缺失证据不能标PASS。用户随后把其他平台移出当前范围，V17 仍不是 PASS。实际睡眠不再执行。

当前最终普通搜索B10K三次冷启动788.3896/633.5898/728.6094ms，暖态30次p95 106.6/max110ms。安装闭环11控制/0错误、schema8、全80command拒绝；卸载前后630文件/SQLite完整hash相同。语义9控制为本机HTTP合成模型功能，不是实际模型质量或性能。详细见 [15收据](../.trellis/tasks/10-10-mb-15-semantic-search/evidence/receipts.md) 与 [父需求覆盖](../.trellis/tasks/10-10-markbridge-workspace/current-integration.md)。

13 当前矩阵、当前4fc结果与首次失败链见 [集成证据](../.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md)。13启动基线独立复核与 [15最终独立复核](../.trellis/tasks/10-10-mb-15-semantic-search/evidence/current-independent-check.md) 分开保留，旧4f/3a不冒充新hash重测。平台边界见 [原生平台指南](native-platforms.md)。早期默认main store的合成写入影响仍UNVERIFIED，未读取/清理默认目录，见13隔离失败记录。

## 交接入口

- [下一对话 Prompt](next-session-prompt.md)
- [父任务当前状态](../.trellis/tasks/10-10-markbridge-workspace/execution-status.md)
- [剩余任务研究](../.trellis/tasks/archive/2026-10/10-12-mb-r08-acceptance/research/remaining-task-audit.md)
- [本轮最终复核](../.trellis/tasks/archive/2026-10/10-12-mb-r08-acceptance/evidence/precommit-closeout.md)

本轮已完成本地代码提交：`a3bb951`（开发启动）、`0bd492b`（工作台及安全撤销）；11 项完成任务已移入 `.trellis/tasks/archive/2026-10/`。归档引用与清单校验通过，原父任务当前显示 12/15 done。未推送或发布。
