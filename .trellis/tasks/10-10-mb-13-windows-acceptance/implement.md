# 13 Windows 集成验收与本地安装包：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：09、12。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-13-windows-acceptance`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 检查前置任务回执和缺口，修复跨任务集成产生的问题。
- [ ] 建立可重复的 B10K、P2、crash/worker/lost ack 集成执行记录。
- [ ] 运行全部 Windows gates 和原生权限/渲染检查，记录日志/截图。
- [ ] 生成本地 NSIS 包并在授权隔离环境安装、启动和卸载。
- [ ] 完善使用/恢复/隐私说明，形成 Windows 验收报告及未验证外部项。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm protocol:check
pnpm test:e2e
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
pnpm --filter @markbridge/desktop tauri build
```

为 AC13-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V01–V15；V16 独立外部证据 执行。

## 原生或专项验收

实际安装到专用测试环境并运行完整闭环；分别记录源码检查、构建产物、安装后运行和外部 Floccus。没有安装权限时 V15=NOT_RUN，任务不能完成。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC13-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

卸载仅限已授权测试目录且先验证路径，保留测试证据。发布不在本任务授权内；生产数据升级失败保留迁移前备份和更高 schema 检测。
