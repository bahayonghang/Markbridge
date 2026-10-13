# R01 设计

## 方法与边界

提取 Shell/Sidebar/WorkspaceToolbar/StatusBar 和设置内容容器，继续只挂一份 useBridge。组件按工作区切换，选择状态不存到第二份树。将全局 input 宽度改成文本控件作用域；checkbox 与虚拟行独立尺寸。保留当前原生标题栏/最小尺寸。只迁现有入口，后续功能子任务再完善具体行为。

## 变更责任

- apps/desktop/src/App.tsx
- apps/desktop/src/styles.css
- apps/desktop/src/features/library/LibraryWorkspace.tsx
- apps/desktop/src/App.test.tsx

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
