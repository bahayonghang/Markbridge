# 04 只读文件镜像与离线恢复：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：02、03。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-04-readonly-mirror`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。

## 实施顺序

- [x] 实现只读路径选择、Profile 信息解析和来源命名空间。
- [x] 实现目录监听、去抖、重读与定期核对。
- [x] 接入 live 优先级和手动关联一致性验证。
- [ ] 用临时文件夹故障 fixture 验证，再用一次性 Chrome Profile 原生验证。临时文件夹 fixture 已由 `evidence/receipts.md` 的 core 测试覆盖。一次性 Chrome Profile 未运行。

## 检查命令

以下为该子任务验收入口。本轮实际命令、退出码和未运行项在 `evidence/receipts.md`。`pnpm --filter @markbridge/desktop tauri dev` 与 `pnpm build:native` 未运行。基础入口由 01 提供；命令变更需同步父计划和受影响任务。本任务约束禁止改父任务目录，因此未改父计划。

```text
cargo test --workspace --locked
pnpm test
pnpm typecheck
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC04-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V04、V05 执行。

## 本轮约定

- 文件来源使用已有 `mirrorSourceId`。文件缓存键是 `(mirror_source_id, chrome_id)`。
- `mirror_sources` 的新增列在 `crates/core/src/storage/migrations/003_mirror.sql`。插入必须写出列名。
- 监听任务的 `JoinHandle` 放在 `Bridge.watches`。任务不持有拥有该 handle 的 `Bridge` clone。
- `can_write_browser` 在协议里恒为 false。文件来源的授权结果保持 ReadOnly。
- 本任务约束禁止改 `.trellis/spec`。文件来源状态落在 `MirrorSourceState` 的说明写在本任务 `design.md`。

## 原生或专项验收

打开/关闭 Chrome 后修改测试书签，观察来源状态和重连；采集应用对文件的访问证据与文件哈希，排除 Chrome 自己正常写入的时间段。本轮未做这一步。

## 证据与交付

- [x] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。桌面窗口未打开，没有截图。
- [x] 检查 AC04-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [ ] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。本轮按任务约束未改 `.trellis/spec`。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。状态保持 `in_progress`。工作树未提交。

## 回退

停止 watcher、取消路径关联；保留已缓存来源与侧车，不删除 Chrome 文件。
