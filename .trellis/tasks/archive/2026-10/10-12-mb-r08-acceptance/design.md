# R08 设计

## 方法与边界

沿父verification矩阵建数据和端到端流程，不以快照像素相等作为唯一可用性测试。验收使用一次性Profile/目录，原生保存/窗口焦点/权限必须实际测试。记录构建hash、差异摘要、OS/Chrome/WebView2版本、视口及缩放，保留首次失败；用户任务步骤不用工程术语。

## 变更责任

- tests/e2e
- apps/desktop/src
- docs
- .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/receipts.md

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
