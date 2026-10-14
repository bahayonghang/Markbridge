# 14 macOS 与 Linux 原生适配：执行计划

## 启动门槛

2026-10-13 用户明确批准父 [启动例外](../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md)：13 当前安装、诊断导出及自动检查通过即可启动本任务；13 缺真实模型的完整验收仍未完成。14 仍需双平台真实 V17 证据才能完成，缺环境只完成可执行实现/检查并保持未完成。

- [x] 用户已批准最新父规划和该任务范围。
- [x] 13 当前安装/诊断/自动检查通过，独立复核批准上述启动例外；13 完整验收未完成。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-14-cross-platform`，11/11 项通过；核对实际文件和工具版本。
- [x] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 准备用户授权的 macOS/Linux 测试环境，记录系统依赖而不自动更改日常系统。
- [x] 实现明确平台路径说明、原生凭据、窗口会话、保存/导航/清理、原子迁移和打包/CI 源码适配。
- [ ] 分别执行 V17 及关键 UI/恢复场景。
- [x] 更新支持矩阵和系统前提；双平台 V17 NOT_RUN，不自动发布。
- [x] Windows 受影响自动检查与 2c31f83c/f81cc8f7 新二进制主窗口/预览持久化/迁移/正常退出回归通过，并获独立批准。

## 检查命令

以下为正式检查入口。当前Windows自动检查/build:native与随后15集成的最终4fc打包/安装/卸载回归均已通过；双平台目标构建、包内提取、原生与安装仍NOT_RUN。实际日志见evidence/current-independent-check.md与evidence/receipts.md。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
pnpm protocol:check
pnpm build:native
pnpm build:package
```

为 AC14-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V17 执行。

## 原生或专项验收

macOS、Linux 各自真实桌面完成 V02/V04/V08/V11/V15，并记录原生截图与安装产物。Windows 结果不能替代。

## 证据与交付

- [x] evidence/receipts.md/current-independent-check.md 保存实际检查、源发现及 Windows 2c/f81c 回归，首次工具/UI 失败保留。
- [x] AC14-1/2/3 保持未完成，双平台 NOT_RUN；Windows 回归与来源明确。
- [x] Trellis check 独立验证冻结源码、自动检查和实际新二进制回归；修复本任务发现的问题。
- [x] 新源码/测试合同写入相关 specs；Linux 先迁移后建 context、只清 v1、双目录冲突拒绝，原生完成/超时隔离等边界保留。
- [x] 保持 in_progress，清除指针继续独立 15；未提交/归档/发布。

## 回退

平台适配分支可回退但保留数据；凭据迁移前保留引用，不把 macOS/Linux 私有路径写入共享配置。安装测试只操作授权目录。
