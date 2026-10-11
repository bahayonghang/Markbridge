# 04 证据收据

日期：2026-10-11。平台：Windows。分支 `main`，HEAD `531bc53`，工作树未提交。

检查方：Trellis check。不沿用实施代理此前的 PASS 标签。

工具：cargo 1.99.0 (5f94df478 2026-08-27)，rustc 1.99.0 (b940084d7 2026-09-28)，node v26.7.0。

日常 Chrome Profile、日常书签、Local State、已安装扩展和 `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop` 未使用。测试读写临时目录中的 fixture 副本。桌面窗口未打开。主机未挂起。没有截图。没有写入 `Markbridge.Pairing`。

fixture：

- `tests/fixtures/bookmarks/local-state-single.json`
- `tests/fixtures/bookmarks/local-state-multi.json`
- `tests/fixtures/bookmarks/bookmarks-personal.json`
- `tests/fixtures/bookmarks/bookmarks-work.json`
- `tests/fixtures/bookmarks/bookmarks-updated.json`

多 Profile fixture 含目录键 `..\outside`。枚举结果不包含该键。

## 本轮命令

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | PASS。先因 `mirror/tests.rs` 行宽失败，`cargo fmt -p markbridge-core` 后复测为 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。No issues found |
| `cargo test --workspace --locked` | 0 | PASS。39 passed，7 suites，5.50s |
| `pnpm typecheck` | 0 | PASS。protocol、desktop、extension 与 tools 的 tsc 完成 |
| `pnpm protocol:check` | 0 | PASS。Protocol generation matches tracked outputs |
| `pnpm exec vitest run apps/desktop/src packages/protocol/src` | 0 | PASS。6 suites，35 passed，0 failed。`browses a stale file mirror without offering a browser write` passed |
| `node --test scripts/protocol.test.mjs` | 0 | PASS。2 passed，0 failed |
| `pnpm test` | 无 | NOT_RUN |
| `pnpm test:e2e` | 无 | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` | 无 | NOT_RUN |
| `pnpm build:native` | 无 | NOT_RUN |

## AC04

| 项 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| AC04-1 | `cargo test --workspace --locked` | 0 | PASS | `enumeration_lists_only_the_selected_user_data_profiles` 调用 `enumerate_chrome_user_data`。结果为 Personal / Default、Work / Profile 1。Profile 2、`..\outside`、另一份 User Data 和 Edge 目录不在结果中。History、Cookies、Login Data、Local State、已列和未列 Bookmarks 的字节与 mtime 不变，目录树中没有 `Bookmarks.bak`。缺失路径、相对路径、文件路径、Local State 为目录返回 `PATH_UNAVAILABLE`，Display 为 `PATH_UNAVAILABLE`。`a_locked_local_state_is_a_recoverable_path_error` 在 Windows 独占锁下返回同一错误，解锁后得到 1 个资料。`directory_key_rejects_traversal` 拒绝 `..` 和 `..\outside`。不读取 History、Cookies、Login Data 由 `enumerate_user_data` 源码确认：只读 Local State，并对合法目录键的 Bookmarks 取 metadata。字节和 mtime 不能证明这些文件未被打开 |
| AC04-2 | `cargo test --workspace --locked` | 0 | PASS | `invalid_reads_keep_the_last_valid_mirror` 调用 `attach_file_mirror`。原子替换后 watcher 在 5 秒内读到 Updated，该步不调用 rescan。半写 `{"roots":` 后 `rescan_file_mirrors` 得到 stale，节点与 revision 不变。删除 Bookmarks、把资料目录改名为 `renamed` 后均为 unavailable，节点仍在。恢复 personal fixture 后为 current。300 ms、30 s 和 `RunEvent::Resumed` 不在本行 PASS 内，见下表 |
| AC04-3 | `cargo test --workspace --locked` | 0 | PASS | `live_profile_cache_wins_over_a_changed_file_mirror` 在 Live 下 `associate_file_mirror` 成功，`can_write_browser` 为 false。mirror 授权为 ReadOnly，live profile 授权为 Ok。attach 与 associate 前后 Bookmarks 字节和 mtime 不变，Local State 字节和 mtime 不变。测试改写 Bookmarks 后 rescan，不改变测试写入后的字节和 mtime；profile 缓存仍是关联前的树；文件镜像为 Independent 且含 `https://example.com/b`；再次关联返回 WrongProfile。断线后 profile 授权为 ReadOnly。`mismatched_file_source_stays_read_only` 中两份文件 `same_identity` 不成立，两个来源都是 Independent 且不能写。`mirror_storage_does_not_copy_tags_or_metadata_by_url` 调用 `put_mirror`：相同 URL 的另一个 profile 没有 metadata，tag 仍只在原来的 `bookmark_id`。该存储测试不经过 `attach_file_mirror`；`write_mirror` 只写 mirror 表 |
| AC04-4 | `cargo test --workspace --locked`；`pnpm exec vitest run apps/desktop/src packages/protocol/src` | 0；0 | PASS | `offline_browse_does_not_rewrite_chrome_files_or_grant_writes` 在 profiles 为空时浏览 Nested。attach、rescan、detach 之后 Default Bookmarks、Local State、Profile 1 Bookmarks 的字节与 mtime 不变。User Data 目录树中没有 `Bookmarks.bak`。授权为 ReadOnly。界面测试看到「文件陈旧 · 保留缓存」和「浏览器写入已禁用。在线资料优先于已关联的文件来源。」，没有名称匹配「写入」或「应用」的按钮，浏览缓存显示标题与 URL。界面测试 mock 了 backend，文件字节由 Rust 测试证明 |

## 监听时间

| 项 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| Bookmarks 父目录 watcher | `cargo test --workspace --locked` 中的 `invalid_reads_keep_the_last_valid_mirror` | 0 | PASS | 原子替换后 5 秒内树更新，该步没有调用 rescan。30 秒元数据拍在此窗口之前不会触发。源码对资料目录使用 `RecursiveMode::NonRecursive`。测试没有在子目录制造事件，因此非递归本身没有单独测量 |
| 300 ms 去抖 | 无测量命令 | 无 | NOT_RUN | `DEBOUNCE` 用在上述 watcher 路径上。测试只要求 5 秒内更新 |
| 30 s 元数据核对 | 无 | 无 | NOT_RUN | `METADATA_INTERVAL` 只出现在 `spawn_watch`。没有测试推进或等待 30 秒 |
| `RunEvent::Resumed` 重扫 | 无 | 无 | NOT_RUN | `main.rs` 在 `Resumed` 调用 `rescan_file_mirrors`。没有测试发出该事件 |

## 父级门槛

| 门槛 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| V04 | 无休眠、无桌面重连、无 Chrome 重启命令 | 无 | UNVERIFIED | 本轮没有挂起主机，没有打开桌面窗口，没有点击配对、重连或吊销，没有重启 Chrome，没有测量 10 秒重连。文件镜像测试不覆盖 worker 重启、丢事件或导入。导入没有走 Netscape HTML，也没有走 MCP |
| V05 | `cargo test --workspace --locked` | 0 | PASS | 原子替换、半写 JSON、删除、目录改名后保留最后有效树。半写为 stale。有效文件返回后为 current。attach、rescan、detach、associate 前后比较 Bookmarks 与 Local State 的字节和 mtime，并检查目录树中没有 `Bookmarks.bak`。没有 syscall 写入计数器。30 秒核对和休眠恢复不计入本行 |

`pnpm test`、`pnpm test:e2e`、`tauri dev`、`build:native` 保持 NOT_RUN。V04 保持 UNVERIFIED。
