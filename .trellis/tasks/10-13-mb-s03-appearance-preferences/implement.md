# S03 执行计划

- [x] 核验S02全部AC和本规划批准，读父/子文档及frontend规范，检查diff再start。
- [x] 加纯偏好解析/存储/尺寸映射与首屏应用；测试坏数据、未知版本和保存失败等真实边界。
- [x] 加GeneralSettings及第五分类，普通入口默认通用，快捷入口保持定位。
- [x] 补共享主题变量及system订阅，浅/深逐页检查hover/disabled/错误/焦点/对话框。
- [x] 实现字体和字号角色映射，与VirtualRows树/书签行高同源，保持可见位置、checkbox焦点和草稿。
- [x] DOM/浏览器检查即时应用、系统变化、reload持久化、恢复默认和无隐式调用；真实桌面退出/重启单独验收。
- [x] 运行pnpm lint/typecheck/test/protocol:check/build/test:e2e/build:native及git diff --check，按父verification覆盖六尺寸、最大字号最小窗及125/150%DPI。
- [x] 收据记录exe hash、实际尺寸/DPI、隔离数据目录；未测NOT_RUN，不借用旧产物验收。
- [x] 更新frontend状态/组件/质量spec，完成check-report并交父任务集成，不提交或归档。

预计文件：main.tsx、App.tsx、styles.css、features/settings/GeneralSettings和偏好辅助模块、LibraryWorkspace/VirtualRows尺寸消费及受影响行为测试。新依赖默认不需要；新增后端或协议需求须回到规划。
