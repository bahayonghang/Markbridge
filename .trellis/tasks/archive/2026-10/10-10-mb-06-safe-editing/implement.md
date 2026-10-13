# 06 书签编辑、快照与条件撤销：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：05。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 固化 operation/step 状态机、幂等 requestId 与 before/after 契约。
- [ ] 实现扩展执行前重读、逐项 receipt 持久化与后置验证。
- [ ] 实现手动编辑/拖拽和键盘移动、差异确认、保护规则。
- [ ] 实现 HTML/sidecar 备份、条件撤销和故障恢复 UI。
- [ ] 使用每个故障注入点验证安全不变量，并保存审计记录。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
pnpm protocol:check
pnpm test
cargo test --workspace --locked
pnpm test:e2e
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC06-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V07、V08 执行。

## 原生或专项验收

在 B100 临时 Profile 操作所有 CRUD；并行用 Chrome 手动改目标；模拟应用退出及扩展断开；检查实际树、历史、回滚结果。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC06-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

先停止未完成队列并导出历史，按匹配 after-state 的条件撤销已执行部分。代码回退保留数据库和所有未决回执；不强制恢复整库。
