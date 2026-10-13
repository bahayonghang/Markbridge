# 03 Chrome 扩展配对与实时同步：执行计划

## 启动门槛

- [x] 用户已批准最新父规划和该任务范围。
- [x] 前置任务验收已通过：02。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge`；核对实际文件和工具版本。
- [x] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 完成配对 UI、本机 listener、凭据引用与认证限制。
- [ ] 实现 worker 顶层事件注册和稳定全树/增量转换。
- [ ] 实现心跳、alarm 唤醒、显式重连、版本协商和 source state。
- [ ] 用 P2 运行原生 Chrome 场景，保留实际扩展 ID/版本但不记录 token。

## 检查命令

以下为该子任务验收时执行的命令。2026-10-11 局部前端和扩展检查已运行，最终完整门槛及原生结果见 evidence。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
pnpm protocol:check
pnpm test
pnpm build
cargo test --workspace --locked
pnpm test:e2e
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
cargo build -p markbridge-core --example bridge_harness --locked
node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs
```

为 AC03-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V02、V03（缓存侧）、V04 执行。

## 原生或专项验收

在授权的一次性 Chrome Profile 加载扩展。完成配对、错误认证、连续事件、worker 停止/唤醒、Chrome 重启、后台闲置；计时事件到缓存。排序用临时 Profile 中的移动或子节点重排，再比较缓存顺序与 `chrome.bookmarks.getTree()`。不打开书签管理器的 HTML 导入或导出。最终 UI 3 秒指标在 05 再完整测量。本机读取由 `cargo test -p markbridge-core --lib --locked` 覆盖 `tree`、`list`、`search`、`get`、`count`。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC03-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

关闭 listener 并吊销凭据；保留缓存供只读浏览。不改注册表或安装 Native Messaging host。

## 2026-10-13 新版任务门槛调整

用户明确将真实 OS 休眠/唤醒验收移至新版 R08 完成前，允许新版 R02–R07 继续实施。旧 V04 保持 UNVERIFIED，不改写本任务收据或完成状态；其他门槛不变。详见 ../10-12-mb-workspace-redesign/gate-change-2026-10-13.md。

2026-10-13 后续决定：用户明确“这一条不用管，使用的时候也不会睡眠”，豁免新版 R08 的真实睡眠验收，取代上述新版完成前门槛。本旧任务的 V04 仍 UNVERIFIED，收据和状态不改写；不将豁免记作测试通过。详见新版 gate-change-2026-10-13.md 当前决定。

## 2026-10-13 当前结案决定

上述历史结果保留。本轮核对 AC1–4 和补充收据均已通过，用户此前已明确无需同一个真实 OS 休眠项，现同步验收决定为 WAIVED；真实执行 NOT_RUN、原始 V04 UNVERIFIED，不改写为 PASS。任务按调整后的范围完成，用户本轮授权提交及归档。详细映射见 [evidence/closeout-2026-10-13.md](evidence/closeout-2026-10-13.md)。
