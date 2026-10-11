# 03 Chrome 扩展配对与实时同步：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：02。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-03-chrome-bridge`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 完成配对 UI、本机 listener、凭据引用与认证限制。
- [ ] 实现 worker 顶层事件注册和稳定全树/增量转换。
- [ ] 实现心跳、alarm 唤醒、显式重连、版本协商和 source state。
- [ ] 用 P2 运行原生 Chrome 场景，保留实际扩展 ID/版本但不记录 token。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm protocol:check
pnpm test
pnpm build
cargo test --workspace --locked
pnpm test:e2e
pnpm --filter @markbridge/desktop tauri dev
```

为 AC03-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V02、V03（缓存侧）、V04 执行。

## 原生或专项验收

在授权的一次性 Chrome Profile 加载扩展。完成配对、错误认证、连续事件、worker 停止/唤醒、Chrome 重启、后台闲置；计时事件到缓存。最终 UI 3 秒指标在 05 再完整测量。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC03-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

关闭 listener 并吊销凭据；保留缓存供只读浏览。不改注册表或安装 Native Messaging host。
