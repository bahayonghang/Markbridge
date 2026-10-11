# 09 应用内完整网页预览与隔离：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：05。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-09-webpage-preview`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [ ] 实现 Rust-only 预览窗口创建与安全 label/数据目录。
- [ ] 绑定导航、弹窗、下载、关闭和 Profile 切换策略。
- [ ] 实现可信主窗口控制栏及会话清除提示。
- [ ] 进行原生恶意页面 IPC 拒绝、Cookie 隔离、导航和焦点检查。

## 检查命令

以下为实施后的计划命令；当前产品代码尚不存在，全部 NOT_RUN。01 负责提供这些统一入口；命令变更需同步所有引用。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm --filter @markbridge/desktop tauri dev
pnpm --filter @markbridge/desktop tauri build
```

为 AC09-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V11 执行。

## 原生或专项验收

必须实际运行 Windows WebView2；记录远程页调用文件/密钥/书签命令的拒绝证据，Profile A/B 登录隔离，关闭/重开与焦点截图。浏览器 mock 不计入 V11。

## 证据与交付

- [ ] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [ ] 检查 AC09-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

关闭预览窗口、禁用入口并保留或由用户清除专用会话目录；不能删除 Chrome 或 main 的数据目录。
