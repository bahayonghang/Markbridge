# 15 可选本地向量检索：设计

## 当前与边界

该子任务尚未实施。以下为目标设计，路径表示该任务的修改范围；01 已创建的基础源码以当前工作树为准。

crates/core semantic search、apps/desktop/src-tauri local embedding adapter/SQLite vectors、搜索设置 UI、relevance fixtures

## 技术合同

复用 10 provider 配置的本地模型通路，只允许用户选择本地 embedding endpoint。存 model/version/dimension/content fingerprint，模型变化重建而不混用。10,000 条规模先用 SQLite 保存向量加 Rust 有界精确 cosine 检索，避免独立向量服务；无性能证据不引入 ANN/向量扩展。仅索引用户授权范围，不后台抓取全库；暂停/继续/删除均可见。词法搜索保持独立。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在已授权本地 embedding 模型和 B10K 数据上执行相关性/时延检查；仅模拟模型时质量门槛为 NOT_RUN。

## 故障与回退

停止 embedding 作业并删除派生向量表/索引内容；不得删除原书签、标签、摘要或 provider 的其他配置。
