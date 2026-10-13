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

## 2026-10-12 去抖、30 秒核对与 Resumed

主机未挂起，没有发送电源事件，没有打开桌面窗口，没有读写日常 Chrome 的 Bookmarks 或 Local State。`DEBOUNCE` 与 `METADATA_INTERVAL` 未改。测试只读写临时目录里的 fixture 副本。

`cargo fmt --all -- --check` 退出码 0。

`cargo test --locked --offline -p markbridge-core --lib mirror::` 退出码 0。9 passed，84 filtered out，0.80s。该命令包含原有 `invalid_reads_keep_the_last_valid_mirror`。

| 项 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| 300 ms 去抖 | `cargo test --locked --offline -p markbridge-core --lib debounce_settles_the_second_file_only_after_300ms` | 0 | PASS | 1 passed，92 filtered out，0.39s。`attach_file_mirror` 挂上临时 Personal fixture。Tokio 时间冻结期间先后原子替换为 Updated fixture 和 Work fixture。`advance(299ms)` 后树仍等于 `parse_bookmarks` 的 Personal 结果，也不等于 Updated。再 `sleep(20ms)`，冻结时钟越过 300 ms，树等于 Work 的解析结果，不等于 Updated |
| 30 s 元数据核对 | `cargo test --locked --offline -p markbridge-core --lib metadata_interval_loads_the_file_written_while_unwatched` | 0 | PASS | 1 passed，92 filtered out，0.52s。`shutdown` 停掉 watcher 后写入 Updated fixture，再 `open`。此后没有写 Bookmarks。`advance(300ms)` 后树仍是 Personal，notify 去抖没有应用这次修改。`sleep(30s)` 后树等于 Updated 的解析结果。节点已替换，因此这次 30 s tick 的 `reload(..., true)` 没有因 stamp 相同返回 `Unchanged`，而是继续 `load_bookmarks` |
| `RunEvent::Resumed` 重扫 | `cargo test --locked --offline -p markbridge-desktop --bin markbridge-desktop resumed_run_event_rescans_a_mirror_the_watcher_has_not_applied` | 0 | PASS | 1 passed，12 filtered out，0.32s。`app.run` 与该测试调用同一个 `on_run_event`。测试传入 `RunEvent::Resumed`。写入 Updated fixture 后、调用前，树仍是 Personal。调用后树等于 Updated 的解析结果。这段时间 Tokio 时钟增加不足 300 ms，去抖超时没有触发。测试没有直接调用 `rescan_file_mirrors`，也没有休眠主机 |

V04 仍为 UNVERIFIED。本轮没有休眠、没有桌面重连、没有重启 Chrome。04 未归档。

## 2026-10-12 trellis-check 去抖与重扫

主机未挂起，没有发送电源事件，没有打开桌面窗口，没有读写日常 Chrome 的 Bookmarks 或 Local State。`DEBOUNCE` 仍是 300 ms。`METADATA_INTERVAL` 仍是 30 s。测试只读写临时目录里的 fixture 副本。本轮命令没有加 `--offline`。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo test --locked -p markbridge-core --lib debounce_settles_the_second_file_only_after_300ms` | 0 | 1 passed，92 filtered out，0.40s |
| `cargo test --locked -p markbridge-core --lib metadata_interval_loads_the_file_written_while_unwatched` | 0 | 1 passed，92 filtered out，0.58s |
| `cargo test --locked -p markbridge-desktop --bin markbridge-desktop resumed_run_event_rescans_a_mirror_the_watcher_has_not_applied` | 0 | 1 passed，12 filtered out，0.32s |

| 项 | 状态 | 依据 |
|---|---|---|
| 300 ms 去抖 | PASS | `advance(299ms)` 后树仍是 Personal，不等于 Updated。冻结时钟再增加 20 ms 后，树等于 Work，不等于 Updated。落定的是第二次原子替换。`DEBOUNCE` 仍是 `Duration::from_millis(300)` |
| 30 s 元数据核对 | PASS | 原先 `sleep(30s)` 后才读树，notify 去抖可以在这段虚拟时间里先换树。断言改为：`Bridge::open` 经 `arm_saved_watches` 拉起 watcher 后，树在整整 300 ms 和 `METADATA_INTERVAL - 50ms` 时仍是 Personal。再前进 100 ms，Tokio 时钟等于 `METADATA_INTERVAL + 50ms`，树变为 Updated。这 100 ms 完不成 300 ms 去抖。`spawn_watch` 在循环外消费一次立即 tick，该 tick 不调用 `reload`；50 ms 前树仍是旧树，所以立即 tick 没有应用这次写入。循环里的 30 s tick 调用 `reload(..., true)`。重新打开后 stamp 为 `None`，这次调用不会因 stamp 相同返回 `Unchanged`。`open` 之后没有再写 Bookmarks |
| `RunEvent::Resumed` 重扫 | PASS | `app.run` 调用 `on_run_event`。测试把 `RunEvent::Resumed` 传入该函数，没有自己调用 `rescan_file_mirrors`。调用前树是 Personal，调用后临时镜像变为 Updated。这段时间 Tokio 时钟增加不足 300 ms，watcher 去抖没有触发。这不是操作系统休眠 |

V04 仍为 UNVERIFIED。本轮没有休眠、没有桌面重连、没有重启 Chrome。04 未归档。

## 2026-10-13 当前结案决定

上述历史结果保留。本轮核对 AC1–4 和补充收据均已通过，用户此前已明确无需同一个真实 OS 休眠项，现同步验收决定为 WAIVED；真实执行 NOT_RUN、原始 V04 UNVERIFIED，不改写为 PASS。任务按调整后的范围完成，用户本轮授权提交及归档。详细映射见 [closeout-2026-10-13.md](closeout-2026-10-13.md)。
