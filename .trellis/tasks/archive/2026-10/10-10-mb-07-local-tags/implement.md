# 07 本地标签与可选标题编码：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：06。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-07-local-tags`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现 tags/bookmark_tags 和本地事务/撤销记录。
- [ ] 实现标签/备注 UI、过滤、多选、重命名/合并。
- [ ] 实现可逆编码与历史元数据，接入 06 预览和写回。
- [ ] 验证本地模式零浏览器写入及外部改名冲突。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
pnpm test
pnpm typecheck
cargo test --workspace --locked
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC07-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V09 执行。

## 原生或专项验收

Chrome 打开与关闭时分别编辑本地标签；在测试库启用/撤回标题编码，对比原始树和备注持久化。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC07-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

本地标签事务可撤销；已编码标题通过 06 条件回滚，仅在当前值匹配时恢复 rawTitle，冲突保留。
