# 10 AI 单条建议、端点与隐私控制：执行计划

## 启动门槛

- [x] 用户已批准最新父规划和该任务范围。
- [x] 前置任务验收已通过：06、07、08。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-10-ai-assistance`；核对实际文件和工具版本。
- [x] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [x] 实现 provider 配置/能力检测、OS 密钥和安全 endpoint 校验。
- [x] 实现 job 生命周期、请求预算、schema 校验与最多一次格式修复。
- [x] 实现单条预览/编辑/取消/应用和本地 metadata 写入。
- [x] 运行确定性 provider fixture。
- [x] 在授权本地模型上记录真实 10 页结果。隔离的 `127.0.0.1` 端点由 `ReqwestTransport` 调用，命令和退出码在 evidence/receipts.md。未安装 Ollama，未下载模型，不称已下载模型质量通过。

## 检查命令

基础入口由 01 提供；命令变更需同步父计划和受影响任务。2026-10-11 已运行 fmt、clippy、`cargo test --workspace --locked --offline`、`pnpm protocol:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`。退出码见 evidence/receipts.md。`pnpm --filter @markbridge/desktop tauri dev` 与 `pnpm build:native` 保持 NOT_RUN。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC10-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V12 执行。

## 原生或专项验收

用已安装且用户配置的 Ollama 模型测 10 页；若无服务/模型保留 NOT_RUN。云端费用与账号需单独授权；模拟端点只验证协议，不称真实模型质量通过。

## 证据与交付

- [x] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [x] 检查 AC10-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [x] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [x] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [x] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 回退

取消作业、删除 provider 凭据引用、保留未应用草稿供用户选择。已应用标题/标签按操作历史条件撤销。
