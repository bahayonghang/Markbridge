# R02 设计

## 方法与边界

Onboarding与ConnectionSettings共用现有startBridge/beginPairing/confirmPairing/mirror命令。默认端口保留；高级路径/端口折叠，不能自动扫描日常Chrome配置或自动安装扩展。来源选择写明确kind/id；恢复步骤依赖真实BridgeState，不用定时器模拟live。扩展只做配对文案/反馈对齐，不重写认证。

## 变更责任

- apps/desktop/src/App.tsx
- apps/desktop/src/features/settings/ConnectionSettings.tsx（R01已提取）
- apps/desktop/src/features/library/LibraryWorkspace.tsx（仅来源状态/切换）
- apps/desktop/src/useBridge.ts
- apps/desktop/src/backend.ts
- apps/extension/src/main.ts

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
