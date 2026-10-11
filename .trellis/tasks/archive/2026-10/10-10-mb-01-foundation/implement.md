# 01 工程基础与可运行桌面骨架：执行计划

## 启动门槛

- [x] 用户已批准最新父规划和该任务范围。
- [x] 前置任务验收已通过：bootstrap。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-01-foundation`；核对实际文件和工具版本。
- [x] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [x] 核对当前工具和 Tauri Windows 前置条件；缺失项记录，不自动安装系统组件。
- [x] 初始化 workspace 和最小可运行包，锁定实际兼容版本；为新 apps 输出补充精确 .gitignore。
- [x] 建立脚本与 Windows CI 配置，并创建有意义的最小启动/协议测试。
- [ ] 构建和浏览器空态已 PASS，截图已保存；原生空态、窗口操作仍 UNVERIFIED。主会话已补入真实规范引用。

## 检查命令

以下统一入口已建立并执行。实际退出码、首次失败和重测结果见 [检查收据](evidence/receipts.md)。原生步骤单独记录；命令变更需同步所有引用。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:native
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

- [x] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [x] 检查 AC01-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [x] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题，见 evidence/check-review.md。原生交互缺口仍保留。
- [x] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

只回退该任务创建的源码和配置；保留已有 Trellis/ref 文件。该阶段没有真实用户数据库迁移。
