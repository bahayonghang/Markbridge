# 04 只读文件镜像与离线恢复：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

apps/desktop/src-tauri/profile discovery/watcher、crates/core mirror、连接/来源选择 UI、tests/fixtures/bookmarks files

## 技术合同

只读取用户选择的 Chrome User Data 路径及必要 Local State profile 元信息。Profile API 身份与目录不能自动对应；用户选择并通过结构验证后关联，否则独立只读。监听父目录处理原子替换，300 ms 去抖、30 s 元数据核验、唤醒重扫。解析失败保留最后有效树。在线事件源优先，文件不能覆盖 live 状态；缓存状态、文件状态和最后同步时间分别可见。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

打开/关闭 Chrome 后修改测试书签，观察来源状态和重连；采集应用对文件的访问证据与文件哈希，排除 Chrome 自己正常写入的时间段。

## 故障与回退

停止 watcher、取消路径关联；保留已缓存来源与侧车，不删除 Chrome 文件。
