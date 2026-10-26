# 顺序执行计划

## 启动前

- [x] 用户在后续消息批准最新完整规划；记录证据后才更新implementation_approval。
- [x] 复核diff、spec和子任务上下文；父任务不start，一次只执行一个满足前置的子任务。
- [x] 恢复当前Playwright入口环境，遵守安装授权；不默认修复系统/日常安装。补改造前浏览器与滚动基线。
- [x] 实施前加载trellis-before-dev；实施/check按Trellis子代理流程及trellis-channel/native上下文协议进行。关联聊天已实施G01，本会话派发独立trellis-check。

## 顺序

- [x] G01：目录apply及备份→项目化DESIGN→令牌/外壳/共享控件/回退→合成对比度→阶段收据。
- [x] G02：逐页适配→关键状态/浮层→尺寸/字号→交互/锚点/授权回归→阶段收据。
- [x] G03：当前完整自动→截图/合成/回退→B10K滚动与检索→当前原生/DPI→最终spec与矩阵。
- [x] 独立check对照R1–R8/AC1–AC8和实际diff；NOT_RUN不能自动豁免。

## 验证命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm protocol:check
pnpm build
pnpm test:e2e
```

阶段定向：pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/workspace-layout.spec.ts tests/e2e/shell.spec.ts tests/e2e/font-picker.spec.ts --workers=1。新增airy-glass用例后纳入。

MARKBRIDGE_EVIDENCE_DIR只指当前任务目录，不覆盖归档截图。G03原生走现有pnpm build:native和独立数据根，先核对scripts/native-build.mjs与原C04驱动，不硬编码历史exe/hash/路径；启动不等于安装。证据包含源指纹/exe hash/PID/OS/WebView2/viewport/实际DPI和IPC观察校准。

## 风险与回滚点

styles.css全局影响所有页面；App/LibraryWorkspace挂载/portal和VirtualRows/ui-preferences度量是保留合同。改变度量/存储/权限即超范围。G01前冻结基线，G02前保留G01收据，G03失败回对应子任务修复并测受影响项。只恢复本任务diff，不抹用户改动。

本轮已进入实施；勾选项与阶段收据对应，未勾选项仍须验证。不自动提交、归档、安装或发布。

## 2026-10-25启动例外

用户允许先实施G01，保留全部验收门槛，详见gate-exception-20261025.md；G01未PASS不得启动G02。

## 当前执行适配与证据

锁定环境使用普通根node_modules，217个实际包版本及integrity逐一匹配pnpm锁。因原pnpm链接修复路径不可用，实际运行G03/automated-run.mjs及validation.config.mjs直接调用同版本CLI；命令/退出码在G03自动收据。原生复用nativeReleaseContext的remap/scan合同，使用任务内wrapper、根Tauri CLI与仅beforeBuildCommand的临时Vite覆盖，普通Cargo输出目录，不修复managed target。当前原生与两轮搜索结果见verification.md；首轮超线未删除，复测不改门槛。
