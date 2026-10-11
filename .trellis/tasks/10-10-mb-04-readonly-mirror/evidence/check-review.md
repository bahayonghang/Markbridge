# 04 check review

日期：2026-10-11。检查方：Trellis check。HEAD `531bc53`。工作树未提交。

未打开日常 Chrome Profile，未改真实书签，未点击配对、重连或吊销，未写 `Markbridge.Pairing`。未挂起主机。测试使用临时目录和内存凭据。

## 修复

- `mirror_bookmarks` 按 `chrome_id` 文本排序读回。`10` 会排在 `9` 前面，重新打开后兄弟顺序不再是 `position`。`active_from_stored` 现按父节点和 `position` 还原前序。`reopen_preserves_sibling_position_not_chrome_id_text_order` 调用 `attach_file_mirror`、关闭后再 `Bridge::open`，并比较节点顺序。
- `offline_browse_does_not_rewrite_chrome_files_or_grant_writes` 只在 User Data 根目录找 `Bookmarks.bak`。Chrome 的备份在资料目录。该测试、枚举测试和 live 测试现在遍历目录树，并比较资料目录内 History、Cookies、Login Data、Bookmarks 与 Local State 的字节和 mtime。

## 合同

- 镜像写入：`read_limited` 以只读打开。`write_mirror` 只写 `mirror_sources` 和 `mirror_bookmarks`。测试比较字节和 mtime，并确认目录树中没有 `Bookmarks.bak`。没有 syscall 写入计数器。
- 解析失败：半写 JSON 走 `rescan_file_mirrors`，状态为 stale，节点和 revision 保持。删除和目录改名后为 unavailable，节点仍在。原子替换由目录 watcher 在 5 秒内读到新标题，测试本身不调用 rescan。
- 枚举：`enumerate_user_data` 只读所选目录的 `Local State`，并对 Local State 里通过目录键校验的资料调用 `Bookmarks` 的 `metadata`。不打开 History、Cookies、Login Data，也不进入未传入的目录。字节和 mtime 不能证明文件未被打开。未打开这一点来自该函数源码。
- 在线缓存：文件变化后 `bookmarks_cache` 仍是关联前的树。`can_write_browser` 在 `mirror_view` 里固定为 false。`authorize_browser_write` 对 mirror id 返回 ReadOnly；profile 仅在 live 且未吊销时返回 Ok，该方法不写 Chrome。断线后 profile 授权为 ReadOnly。
- 相同 URL：`mirror_storage_does_not_copy_tags_or_metadata_by_url` 调用 `put_mirror`。`write_mirror` 不写 `bookmark_metadata` 或 `bookmark_tags`。两个 profile 的相同 URL 仍使用各自 `bookmark_id`。该测试不经过 `attach_file_mirror`。
- 监听：`spawn_watch` 对 Bookmarks 的父目录使用 `RecursiveMode::NonRecursive`。原子替换测试在 5 秒内观察到更新，因此走到了 notify 路径。`DEBOUNCE` 为 300 ms，测试上限是 5 秒，没有测量 300 ms。`METADATA_INTERVAL` 为 30 s，没有测试等到这一拍。`main.rs` 在 `RunEvent::Resumed` 调用 `rescan_file_mirrors`，没有测试发出该事件。这三项不记 PASS。
- 其他路径：本任务 diff 没有 MCP、Native Messaging host、Netscape HTML 导入或导出。协议里的 `export_html` 仍被拒绝。身份仍是 `profileId`、`chromeId`、`bookmarkId`、`sourceEpoch` 和已有的 `mirrorSourceId`。文件缓存键是 `(mirror_source_id, chrome_id)`。
- 协议：`pnpm protocol:check` 退出 0。`canWriteBrowser` 的 schema 为 `const: false`。mirror 与 file_mirror 没有日志宏。桌面 `eprintln` 只有 `STARTUP_FAILED` 和 `SHUTDOWN_FAILED`。`BridgeState` 不含绝对路径和书签树。浏览缓存会把标题和 URL 返回界面，不写入日志。
- V04：未做休眠、桌面重连、Chrome 重启或 10 秒测量。保持 UNVERIFIED。

## 未改

未改父任务目录、其他任务目录、`.gitignore`、`AGENTS.md`、`.trellis/workspace`、`.trellis/spec`。未提交。
