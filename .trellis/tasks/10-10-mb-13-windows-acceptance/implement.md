# 13 Windows 集成验收与本地安装包：执行计划

## 启动门槛

2026-10-13 用户批准父 [门槛决定](../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md)。13 当前安装、诊断导出及自动检查通过后，可清除指针推进 14/15；本任务真实模型 V12/完整验收仍未完成。隔离安装与本轮必要重测已明确获准，限新建临时目录和已披露的注册/卸载范围。

- [x] 用户已批准最新父规划和该任务范围。
- [x] 前置任务验收已通过：09、12。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-13-windows-acceptance`；核对实际文件和工具版本。
- [x] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [x] 检查前置任务回执和缺口，修复跨任务集成产生的问题。
- [x] 建立可重复的 B10K、P2、crash/worker/lost ack 集成执行记录；当前与历史分层复用范围见 current-integration。
- [ ] 运行全部 Windows gates 和原生权限/渲染检查，记录日志/截图。
- [x] 当前 4f/269c 的自动检查、原生权限/渲染、诊断、P2 和重启闭环通过；上行完整 gates 仍缺实际模型 V12。
- [x] 生成本地 NSIS 包并在授权隔离环境安装、启动和卸载，完整 722a/f6c PASS，d4cc 注册项恢复 PASS。
- [x] 完善使用/恢复/隐私说明，形成 Windows 验收报告及未验证模型、平台与外部项。

## 检查命令

以下为正式检查入口。本轮实际自动检查、原始失败及成功重测见 evidence/current-independent-check.md；原生和模型验收分别记录，未运行项保持 NOT_RUN。命令变更同步父计划和受影响任务。

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm protocol:check
pnpm test:e2e
pnpm build
pnpm build:native
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm build:package
```

`pnpm build:native` 只构建并扫描 Windows release 可执行文件，不生成安装包。13 的 `pnpm build:package` 复用动态路径重映射与扫描规则，构建 NSIS 并检查包内实际可执行文件与 release 一致；不得用未重映射的裸构建替代该产物门槛。包构建、授权安装和完整生命周期是独立证据。

为 AC13-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V01–V15；V16 独立外部证据 执行。

## 原生或专项验收

实际安装到专用测试环境并运行完整闭环；分别记录源码检查、构建产物、安装后运行和外部 Floccus。没有安装权限时 V15=NOT_RUN，任务不能完成。

当前退出观察方法2：先用40秒正常运行的P2对照验证有界180秒观察能记录实际Chrome exit0，再使用新临时根跑完整安装/配对/诊断/应用退出重启/重新核对/卸载。原方法1的45秒是harness watchdog，不是V15产品SLA；既有FAIL不改写。实际退出码、信号、耗时与最后所属进程/监听必须保留，任何强杀或仅OS晚到缺席都不能满足正常退出。来源、合同复核与准确边界见design.md及evidence/current-independent-check.md。

## 证据与交付

- [x] 在 evidence/receipts.md 保存当前入口及原始历史；current-integration 记录命令、版本、fixture、指标、截图与失败重测。
- [x] 检查 AC13-* 映射到实际证据，真实模型 V12 NOT_RUN、V16 UNVERIFIED；睡眠 WAIVED/NOT_RUN。
- [x] 由 Trellis check 子代理独立验证当前 4f/269c 改动及实际 722a 原始收据，批准启动例外；完整任务仍未完成。
- [x] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [x] 保持本任务 in_progress，清除指针并启动既有 14；提交、归档和公共发布未执行。

## 回退

卸载仅限已授权测试目录且先验证路径，保留测试证据。发布不在本任务授权内；生产数据升级失败保留迁移前备份和更高 schema 检测。
