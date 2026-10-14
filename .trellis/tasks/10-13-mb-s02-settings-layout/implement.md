# S02 执行计划

- [x] 获批准并满足顺序，读父/子规划和frontend组件/状态/生命周期规范，检查diff，start子任务。
- [x] 记录六尺寸四类设置同状态基线几何/截图；引导、资料/文件来源和未保存输入另有行为/状态覆盖，不宣称所有状态均有同状态前后截图。
- [x] 建SettingsWorkspace/纵向tablist，保留面板挂载、aria及焦点逻辑。
- [x] 接入稳定exportHost，只移动来源工具条/导出视图，复用来源守卫和历史入口。
- [x] 重排连接双栏/单栏与AI/语义/导出设置行，清除本改动导致的孤立CSS。
- [x] 更新有意义行为测试：纵向键盘、历史导出/profile/mirror、跨导航草稿；mock调用与校准原生命令路径观察确认导航无禁止的隐式业务调用。
- [x] 运行pnpm lint/typecheck/test/protocol:check/build；相关Playwright为tests/e2e/shell.spec.ts、connection.spec.ts、history.spec.ts、organize.spec.ts、semantic.spec.ts、diagnostics.spec.ts，完成pnpm test:e2e。
- [x] 同尺寸采集前后几何，原生Windows隔离目录确认布局/焦点；pnpm build:native和git diff --check。未测保持NOT_RUN。
- [x] 更新frontend/component-guidelines和质量规范的纵向导航合同，写收据/check-report，再允许S03。

2026-10-14实现收据为evidence/receipts.md，当前生产源码指纹b5dea364…、原生EXE84c17492…与最终native/cddb3d58绑定。父任务已更新规范；独立检查最终报告与S02→S03门槛仍由父任务协调，最后一项在该门槛关闭后确认。暂停期间既有lazy协议/命令脚本改动已保留，当前检查发现的四个取消竞态由父任务授权最小修复；具体RED/GREEN证据在收据中。

预计文件：App.tsx、styles.css、features/settings容器、ConnectionSettings、AiSettings、SemanticSettings、LibraryWorkspace导出视图、ExportDesk及受影响测试。只允许布局/所有权适配，不重写查询或操作引擎。
