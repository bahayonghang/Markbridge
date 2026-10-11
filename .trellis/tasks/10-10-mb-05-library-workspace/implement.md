# 05 书签工作台、搜索与多 Profile：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：03、04。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-05-library-workspace`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现布局、类型化 IPC/事件适配器及受控缓存订阅。
- [ ] 实现树/列表虚拟化、搜索、Profile 切换和连接状态。
- [ ] 补齐 loading/empty/error/stale/read-only、键盘和长文本布局。
- [ ] 运行 B10K/P2、100 次同步计时和原生截图检查，完成 M1 验收。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm --filter @markbridge/desktop tauri dev
```

为 AC05-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V03、V06 执行。

## 原生或专项验收

记录 1280×800 与 1920×1080 原生窗口截图、125%/150% DPI 行为、键盘遍历；执行 B10K 搜索和在线事件计时。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC05-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

恢复前一 UI 版本，缓存与 Profile 不迁移。取消订阅应不影响后台存储。
