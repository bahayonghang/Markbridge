# 02 Profile 身份、存储与共享协议：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：01。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-02-identity-storage-protocol`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 固化协议 envelope、event variants、错误码、节点模型和限制；建立双语言 fixture。
- [ ] 实现 SQLite migration、身份映射、原子缓存替换和游标更新。
- [ ] 建立操作/快照持久字段及 tombstone 基础，不连接真实 Chrome。
- [ ] 运行协议漂移、数据库恢复和 Profile 隔离检查。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm protocol:check
pnpm typecheck
pnpm test
cargo test --workspace --locked
cargo clippy --workspace --all-targets -- -D warnings
```

为 AC02-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V01、V02（存储/协议部分） 执行。

## 原生或专项验收

此任务的核心验收是协议和临时 SQLite；实际 Chrome 身份在 03 的双 Profile 验收，记录为本任务尚未覆盖的运行边界。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC02-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

迁移前复制一致性备份；回退版本不能读取较新 schema。禁止删除现有库来通过测试。
