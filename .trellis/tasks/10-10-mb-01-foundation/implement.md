# 01 工程基础与可运行桌面骨架：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：bootstrap。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-01-foundation`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 核对当前工具和 Tauri Windows 前置条件；缺失项记录，不自动安装系统组件。
- [ ] 初始化 workspace 和最小可运行包，锁定实际兼容版本；为新 apps 输出补充精确 .gitignore。
- [ ] 建立脚本与 Windows CI 配置，并创建有意义的最小启动/协议测试。
- [ ] 运行构建和原生空态，记录截图；把真实路径补入规范。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm protocol:check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
pnpm --filter @markbridge/desktop tauri dev
```

为 AC01-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V01 执行。

## 原生或专项验收

Windows 原生打开/关闭两次；确认空态、窗口大小、错误展示和退出行为。扩展只检查构建 manifest，不宣称 Chrome 同步已工作。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC01-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

只回退该任务创建的源码和配置；保留已有 Trellis/ref 文件。该阶段没有真实用户数据库迁移。
