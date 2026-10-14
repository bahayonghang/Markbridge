# C01 设计与边界

主合同：[父设计](../10-14-mb-claude-workspace-optimization/design.md)与根[DESIGN.md](../../../DESIGN.md)。不复制第二份字段/颜色/几何定义，合同变化先更新父设计与受影响验收。

## 负责文件

apps/desktop/src/styles.css；必要的展示class；DESIGN.md。

## 本任务结构

仅主题、共享字体角色、公共控件/导航/弹窗视觉；保留现有三档字号的数据/行高，精确字号由C02承担。

C01不把新默认14px偷偷塞入旧v1 standard=13；新v2默认由C02上线。现有旧字号几何仍保持。若C01必须调整行高，则同步共享映射并补旧字号原生验证，不能只改CSS。

## 数据与兼容

保持App唯一UI偏好与bridge、LibraryWorkspace持续挂载、受检DTO和source/epoch绑定。只有C02可按父设计新增字体命令/DTO/v2；其余任务只消费已有接口。没有SQLite迁移或扩展协议改动。

## 验证与回退

对应本任务prd全部AC及父verification。发现合同需变更时回到规划记录差异。回退只回退本任务产生的视觉/服务代码；保留所有偏好、数据库和历史证据。新字体族仅作为转义后的单个CSS字符串消费，不接收路径或字体文件。
