# 03 检查记录

日期：2026-10-11。检查代理只写了本任务 `evidence/`。产品源码未改。V01 为 PASS。V02、V03、V04 与 AC03 各行未改。

HEAD `d9b9b9056545498d7a8eef15e6dfc3c7604954f3`。命令记录在 `evidence/receipts.md` 的「本检查复跑」。先前 pnpm 日志是 `evidence/v01-command-log.txt`。

## 缓存读取

文件：`crates/core/src/bridge/mod.rs` 的 `tree`、`list`、`search`、`get`、`count`。

五者都先取 `profile_nodes`。该函数只返回这个 `profileId` 的 `ActiveProfile.nodes`。没有这个 profile 时返回 `WrongProfile`。读取不再次查询 SQLite，不调用 `chrome.bookmarks`，也不发送 WebSocket 命令。`CacheTreeNode`、`CachePage`、`CacheNode`、`CacheCount` 只在 core。`packages/protocol` 的已有 bridge-state、pairing-offer、wire-message 生成物里没有这五个读取。

测试：`crates/core/src/bridge/tests.rs` 的 `cache_reads_use_local_nodes_and_see_applied_creates`。

该测试调用了五个方法。初始树经 `accept_tree` → `request_tree` / `receive(tree_full)` 进入 bridge 缓存，不是脱离 bridge 的常量断言。另一个已配对 profile 搜索 `Alpha` 得到空列表。缺 profile 的五个调用都是 `WrongProfile`。创建经 `receive(created_event)`，`receive` 返回 false。随后 `search(..., "Epsilon", ...)` 得到一个节点，chromeId 为 `40`，parent 为 `1`。本次 `cargo test --workspace --locked` 退出 0，这不是空心测试。

| 方法 | 结果 |
|---|---|
| tree | OK |
| list | OK |
| search | OK |
| get | OK |
| count | OK |

## 命令

| 命令 | 退出码 | 本次 |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | 是 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | 是 |
| `cargo test --workspace --locked` | 0 | 是。30 passed，7 suites，5.36s |
| `pnpm lint`、`typecheck`、`build`、`protocol:check`、`test` | 0 | 否。见 `v01-command-log.txt`，在这次 Rust 改动之前 |
| `pnpm build:native` | 0 | PASS。`D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`。日志 `evidence/v01-native-rebuild.log` |
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | 0 | PASS。`inspectNativeArtifact` 扫描同一 exe，随后 `scripts/check-artifacts.mjs` 扫描 dist。日志 `evidence/v01-artifact-scan.log` |

日志里的 fmt 退出码 1 和 clippy 退出码 101 已过期。

## 门槛

| 门槛 | 状态 | 依据 |
|---|---|---|
| V01 | PASS | fmt、clippy、cargo test 本次为 0。`pnpm build:native` 退出 0。扫描退出 0。扫描路径 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe` 与刚构建的 exe 相同，12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`。 |
| V02 | PASS | 沿用上一次已记录的未授权零写入、扩展写 API 未调用、相同 chromeId 不串 Profile。本次缓存读取不改变这项。 |
| V03 | NOT_RUN | 03 不显示单条书签变更。缓存读取测试不是 UI 计时。不标 PASS。 |
| V04 | UNVERIFIED | 导入、排序、OS 休眠和原生丢事件注入仍未跑。本检查不挂起主机。不标 PASS。 |

AC03-1 改为 PASS。合同句的错误版本现在有 `UnsupportedVersion` 和 sqlite 零行断言，其余子句沿用已通过的测试和 `42e65e09`。这项不是由缓存读取测试单独升上去的。

AC03-2 保持 UNVERIFIED。排序没有执行。HTML 导入保持 UNVERIFIED，用户已拒绝该路径，不作为新的产品缺陷。

AC03-3 保持 UNVERIFIED。库测试已经在断档之后比对全树，但原生 harness 没有丢事件、乱序或重复注入。不把库测试写成这项的 PASS。

AC03-4 保持 UNVERIFIED。断开后的桌面只读没有在 Tauri 窗口里看到。

两条 FAIL JSON 未改。日常 Chrome Profile 未使用。

## 位图复读

日期：2026-10-11。检查代理直接查看 `evidence/native-readonly-window.png`。没有启动 Tauri，没有使用 UI Automation，没有改产品源码。

位图上看到：`未连接 · 只读`（页眉右侧）、`监听尚未启动`（「本机连接」右侧）、`0 个资料`（「已配对资料」右侧）。同屏是「启动连接」，没有已配对资料，没有 live 之后的断开过渡。

AC03-4 不标 PASS，保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。V01 与 V02 未改。

## 排序证据复读

日期：2026-10-11。只读 `evidence/chrome-sort-harness.mjs` 和 `evidence/native-21247130-0cf1-44ac-9327-041a27019d6f.json`。没有启动 Chrome，没有改产品源码，没有改写两条 FAIL JSON。

脚本成功路径调用 `chrome.bookmarks.move`，把创建顺序的最后一项移到 index 0。`chromeChildren` 用 `chrome.bookmarks.getTree()` 取同一文件夹的子节点 id。`remember` 按 position 排缓存顺序，并在两边长度都是 3、position 唯一、id 序列相同时把 `ordersMatch` 设为 true。失败路径会把 `ordersMatch` 写成 false，并记录 `native_driver` FAIL。

JSON 键序与脚本写入顺序一致，`JSON.stringify` 往返相同。`cacheOrder` 与 `chromeOrder` 都是 `8`、`6`、`7`，`ordersMatch` 为 true。`createdOrder` 为 `6`、`7`、`8`，`movedChromeId` 为 `8`，`moveIndex` 为 0。控制项 `actual_chrome_move_child_order` 为 PASS，`exitCode` 为 0。这是脚本能写出的结果。

上文「AC03-2 保持 UNVERIFIED」是排序执行前的记录，保留不删。当前 AC03-2 以 `evidence/receipts.md` AC03 表的 PASS 行和「排序短运行」的 PASS 行为准。本检查不改那一行。V03、V04、AC03-3、AC03-4 不标 PASS。

## 事件断档证据复读

日期：2026-10-11。只读 `evidence/chrome-gap-harness.mjs` 和 `evidence/native-6642b276-1972-4b2c-a12c-ba1d55e815db.json`。没有启动 Chrome，没有改产品源码，没有改写更早的 native JSON。

`takeFrame` 按 WebSocket 帧头取完整客户端帧。缓冲长度不够时返回 null，半帧不转发。文本帧解开掩码后解析 JSON。分片帧、未掩码帧和非文本数据帧会失败。`selfCheck` 覆盖逐字节拼帧、16 位长度、ping 和分片拒绝。

`mode === 'drop'` 丢掉 1 个 `type === 'event'` 的帧，不写上游，然后回到 `pass`。下一帧创建事件被转发。`matchedTree` 调用 `chrome.bookmarks.getTree()`，按 chromeId 比对缓存里未删除的节点。

重复路径复制已经转发的 `lastEventFrame`，确认它是完整 event 帧后，整帧再写上游一次。乱序路径在 `hold` 扣留一帧；下一帧到达时先写这一帧，再写被扣留的帧。三次 `record(..., 'PASS')` 都在对应的 `matchedTree` 成功之后。失败路径写 `native_driver` FAIL，并把进程退出码设为 1。

JSON 三个控制项都是 PASS：`dropped_event_tree`、`duplicate_event_tree`、`reordered_event_tree`。控制项和顶层的 `droppedFrames` 都是 1。`replayedFrames` 是 1。`reorderedFrames` 是 true。`exitCode` 是 0。`treesMatch` 是 true。`eventKinds.created` 是 4，`eventFrames` 是 4，`forwardedEvents` 是 3。重放不经过客户端解析，所以不增加 `eventFrames` 和 `forwardedEvents`。丢弃后转发 1 帧，乱序时一次转发 2 帧，合计 3。键顺序与脚本 `JSON.stringify` 的插入顺序一致。这些值是脚本成功路径会写出的。

丢弃、重复、乱序均为 PASS。`evidence/receipts.md` 的 AC03-3 行保持 PASS。上文「AC03-3 保持 UNVERIFIED」是这次短运行之前的记录，保留不删。AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。本检查不把这三行标成 PASS。

## 缓存只读位图与数据目录

日期：2026-10-11。检查代理直接查看 `evidence/native-cached-readonly.png`，并读了 `apps/desktop/src-tauri/src/main.rs` 的 `database_directory`。没有启动 Tauri，没有运行 `pnpm build:native`，没有改产品源码。

位图上看到 `1 个资料`（「已配对资料」右侧）和 `缓存 · 只读`（「缓存资料」右侧）。同屏缓存节点为 2，来源版本为 1。

`MARKBRIDGE_APP_DATA` 未设置时仍调用 `app.path().app_data_dir()`。变量已设置时，路径不是绝对目录就返回固定字符串 `invalid acceptance data directory`，该字符串不含路径。`eprintln` 只有 `STARTUP_FAILED: Unable to start Markbridge.` 和 `SHUTDOWN_FAILED`。两句都不含路径或凭据。setup 失败时丢弃原始错误。

`evidence/receipts.md` 的 AC03 表把 AC03-4 标为 PASS。该格依据是这张位图上的上述两句，加上早前记录：吊销后缓存节点数不变、显式重连 565 ms、空闲 309308 ms 后同一 session 收到事件。这三条在 `native-42e65e09-b831-40ee-afd3-e616899a359c.json` 里分别是 `actual_chrome_revocation_zero_late_cache_writes` PASS、`actual_chrome_explicit_reconnect` PASS（elapsed 565）、`actual_chrome_idle_5min_event_same_session` PASS（elapsed 309308）。同格还写了这次窗口的 sqlite 副本和 `cmdkey` 计数。上文「AC03-4 保持 UNVERIFIED」是这张位图之前的记录，保留不删。当前 AC03-4 以该 PASS 行为准。

V03 保持 NOT_RUN。V04 保持 UNVERIFIED。本检查不把这两行标成 PASS。

上文 V01 PASS 对应 `target/release/markbridge-desktop.exe`，12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`，最后写入 2026-10-11T05:09:38-04:00。`main.rs` 最后写入 2026-10-11T06:29:19-04:00。当时这个 exe 的字节数和 SHA256 仍相同。ASCII 与 UTF-16LE 中 `MARKBRIDGE_APP_DATA` 出现次数都是 0。该 exe 早于这次 `main.rs` 修改，不含这个环境变量。当时 V01 改回 FAIL。`evidence/receipts.md` 里较早的 V01 PASS 行是上一次重建的记录，保留不删。

## V01 再次原生构建

日期：2026-10-11。工作目录为仓库根。产品源码未改。未打开 Tauri 窗口，未使用日常 Chrome Profile。

构建前同一路径的 exe 为 12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`，最后写入 2026-10-11T05:09:38-04:00。构建开始 2026-10-11T06:45:45-04:00。没有正在运行的 `markbridge-desktop`。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm build:native` | 0 | PASS。结束 2026-10-11T06:46:07-04:00。日志 `evidence/v01-appdata-rebuild.log`。编译 `markbridge-desktop v0.1.0`，release 在 20.93s 完成。写出 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，12920832 字节，最后写入 2026-10-11T06:46:07-04:00，SHA256 `0d7557d9ed3e5c45b40e8ee88a777c12a50480e3e65d86012312619970c711bf`。脚本内嵌扫描同一文件，字节和 SHA256 相同。 |
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | 0 | PASS。开始 2026-10-11T06:46:15-04:00，结束 2026-10-11T06:46:16-04:00。日志 `evidence/v01-appdata-scan.log`。扫描路径、12920832 字节和 SHA256 与刚写出的 exe 相同。 |

对这个 exe 做字节扫描。ASCII `MARKBRIDGE_APP_DATA` 为 1。UTF-16LE 为 0。

| 门槛 | 状态 | 依据 |
|---|---|---|
| V01 | PASS | `pnpm build:native` 退出 0。`node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` 退出 0。扫描文件是这次命令写出的 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，12920832 字节，SHA256 `0d7557d9ed3e5c45b40e8ee88a777c12a50480e3e65d86012312619970c711bf`。字节扫描找到 `MARKBRIDGE_APP_DATA`。 |

V02、V03、V04 与 AC03 各行未改。
