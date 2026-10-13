# R05 设计

## 方法与边界

详情容器复用TagDesk/ContentPreview/WebPreview并拆可见分区；切换身份或URL取消请求，hidden面板不能开始全库抓取。标签筛选回传R03统一条件；信息中显示完整路径、站点和本地更新时间，内部ID折叠。保持密钥/远程脚本隔离。

## 变更责任

- apps/desktop/src/features/tags/TagDesk.tsx
- apps/desktop/src/features/preview/ContentPreview.tsx
- apps/desktop/src/features/preview/WebPreview.tsx
- apps/desktop/src/features/library/LibraryWorkspace.tsx

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。

## 实施中确认的必要跨层修补

本地 tag_command 及标题编码 preview/apply 绑定 UI 草稿的 expectedSourceEpoch，Bridge 锁内比较当前世代后执行；身份重置复用 chromeId/revision 也不能把旧草稿写入新节点。参数为可选以保留旧 IPC 调用兼容，本产品 UI 必须传入其固定世代；冲突保留草稿。无 Chrome wire、schema 或数据库迁移。

原生隔离验收复用 MARKBRIDGE_APP_DATA：配置 main WebView 的独立数据目录在该临时根内，不以 WEBVIEW2_USER_DATA_FOLDER 全局覆盖所有预览 Profile。无该变量时保持原有默认目录。
