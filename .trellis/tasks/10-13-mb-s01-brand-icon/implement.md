# S01 执行计划

- [x] 获父规划批准，读取baseline、父规划与本三文档，检查diff，再start本子任务。
- [x] 使用ui/generated-asset及imagegen流程，用内置image_gen分别生成A/B；记录prompt、来源、实际尺寸/alpha。
- [x] 生成浅/深背景和16/24/32/48/128/256尺寸对比，展示并记录最终选择；未确定不替换正式消费资产。
- [x] 复制母版至仓库，用现有工具导出Windows PNG/ICO、侧栏及扩展PNG，更新本地引用。
- [x] 查尺寸/ICO帧/alpha/清单引用；pnpm build、pnpm lint、pnpm typecheck、pnpm test、pnpm build:native及git diff --check。
- [x] 用隔离应用目录和临时Chrome验收新exe/扩展品牌，记录hash和截图。无原生证据保持NOT_RUN；不安装到日常环境。
- [x] 写evidence/receipts.md，完成AC并交父任务协调独立审查。
- [ ] 父协调写check-report、稳定资产路径约定纳入spec并冻结启动S02的验收门槛。

预计修改：assets/brand、apps/desktop/src-tauri/icons、App.tsx品牌入口和样式、apps/extension/public/icons及manifest；桌面本地品牌资源路径按现有Vite方式选择。测试只增加必要的消费引用/产物检查，避免为纯图标做实现镜像单测。权限或协议差异属于失败。
