# 12 死链、重复项与摘要检索：设计

## 当前与边界

该子任务尚未实施。以下为目标设计，路径表示该任务的修改范围；01 已创建的基础源码以当前工作树为准。

crates/core maintenance、apps/desktop/src-tauri safe fetch/FTS、apps/desktop/src/features/maintenance/search

## 技术合同

复用 08 fetch 与 06/11 审查恢复。URL 仅标准化 scheme/host/默认端口，保留 query/fragment/path；同 URL 不自动合并 sidecar。重复组由用户选择保留项，合并 metadata 前显示标签并集和备注冲突。死链检测由用户选择范围，低并发 4，可取消；404/410 至少两次间隔检查确认候选，403/429/超时为 unknown。FTS5 trigram 提供摘要/备注搜索，短于 3 字符查询用参数化子串查询；按 Profile 过滤。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在测试库中复查重复组和死链候选，选择少量项清理并撤销；用网络 fixture 控制 403/429/404/410，不向全部真实书签批量发请求。

## 故障与回退

取消作业；丢弃候选不影响数据。已确认清理使用条件撤销；FTS 可从保留 metadata 重建，不删除原摘要/备注。
