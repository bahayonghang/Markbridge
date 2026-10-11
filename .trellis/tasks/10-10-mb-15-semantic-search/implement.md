# 15 可选本地向量检索：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：12、13。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-15-semantic-search`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 建立固定中文/英文相关性 fixture 与评测方法。
- [ ] 实现本地 embedding、持久索引元信息及可取消增量构建。
- [ ] 实现向量查询和独立开关/删除 UI，保留词法搜索。
- [ ] 记录模型版本、维度、耗时、磁盘占用和 V18 结果。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm --filter @markbridge/desktop tauri dev
```

为 AC15-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V18 执行。

## 原生或专项验收

在已授权本地 embedding 模型和 B10K 数据上执行相关性/时延检查；仅模拟模型时质量门槛为 NOT_RUN。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC15-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

停止 embedding 作业并删除派生向量表/索引内容；不得删除原书签、标签、摘要或 provider 的其他配置。
