# 07 本地标签与可选标题编码：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

crates/core tags/title codec、SQLite metadata 查询、apps/desktop/src/features/tags 与编辑面板

## 技术合同

按用户确认默认只写 SQLite。标签名称 trim + Unicode NFC，按规范化大小写折叠去重，保留首选显示名；用户显式合并时展示受影响条目。普通本地标签不受 AI 的 3×8 建议上限限制，设置合理输入界限（每标签 32 Unicode 字符，每书签最多 50 标签）。标题编码作为可选写回模式，存 rawTitle/lastEncodedTitle 与转义规则，预览具体标题后调用 06。外部改名不被默认当成标签输入。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

Chrome 打开与关闭时分别编辑本地标签；在测试库启用/撤回标题编码，对比原始树和备注持久化。

## 故障与回退

本地标签事务可撤销；已编码标题通过 06 条件回滚，仅在当前值匹配时恢复 rawTitle，冲突保留。
