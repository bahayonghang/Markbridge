# C02 设计与边界

主合同：[父设计](../10-14-mb-claude-workspace-optimization/design.md)与根[DESIGN.md](../../../DESIGN.md)。不复制第二份字段/颜色/几何定义，合同变化先更新父设计与受影响验收。

## 负责文件

apps/desktop/src-tauri/src/main.rs及拟新增fonts.rs；Cargo.toml受限Windows feature；crates/protocol及packages/protocol；backend.ts；GeneralSettings/ui-preferences；App/main；VirtualRows；相关测试。

## 本任务结构

真实Windows字体目录、列表搜索/预览/使用/取消/刷新、精确字号、v2迁移与共享几何。字体文件导入/安装不在范围。

本任务跨Rust/协议/React三个边界，先验证再消费。任何字体列表web mock都不能满足真实枚举AC。真实字形证明不依赖document.fonts.check。新能力不得放宽remote preview能力；不得把共享协议字段所有权规则误读为重开旧02，新的DTO扩展需保持同一生成合同。

## 数据与兼容

保持App唯一UI偏好与bridge、LibraryWorkspace持续挂载、受检DTO和source/epoch绑定。只有C02可按父设计新增字体命令/DTO/v2；其余任务只消费已有接口。没有SQLite迁移或扩展协议改动。

## 验证与回退

对应本任务prd全部AC及父verification。发现合同需变更时回到规划记录差异。回退只回退本任务产生的视觉/服务代码；保留所有偏好、数据库和历史证据。新字体族仅作为转义后的单个CSS字符串消费，不接收路径或字体文件。
