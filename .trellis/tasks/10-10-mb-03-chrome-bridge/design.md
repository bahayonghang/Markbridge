# 03 Chrome 扩展配对与实时同步：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

apps/extension service worker/options/action、apps/desktop/src-tauri/bridge、crates/core sync、packages/protocol、连接设置 UI

## 技术合同

按父设计第 4–5 节实现一次性配对→长期凭据交换；Origin、instanceId 和 profileId 绑定。绑定 127.0.0.1，端口占用显示修复入口。先注册监听再取稳定快照，barrier seq 保证增量顺序；断档和 import 完成全量刷新。顶层 worker listeners、20 秒心跳、alarms/onStartup 恢复。权限限 bookmarks/storage/alarms，页面采集在 08 加 activeTab/scripting。UI 先提供连接诊断和节点计数，用于在 05 前独立验收。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在授权的一次性 Chrome Profile 加载扩展。完成配对、错误认证、连续事件、worker 停止/唤醒、Chrome 重启、后台闲置；计时事件到缓存。最终 UI 3 秒指标在 05 再完整测量。

## 故障与回退

关闭 listener 并吊销凭据；保留缓存供只读浏览。不改注册表或安装 Native Messaging host。
