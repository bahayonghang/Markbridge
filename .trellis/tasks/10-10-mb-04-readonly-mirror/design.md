# 04 只读文件镜像与离线恢复：设计

## 当前与边界

实现落在 `crates/core/src/mirror/`、`crates/core/src/bridge/file_mirror.rs`、`crates/core/src/storage/migrations/003_mirror.sql`、`apps/desktop/src/App.tsx`、`apps/desktop/src-tauri/src/main.rs` 和 `tests/fixtures/bookmarks/`。完整列表在 `task.json` 的 `relatedFiles`。

只读取用户给出的 Chrome User Data 绝对路径。枚举只打开该目录的 `Local State`，并查看所列资料目录下 `Bookmarks` 的元数据。枚举不读取 History、Cookies、Login Data，也不进入兄弟浏览器目录。目录键拒绝空串、超过 128 字符、含 `/ \ \0 :`、`.` 和 `..`。`Local State` 只提供目录键和显示名。

扩展 API 身份与磁盘目录保持分开。`associate_file_mirror` 仅在 `file_status` 为 `current` 且 `same_identity` 成立时把关联记为 confirmed。比较 chrome id、parent、position、kind、url、folder_type。标题不参与比较。文件陈旧、不可用或结构不一致时，已有 confirmed 降为 independent。

监听 `Bookmarks` 的父目录，非递归。去抖 300 ms，元数据间隔 30 s。`RunEvent::Resumed` 调用 `rescan_file_mirrors`。解析失败保留最后有效树，并把 `file_status` 标为 stale 或 unavailable。

在线 profile 缓存优先。文件重载只写 `mirror_sources` 与 `mirror_bookmarks`。文件重载不写 `bookmarks_cache`，也不写 Chrome 的 Bookmarks 或 Local State。`can_write_browser` 恒为 false。`authorize_browser_write` 对 mirrorSourceId 返回 ReadOnly。对 profileId，仅当连接为 live 且未吊销时返回 Ok。该方法不执行写入。离线浏览器写命令不排队。

文件来源状态在 `BridgeState.mirrors` 的 `MirrorSourceState`，字段为 `file_status`、`association`、`watching`、`can_write_browser`。`BridgeConnection` 保持 unpaired、connecting、reconciling、live、cached_read_only、error。本地绝对路径不进入 IPC 状态。所选目录缺失、不是目录、为相对路径，或 Local State 不可读时，返回 `ErrorCode::PathUnavailable`。Display 为 `PATH_UNAVAILABLE`，不含路径。

父设计文件未改。`.trellis/spec` 未改。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。

## 数据与兼容

输入和输出使用 02 的版本化 DTO。身份字段沿用 profileId、chromeId、bookmarkId、sourceEpoch、mirrorSourceId。新增列在 migration `003_mirror.sql`，不改 001。`mirror_sources` 插入必须写出列名。`selected_path` 有唯一索引。

## 验证边界

行为测试调用 `enumerate_user_data`、`attach_file_mirror`、`rescan_file_mirrors`、`mirror_tree`、`associate_file_mirror`、`authorize_browser_write`。fixture 在 `tests/fixtures/bookmarks/`。本轮没有打开桌面窗口，没有挂起主机，没有使用日常 Chrome Profile。命令和退出码在 `evidence/receipts.md`。

## 故障与回退

`detach_file_mirror` 停止 watcher，并把关联降为 independent。已缓存节点保留。不删除 Chrome 文件。
