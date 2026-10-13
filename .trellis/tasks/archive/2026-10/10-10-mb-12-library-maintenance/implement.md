# 12 死链、重复项与摘要检索：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：07、08、11。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-12-library-maintenance`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现严格重复判定与用户指定 survivor 方案。
- [ ] 实现有预算的死链作业和多状态结果。
- [ ] 建立 FTS migration 与短查询路径，保持本地 metadata 更新一致。
- [ ] 接入 06/11 的清理预览、备份、执行与恢复。
- [ ] 运行 HTTP fixture、中文搜索和原生清理/撤销。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC12-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V14 执行。

## 原生或专项验收

在测试库中复查重复组和死链候选，选择少量项清理并撤销；用网络 fixture 控制 403/429/404/410，不向全部真实书签批量发请求。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC12-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

取消作业；丢弃候选不影响数据。已确认清理使用条件撤销；FTS 可从保留 metadata 重建，不删除原摘要/备注。
