# 11 批量重分类、审查与恢复：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：10。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-11-batch-organization`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现两遍 plan schema、批处理调度和输入覆盖校验。
- [ ] 实现目录方案审查、逐项 diff 与选择接受/拒绝。
- [ ] 接入快照/备份、串行执行、取消和持久恢复。
- [ ] 注入第 40 步中断、lost ack 和并发变更，验证条件回滚。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
pnpm test
cargo test --workspace --locked
pnpm test:e2e
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC11-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V08、V13 执行。

## 原生或专项验收

B100 临时 Chrome Profile 实际应用与回滚；另一次在第 40 步断开。记录 tree before/after 的脱敏语义摘要与逐项回执，不以模拟树替代真实回滚。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC11-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

使用 06 的逐步条件补偿；保留未完成 operation、snapshot、ID 映射和备份。回滚冲突不强制覆盖，用户可逐项重新生成提案。
