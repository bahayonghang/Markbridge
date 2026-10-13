# 04 只读文件镜像与离线恢复：执行计划

## 启动门槛

- [ ] 用户已批准最新父规划和该任务范围。
- [ ] 前置任务验收已通过：02、03。
- [ ] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [ ] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-04-readonly-mirror`；核对实际文件和工具版本。
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

## 2026-10-13 新版任务门槛调整

用户明确将真实 OS 休眠/唤醒验收移至新版 R08 完成前，允许新版 R02–R07 继续实施。旧 V04 保持 UNVERIFIED，不改写本任务收据或完成状态；其他门槛不变。详见 ../10-12-mb-workspace-redesign/gate-change-2026-10-13.md。

2026-10-13 后续决定：用户明确“这一条不用管，使用的时候也不会睡眠”，豁免新版 R08 的真实睡眠验收，取代上述新版完成前门槛。本旧任务的 V04 仍 UNVERIFIED，收据和状态不改写；不将豁免记作测试通过。详见新版 gate-change-2026-10-13.md 当前决定。

## 2026-10-13 当前结案决定

上述历史结果保留。本轮核对 AC1–4 和补充收据均已通过，用户此前已明确无需同一个真实 OS 休眠项，现同步验收决定为 WAIVED；真实执行 NOT_RUN、原始 V04 UNVERIFIED，不改写为 PASS。任务按调整后的范围完成，用户本轮授权提交及归档。详细映射见 [evidence/closeout-2026-10-13.md](evidence/closeout-2026-10-13.md)。
