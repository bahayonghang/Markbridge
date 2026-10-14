# C03 设计与边界

主合同：[父设计](../10-14-mb-claude-workspace-optimization/design.md)与根[DESIGN.md](../../../DESIGN.md)。不复制第二份字段/颜色/几何定义，合同变化先更新父设计与受影响验收。

## 负责文件

styles.css及各页面必要展示容器；LibraryWorkspace/SettingsWorkspace/ConnectionSettings/GeneralSettings/OrganizeWorkspace/SemanticWorkspace/HistoryWorkspace/ExportDesk等受影响组件和测试。

## 本任务结构

应用壳、书签/详情、五设置与首次接入、整理/语义、历史/导出和可信浮层的布局与信息层级。

布局优化不新建全局状态库、重写异步订阅、把源选择复制到设置或把远程页面注入可信DOM。目录/详情替换模式沿用；字号导致空间不足时优先叠列而非缩字。

## 数据与兼容

保持App唯一UI偏好与bridge、LibraryWorkspace持续挂载、受检DTO和source/epoch绑定。只有C02可按父设计新增字体命令/DTO/v2；其余任务只消费已有接口。没有SQLite迁移或扩展协议改动。

## 验证与回退

对应本任务prd全部AC及父verification。发现合同需变更时回到规划记录差异。回退只回退本任务产生的视觉/服务代码；保留所有偏好、数据库和历史证据。新字体族仅作为转义后的单个CSS字符串消费，不接收路径或字体文件。
