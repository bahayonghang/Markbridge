# 05 书签工作台、搜索与多 Profile：执行计划

## 启动门槛

- [x] 用户已批准最新父规划和该任务范围。
- [x] 前置任务验收已通过：03、04。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 运行 `python .trellis/scripts/task.py validate .trellis/tasks/10-10-mb-05-library-workspace`；核对实际文件和工具版本。
- [ ] 对该子任务运行 task.py start 后才实施。父任务不代替子任务启动。任务文件在本次实施前已是 in_progress，本次未再运行 start。

## 实施顺序

- [x] 实现布局、类型化 IPC/事件适配器及受控缓存订阅。
- [x] 实现树/列表虚拟化、搜索、Profile 切换和连接状态。
- [x] 补齐 loading/empty/error/stale/read-only、键盘和长文本布局。
- [ ] 运行 B10K/P2、100 次同步计时和原生截图检查，完成 M1 验收。文件镜像暖态搜索与冷启动已达标。已加载资料没有原生 B10K 计时。V03 仍未做在线计时。150% DPI 未测。

## 检查命令

以下为该子任务验收时执行的命令；该子任务尚未运行这些检查，状态为 NOT_RUN。基础入口由 01 提供；命令变更需同步父计划和受影响任务。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm --filter @markbridge/desktop tauri dev
pnpm build:native
```

为 AC05-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V03、V06 执行。

## 原生或专项验收

记录 1280×800 与 1920×1080 原生窗口截图、125%/150% DPI 行为、键盘遍历；执行 B10K 搜索和在线事件计时。

## 证据与交付

- [x] 在 evidence/receipts.md 保存命令、退出码、版本、fixture、原始指标、必要截图及首次失败/修复后重测。
- [x] 检查 AC05-* 映射到实际证据，未验证项保持 NOT_RUN/UNVERIFIED。
- [x] 由 Trellis check 子代理独立验证该子任务的最终改动；修复本任务引入的问题。
- [ ] 将新建源码/测试的真实引用补入相关 specs，保持后续上下文有效。
- [ ] 更新任务状态；提交、归档和公共发布仍需对应用户授权。

## 实施约定

缓存读在 Tauri 边界投影为 Library* DTO，core 里的 Cache* 类型不搬进 protocol。文件镜像搜索使用已经加载的 `get_mirror_tree` 快照，不新增镜像搜索命令。普通打开只接受 http(s)，Windows 上交给 `rundll32`，不把网址写入日志。

## 回退

恢复前一 UI 版本，缓存与 Profile 不迁移。取消订阅应不影响后台存储。
