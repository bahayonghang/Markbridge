# 03 Chrome 扩展配对与实时同步：设计

## 当前与边界

2026-10-11 已核对 02 验收 PASS，并启动 03。实现和检查进行中，尚无 03 完整验收结论。内部接口见 [实施接口](integration-contract.md)。

apps/extension service worker/options/action、apps/desktop/src-tauri/bridge、crates/core sync、packages/protocol、连接设置 UI

## 技术合同

按父设计第 4–5 节实现一次性配对→长期凭据交换；Origin、instanceId 和 profileId 绑定。绑定 127.0.0.1，端口占用显示修复入口。先注册监听再取稳定快照，barrier seq 保证增量顺序；断档、乱序、重复，以及 Chrome 自己发出的 import 结束，都做全量刷新。顶层 worker listeners、20 秒心跳、alarms/onStartup 恢复。权限限 bookmarks/storage/alarms，页面采集在 08 加 activeTab/scripting。UI 先提供连接诊断和节点计数，用于在 05 前独立验收。

本机读取不接入 MCP，不注册 Native Messaging host，不读写 Netscape HTML。扩展仍用 `chrome.bookmarks` 同步。Rust 对一个 Profile 已缓存的扁平 `BookmarkNode` 提供 `tree`、`list`、`search`、`get`、`count`。这些方法不是 WebSocket 消息，也不进入生成的协议 schema。`depth` 省略或 0 表示整棵子树。`search` 区分大小写，匹配标题或 URL。`get` 沿 `parent_id` 返回祖先标题。未知 Profile 返回 `WrongProfile`。一次查询里的路径只用局部映射。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../../../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

03 补齐官方 folderType 的 managed 枚举值；既有消息字段及其他值不变。MV3 使用以 Rust schema 构建生成的 Ajv standalone wire 校验器，运行时不动态生成 JavaScript。变更后的双语言样本、schema 漂移和扩展 CSP 产物检查归 03 记录。

## 验证边界

在授权的一次性 Chrome Profile 加载扩展。完成配对、错误认证、连续事件、worker 停止/唤醒、Chrome 重启、后台闲置；计时事件到缓存。排序比较缓存子节点顺序与 `chrome.bookmarks.getTree()`。不打开书签管理器的 HTML 导入或导出。最终 UI 3 秒指标在 05 再完整测量。

验收数据目录是环境变量 MARKBRIDGE_APP_DATA，设为绝对目录时桌面在该目录打开 markbridge.sqlite，未设置时仍使用应用数据目录。

## 故障与回退

关闭 listener 并吊销凭据；保留缓存供只读浏览。不改注册表或安装 Native Messaging host。
