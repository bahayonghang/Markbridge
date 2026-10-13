# R06 设计

## 方法与边界

HistoryWorkspace读取既有operations；导出迁到历史/设置固定入口。添加窄原生保存命令，由Rust持有对话框结果/写入所选文件并返回saved/cancelled/failed，前端不拿任意文件写权限。导出一致缓存revision；撤销继续既有undo和R04批次分组，按逆序条件恢复，不宣称全库导入恢复。

## 实施合同

- `save_export({source:{kind:'profile'|'mirror',id},format:'html'|'sidecar'})` 仅可信 main 调用。返回状态、来源/格式/世代/版本/缓存时间/导出时间/节点数量及稳定错误码，不返回文件路径或正文。原生保存对话框归 main HWND；用户取消不创建导出文件。实际写入完成才报告 saved，失败保留原目标并允许重试。
- Rust 在打开对话框前捕获完整缓存。Bridge 锁固定树及来源身份；侧车的条目和标签在同一个 Storage 串行任务中读取。对话框期间新发生的 Chrome 或本地元数据变更不混入已捕获内容。
- HTML 为 Netscape 格式，附带转义后的导出元数据注释。侧车 JSON 使用 schemaVersion 2，包含 metadata、entries，保留本地身份、标签、备注、摘要及标题编码相关值。它不是全库恢复格式。镜像只导 HTML。
- `operation_detail` 返回原始步骤、回执、快照中的删除子孙、撤销关联及删除后重建的 ID 映射。后代读取完整 snapshot_tree；恢复映射在临时 metadata maps 消费后仍可由持久恢复请求和 create 回执追溯。列表优先显示中文操作类型、时间、数量和真实状态；内部 ID 放入诊断折叠区。
- `preview_undo` 返回最多 1000 个完整条件恢复步骤及冲突，绑定原操作和来源世代；确认仍经既有 `apply_edit`。预览、取消和标记人工核对都不能冒充 Chrome 写入结果。
- 撤销返回 rolling_back 时，详情继续监听返回的撤销 operationId，并把原提示更新到实际终态；不能永久停留在“正在等待”。

Windows 保存验收只使用独立临时目录、应用数据和 Chrome Profile。文件被占用时，区分系统对话框拒绝目标与 Rust 写入失败；不把前者伪记为应用返回 failed。真实写入失败、原文件保留和重试另由实际文件 I/O 回归覆盖。

## 变更责任

- apps/desktop/src/features/library/EditDesk.tsx
- apps/desktop/src/backend.ts
- apps/desktop/src-tauri/src
- apps/desktop/src-tauri/capabilities/main.json
- crates/core/src/storage/operations.rs
- crates/protocol
- packages/protocol

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
