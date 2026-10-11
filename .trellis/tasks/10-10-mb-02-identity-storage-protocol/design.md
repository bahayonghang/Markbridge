# 02 Profile 身份、存储与共享协议：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

crates/protocol、crates/core、packages/protocol、apps/desktop/src-tauri/storage 与 migrations、tests/fixtures

## 技术合同

按父设计第 3–6 节建模。Rust DTO 为 schema 来源，TS 生成类型加 Ajv 边界校验。数据库缓存和 source cursor 在同事务提交；侧车 bookmarkId 独立于 Chrome ID。操作/快照表预留父设计已明确的字段，不提前实现未需要的服务接口。profileId/sourceEpoch/chromeId 唯一，mirrorSourceId 独立。rusqlite 专用工作线程串行持有连接，WAL 和 foreign_keys 打开。凭据表只存引用。Chrome 时间与文件时间先归一为带来源的 UTC，不能混用 epoch。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

此任务的核心验收是协议和临时 SQLite；实际 Chrome 身份在 03 的双 Profile 验收，记录为本任务尚未覆盖的运行边界。

## 故障与回退

迁移前复制一致性备份；回退版本不能读取较新 schema。禁止删除现有库来通过测试。
