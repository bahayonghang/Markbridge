# 08 网页抽取、摘要预览与缩略图：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：05。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-08-content-preview`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现 URL/DNS/redirect 限制与资源预算，测试 fixture harness 隔离。
- [ ] 实现 HTML 文本/元数据抽取、图片代理、LRU 缓存。
- [ ] 实现内容预览 UI、刷新/取消与选择代际校验。
- [ ] 加入最小权限的扩展采集动作及范围说明。
- [ ] 运行恶意输入和真实页面原生预览，保留失败而不编造摘要。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC08-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V10 执行。

## 原生或专项验收

在测试页验证静态、动态、登录失败、无图和缓存离线；通过实际 Chrome 扩展点击进行一次授权采集；检查只采集选中页。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC08-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

取消请求并清除 preview cache；保留本地标签和浏览器树。撤销扩展采集权限不会影响基础书签同步。
