# 06 书签编辑、快照与条件撤销：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

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
