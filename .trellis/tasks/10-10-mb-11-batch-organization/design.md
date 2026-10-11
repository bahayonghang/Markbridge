# 11 批量重分类、审查与恢复：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

crates/core batch plan/recovery、AI jobs、apps/desktop/src/features/organization、operation history、批量故障 fixtures

## 技术合同

复用 10 provider 和 06 mutation engine。采样最多 200 条提议目录，用户审查后每批 25 条/并发 2 生成分配；小范围可少于 8 类。每项必须引用选中输入和已审查目录，校验无缺项/重复/未知 ID/目录环。UI 显示来源→目标、影响数、拒绝和编辑。apply 前验证 source revision、完整备份和 plan hash；串行创建目录再移动。暂停/取消停止新步骤但保留已执行结果。只恢复成功步骤且遵守 after-state 条件，删除和空目录清理独立确认。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

B100 临时 Chrome Profile 实际应用与回滚；另一次在第 40 步断开。记录 tree before/after 的脱敏语义摘要与逐项回执，不以模拟树替代真实回滚。

## 故障与回退

使用 06 的逐步条件补偿；保留未完成 operation、snapshot、ID 映射和备份。回滚冲突不强制覆盖，用户可逐项重新生成提案。
