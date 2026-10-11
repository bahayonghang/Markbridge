# 02 Profile 身份、存储与共享协议：执行计划

2026-10-10 用户批准仅调整 01→02 启动门槛：01 自动检查通过，原生验收保留 UNVERIFIED，Windows 交付前补齐。其他依赖门槛不变。

## 启动门槛

- [x] 用户已批准最新父规划和该任务范围。
- [x] 用户已批准 01→02 启动例外：01 自动检查通过，原生验收保留 UNVERIFIED，在 Windows 交付前补齐。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-02-identity-storage-protocol`；两个清单各 9 项通过。
- [x] 已对该子任务运行 task.py start。父任务不代替子任务启动。

## 实施顺序

- [x] 固化协议 envelope、event variants、错误码、节点模型和限制；建立双语言 fixture。
- [x] 实现 SQLite migration、身份映射、原子缓存替换和游标更新。
- [x] 建立操作/快照持久字段及 tombstone 基础，不连接真实 Chrome。
- [x] 运行协议漂移、数据库恢复和 Profile 隔离检查。

## 检查命令

以下命令已在最终源码执行并退出 0，见 [收据](evidence/receipts.md)。列表包含父 V01 已规定的完整本地检查；基础入口由 01 提供，命令合同保持不变。

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm protocol:check
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all -- --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets -- -D warnings
pnpm build:native
```

为 AC02-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V01、V02（存储/协议部分） 执行。

## 原生或专项验收

此任务的核心验收是协议和临时 SQLite；实际 Chrome 身份在 03 的双 Profile 验收，记录为本任务尚未覆盖的运行边界。

## 证据与交付

- [x] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [x] 检查 AC02-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [x] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [x] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [x] 更新任务验收状态；未提交、归档或发布，生命周期仍为 in_progress。

## 回退

迁移前复制一致性备份；回退版本不能读取较新 schema。禁止删除现有库来通过测试。
