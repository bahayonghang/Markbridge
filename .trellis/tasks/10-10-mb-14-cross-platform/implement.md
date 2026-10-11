# 14 macOS 与 Linux 原生适配：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：13。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-14-cross-platform`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 准备用户授权的 macOS/Linux 测试环境，记录系统依赖而不自动更改日常系统。
- [ ] 实现平台路径、凭据、窗口会话存储和打包适配。
- [ ] 分别执行 V17 及关键 UI/恢复场景。
- [ ] 更新支持矩阵，按平台准确声明证据；不自动发布。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace --locked
cargo clippy --workspace --all-targets -- -D warnings
pnpm --filter @markbridge/desktop tauri build
```

为 AC14-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V17 执行。

## 原生或专项验收

macOS、Linux 各自真实桌面完成 V02/V04/V08/V11/V15，并记录原生截图与安装产物。Windows 结果不能替代。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC14-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

平台适配分支可回退但保留数据；凭据迁移前保留引用，不把 macOS/Linux 私有路径写入共享配置。安装测试只操作授权目录。
