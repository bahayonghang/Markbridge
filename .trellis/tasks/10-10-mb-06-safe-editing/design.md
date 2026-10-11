# 06 书签编辑、快照与条件撤销：设计

## 当前与边界

该子任务尚未实施。以下为目标设计，路径表示该任务的修改范围；01 已创建的基础源码以当前工作树为准。

crates/core operations/snapshots、apps/desktop/src-tauri commands/export、apps/extension command executor、编辑/历史 UI

## 技术合同

父设计第 7 节为权威。按 Profile 串行执行，保存 expectedBefore 与完整顺序锚点。副作用前持久化 before-state，确认结果后记录 receipt。root/folderType/managed 保护在 UI、Rust、extension 三处保持一致。检测文件夹环与跨 Profile 移动。lost ack 进入 uncertain 并查询回执/重读；无法唯一判定时要求人工审查。恢复删除需要新 ID 映射与 sidecar 迁移，不能声称原 ID 回来。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在 B100 临时 Profile 操作所有 CRUD；并行用 Chrome 手动改目标；模拟应用退出及扩展断开；检查实际树、历史、回滚结果。

## 故障与回退

先停止未完成队列并导出历史，按匹配 after-state 的条件撤销已执行部分。代码回退保留数据库和所有未决回执；不强制恢复整库。

## 实施约定

一次删除计入的节点数大于 20 时，`apply_edit` 在 `secondConfirm` 为 false 时返回 `CANCELLED`。这次调用不写备份，也不发送 `apply_operation`。阈值 20 记在本任务。

备份在发送之前写入。HTML 与侧车 JSON 分文件保存。文件名只保留字母、数字、连字符和下划线。备份路径留在 SQLite，不进入前端 DTO。

进程启动或连接断开时，`applying` 和 `rolling_back` 记为 `uncertain`。扩展对已有 create 或 delete 标记、以及 effect 阶段但没有回执的步骤，返回 `uncertain`，不再调用 `chrome.bookmarks`。已保存的回执可以重放。丢失 ack 保持未决，发送成功不表示 Chrome 已应用。

日常凭据名仍是 `Markbridge.Pairing`。验收进程只接受 `Markbridge.Task05.{id}` 或 `Markbridge.Task06.{id}`。把变量设成 `Markbridge.Pairing` 必须失败。编辑单元测试使用内存凭据存储。
