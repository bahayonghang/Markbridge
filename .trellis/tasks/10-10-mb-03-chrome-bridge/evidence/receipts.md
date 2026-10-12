# 03 证据收据

日期：2026-10-11。平台：Windows。HEAD `d9b9b9056545498d7a8eef15e6dfc3c7604954f3`。03 产品与证据仍在未提交工作树。本检查未改产品源码，未重跑原生 harness，未打开 Tauri 窗口，未挂起主机，未改写两条 FAIL JSON。

日常 Chrome Profile、日常书签和已安装扩展未使用。

两条 FAIL 保持原样：

- `native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json`
- `native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json`

原生通过记录：`native-42e65e09-b831-40ee-afd3-e616899a359c.json`。文件没有 `failureCode`。`finishedAt` 为 2026-10-11T08:11:30.986Z。harness 只在 catch 里把 `process.exitCode` 设为 1。该文件没有 `native_driver` FAIL，对应该次进程没有进入 catch。本检查未重跑这条命令。按脚本，该次退出码为 0。

凭据：`crates/core/src/bridge/credentials.rs` 的 Windows target 保存命名空间和引用。service 常量为 `Markbridge`，user 常量为 `pairing`。本检查 `cargo test --workspace --locked` 中 `bridge::credentials::tests::task_namespace_reference_roundtrip_avoids_comment_limit` 通过。JSON 中两个临时 Profile 都到达记录，首个全树 11003 节点，错误令牌控制项为 PASS。

完整命令输出：`evidence/v01-command-log.txt`。开始时间 2026-10-11T04:22:40-04:00。工作目录为仓库根。

## 本检查命令

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm lint` | 0 | PASS |
| `pnpm typecheck` | 0 | PASS |
| `pnpm build` | 0 | PASS。产物检查写明 MV3 popup/options/worker 存在，权限只有 bookmarks/storage/alarms |
| `pnpm protocol:check` | 0 | PASS。生成结果与已跟踪输出一致 |
| `pnpm test` | 0 | PASS。Vitest 50，node:test 5 |
| `cargo fmt --all -- --check` | 1 | FAIL。差异只在 `crates/core/examples/credential_probe.rs` |
| `cargo clippy --workspace --all-targets -- -D warnings` | 101 | FAIL。`markbridge-core` 5 条 |
| `cargo test --workspace --locked` | 0 | PASS。core 19，protocol 10 |
| `pnpm build:native` | 0 | PASS。构建与扫描都使用 `target/release/markbridge-desktop.exe`，12902912 字节，SHA256 `ba5458c833a42b679f356c756b51f6bfc538d19731b2caa5cdb24820c3e1eb65` |
| `pnpm test:e2e` | 无 | NOT_RUN。implement.md 列出，本检查命令清单未包含 |
| `pnpm --filter @markbridge/desktop tauri dev` | 无 | NOT_RUN。打开窗口会碰到未验证的桌面只读项，本检查不把它升为 PASS |
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs` | 0（JSON 推断） | 本检查未重跑。见上文 `42e65e09` |

## 原生 JSON 控制项

| 控制项 | 状态 |
|---|---|
| B10K fixture，10000 书签，1000 文件夹，深度 20，seed 20261010 | PASS |
| 错误令牌，profiles 为空且 pending 未绑定 | PASS |
| 配对后全树 11003 节点 | PASS |
| 两个临时 Profile，缓存计数 11003 与 4 | PASS |
| 100 次变更到缓存，p50 668 / p95 800 / max 871 ms | PASS（缓存边界） |
| 最终树与 `chrome.bookmarks.getTree()` 一致，11003 节点 | PASS |
| 显式重连 565 ms | PASS |
| worker 强制停止后 alarm 恢复 | PASS |
| 浏览器重启后全树 digest 与重启前一致，11003 节点 | PASS |
| 空闲等待开始时无 debugger、无扩展页 | NOT_RUN |
| 空闲 309308 ms 后同一 session 收到事件 | PASS |
| 吊销后缓存节点数不变 | PASS |
| 导入、排序、OS 休眠、Tauri GUI | UNVERIFIED |

100 条计时的 kind 为 created、changed、moved、removed 各 25。没有 reordered，没有 import。最大值 871 ms，全部小于等于 3000 ms。边界写明排除 Tauri UI。本检查用 JSON 重新计算了分位，与文件中的 p50/p95/max 一致。

## AC03

| 项 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| AC03-1 | `cargo test --workspace --locked`；原生 JSON `42e65e09` | 0；0（JSON 推断，本次未重跑） | PASS | 两个临时 Profile 的缓存计数为 11003 与 4。错误令牌控制项 PASS。错误 Origin 的 WebSocket 为 403，sqlite 的 profiles 与 bookmarks_cache 为 0。protocolVersion 2 的 hello 得到 `UnsupportedVersion`，同一计数仍为 0，拒绝发生在 pair/hello 写入之前。错误资料绑定的 `authenticate` 返回错误，缓存为空。本次 workspace 测试退出 0，包含这些断言。 |
| AC03-2 | `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-sort-harness.mjs`；先前原生 JSON `42e65e09` | 0；0（JSON 推断，排序短运行未重跑该文件） | PASS | 新增、修改、移动、删除各 25 次进入缓存，最终树与 `42e65e09` 那次 Chrome 的 `getTree()` 一致。树校验没有固定三根数量。`native-21247130-0cf1-44ac-9327-041a27019d6f.json` 使用新的临时 Profile 和独立应用数据目录。配对后新建一个文件夹和三个书签，再用 `chrome.bookmarks.move` 改变顺序。缓存顺序与 `chrome.bookmarks.getTree()` 都是 `8`、`6`、`7`，退出码 0。读取走已有 harness cache RPC。没有 HTML 导入或导出。 |
| AC03-3 | `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-gap-harness.mjs` | 0 | PASS | `native-6642b276-1972-4b2c-a12c-ba1d55e815db.json`。临时 Profile，独立应用数据。配对码只改端口：桥 6879，代理 6880。丢弃 1 个 event 帧后，下一次创建使缓存与 `chrome.bookmarks.getTree()` 一致，5 个节点，包含被丢弃的 chromeId `5` 和随后的 `6`。重放 1 个已转发 event 帧，树仍为 5 个节点，cursor lastSeq 2、revision 2 未变。扣留一个 event 帧，先转发后一个，再转发被扣留的帧，树为 7 个节点，包含 chromeId `7` 和 `8`。四个事件 kind 都是 created。没有 HTML 导入或导出。 |
| AC03-4 | `pnpm --filter @markbridge/desktop tauri dev`；PrintWindow；`cargo fmt --all -- --check`；`cargo clippy --workspace --all-targets -- -D warnings` | 窗口进程被终止，无自行退出码；PrintWindow 0；fmt 0；clippy 0 | PASS | 位图 `evidence/native-cached-readonly.png` 的资料行是 `缓存 · 只读`，同一行上方是 `1 个资料`。复制出的 sqlite 有 1 条未吊销 profile、2 个未删除缓存节点。`cmdkey /list` 在种子前、窗口运行中和进程结束后都没有 `Markbridge.Pairing` 目标。早前记录仍在原处：吊销后缓存节点数不变，显式重连 565 ms，空闲 309308 ms 后同一 session 收到事件。 |

## 父级门槛

| 门槛 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| V01 | `evidence/v01-command-log.txt` 的 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm protocol:check`、`pnpm test`（该日志未在本次原生重建时重跑）；本检查复跑的 `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --locked`；本次 `pnpm build:native`；本次 `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | pnpm 五项先前 0；fmt 0；clippy 0；cargo test 0；build:native 0；artifact scan 0 | PASS | `pnpm build:native` 退出 0。Tauri 写出 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`。随后扫描退出 0。扫描路径是这个 exe，字节和 SHA256 相同。同一命令再跑 `scripts/check-artifacts.mjs`，覆盖这次 beforeBuildCommand 写出的 `apps/desktop/dist`，以及盘上已有的 `apps/extension/dist`。01 的原生空状态、尺寸、错误显示和两次正常关闭没有新证据。 |
| V02 | `cargo test --workspace --locked`；`pnpm test`；原生 JSON `42e65e09` | 0；0；0（JSON 推断） | PASS | 未授权令牌没有写入身份。错误 Origin 后 profiles 与凭据为空。错误认证后缓存为空。相同 chromeId 在两个 Profile 的 bookmarkId 不同，JSON 缓存计数为 11003 与 4。吊销后缓存节点数不变。扩展测试断言 create/update/move/remove/removeTree 未被调用。 |
| V03 | 无 UI 计时命令 | 无 | NOT_RUN | 合同要求 100 次变化从 Chrome 事件到 UI 可见均不超过 3 秒，并记录 p50/p95/max，最终树等价。03 界面是连接诊断和节点计数，不显示单条书签变更。树界面属于 05。缓存侧 100 次、p50 668 ms、p95 800 ms、max 871 ms 只作缓存证据，不作为本行 PASS。 |
| V04 | 原生 harness（本检查未重跑）；排序短运行见下文；`node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-gap-harness.mjs` | 0（JSON 推断）；0；0 | UNVERIFIED | worker 停止、浏览器重启和 565 ms 显式重连有记录。排序短运行退出码 0，只覆盖一个文件夹的 `move` 顺序。断档短运行退出码 0，覆盖丢事件、重复和乱序后的全树。导入和 OS 休眠未跑。本检查不挂起主机。合同要求这些恢复都测到。整行不能记 PASS。 |

## 缓存读取

日期：2026-10-11。读取走本机已缓存的扁平节点。HTML 导入和 HTML 导出不是这条读取路径，本次没有运行。

| 命令 | 退出码 |
|---|---:|
| `cargo fmt --all -- --check` | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 |
| `cargo test -p markbridge-core --lib --locked` | 0 |

V03 仍为 NOT_RUN。V04 仍为 UNVERIFIED。AC03-2 仍为 UNVERIFIED。这次缓存读取不把这三行改成 PASS。

## 本检查复跑

日期：2026-10-11。工作目录为仓库根。HEAD `d9b9b9056545498d7a8eef15e6dfc3c7604954f3`。产品源码未改。只复跑下面三条。

`evidence/v01-command-log.txt` 里的 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm protocol:check`、`pnpm test` 退出码都是 0。那些命令在这次 Rust 改动之前运行。本次没有重跑，不把它们记成新跑。

`pnpm build:native` 本次 NOT re-run。日志里的 release 产物在 tree、list、search、get、count 进入源码之前构建。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `cargo fmt --all -- --check` | 0 | PASS。无差异输出。 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。No issues found。 |
| `cargo test --workspace --locked` | 0 | PASS。30 passed，7 suites，5.36s。 |

缓存读取测试 `cache_reads_use_local_nodes_and_see_applied_creates` 在这次 workspace 测试里。它调用 tree、list、search、get、count。树经 `accept_tree` 的 `receive(tree_full)` 写入。创建经 `receive(created)`。之后 search 看到 chromeId `40`。缺 profile 的五个调用都返回 `WrongProfile`。

当时 V01 仍为 FAIL，因为当时 `pnpm build:native` 未重跑。随后的结果见「V01 原生重建」。V02 保持 PASS。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。HTML 导入保持 UNVERIFIED，不作为新的产品缺陷。

## V01 原生重建

日期：2026-10-11。工作目录为仓库根。产品源码未改。未重跑原生 harness，未打开 Tauri 窗口，未挂起主机。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm build:native` | 0 | PASS。日志 `evidence/v01-native-rebuild.log`。构建写出 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`。脚本内嵌扫描同一文件：12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`。 |
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | 0 | PASS。日志 `evidence/v01-artifact-scan.log`。该命令调用 `scripts/native-build.mjs` 的 `inspectNativeArtifact`，路径为上面这个 exe，字节和 SHA256 相同。然后加载 `scripts/check-artifacts.mjs`。desktop dist 由这次 `beforeBuildCommand` 写出。extension dist 不是这次构建写出的。 |

V01 改为 PASS。V02、V03、V04 与 AC03 各行未改。

## 只读窗口观察

日期：2026-10-11。启动前 `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop\markbridge.sqlite` 不存在。命令 `pnpm --filter @markbridge/desktop tauri dev` 打开了标题为 `Markbridge · 签桥` 的窗口。UI Automation 一次遍历没有读到状态文案。详情在 `evidence/native-readonly-window.md`。进程随后被终止，任务状态 cancelled，持续时间 113.58s，没有自行退出码。没有点击配对，没有调用 `begin_pairing`。

AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。

## PrintWindow 只读窗口

日期：2026-10-11。命令 `pnpm --filter @markbridge/desktop tauri dev` 再次打开标题为 `Markbridge · 签桥` 的窗口。截图命令 `pwsh -NoProfile -File C:\Users\lyh\AppData\Local\Temp\markbridge-printwindow.ps1` 退出码 0。位图页眉为 `未连接 · 只读`。详情在 `evidence/native-readonly-window.md`。进程随后被终止，任务状态 cancelled，持续时间 310.93s，没有自行退出码。没有点击配对，没有调用 `begin_pairing`。`cmdkey /list` 没有 Markbridge 目标行。

AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。

2026-10-11 位图复读：直接查看 `evidence/native-readonly-window.png`，看到 `未连接 · 只读`、`监听尚未启动`、`0 个资料`。这是未连接窗口，不是 live 之后断开。AC03-4 不标 PASS，保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。V01 与 V02 未改。

## 排序短运行

日期：2026-10-11。工作目录为仓库根。临时 Chrome Profile 为 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-sort-p1-h3Co3D`。应用数据目录为 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-sort-app-j55ag7`。日常 Chrome Profile、日常书签和已安装扩展未使用。未打开书签管理器，未写 Netscape HTML，未挂起主机，未重建 10000 书签语料，未做 5 分钟空闲等待。

未改写：

- `native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json`
- `native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json`

`native-21247130-0cf1-44ac-9327-041a27019d6f.json` 的 `priorFailures` 列出上面两条。`42e65e09` 里的 `actual_chrome_import_reorder_OS_suspend_and_Tauri_GUI` 仍是 UNVERIFIED。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-sort-harness.mjs` | 0 | PASS。文件夹 chromeId `5`。创建顺序 `6`、`7`、`8`。`chrome.bookmarks.move` 把 `8` 放到 index 0。缓存顺序 `8`、`6`、`7`。`chrome.bookmarks.getTree()` 顺序 `8`、`6`、`7`。position 为 0、1、2。 |

AC03-2 改为 PASS。AC03-3 保持 UNVERIFIED。AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。OS 休眠仍未跑，不标 PASS。

## 事件断档短运行

日期：2026-10-11。工作目录为仓库根。临时 Chrome Profile 为 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-gap-p1-1SJ2jN`。应用数据目录为 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-gap-app-9Xigpd`。日常 Chrome Profile、日常书签和已安装扩展未使用。未打开书签管理器，未写 Netscape HTML，未挂起主机，未重建 10000 书签语料，未做 5 分钟空闲等待。

未改写：

- `native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json`
- `native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json`

`native-6642b276-1972-4b2c-a12c-ba1d55e815db.json` 的 `priorFailures` 列出上面两条。扩展拿到的配对码只把端口改成 127.0.0.1 上的代理端口 6880。桥仍监听 6879。代理转发双向 WebSocket 帧。证据没有帧正文、配对码或凭据。四个书签事件的 kind 都是 created。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-gap-harness.mjs` | 0 | PASS。丢弃 1 个 event 帧后，下一次创建让缓存树与 `chrome.bookmarks.getTree()` 一致，5 个节点，包含被丢弃的 chromeId `5`。重放 1 个已转发 event 帧，树仍是 5 个节点，cursor 的 lastSeq 与 revision 都保持 2。先转发后一个 event 帧，再转发被扣留的帧，树为 7 个节点，包含 chromeId `7` 和 `8`。 |

AC03-3 改为 PASS。AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。OS 休眠仍未跑，不标 PASS。

## 缓存只读窗口

日期：2026-10-11。工作目录为仓库根。验收数据目录是环境变量 `MARKBRIDGE_APP_DATA`，指向 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-cache-XMWB66`。没有使用 `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop`。没有打开日常 Chrome Profile。没有点击配对、重新连接或吊销。没有挂起主机。没有 HTML 导入。

`bridge_harness` 使用新的 `Markbridge.Task03.{uuid}` 命名空间，在临时目录写出 `bridge.sqlite`。其中 1 条 profile 未吊销，0 条已吊销，2 个缓存节点未删除。该文件复制为同一目录的 `markbridge.sqlite`。

`pnpm --filter @markbridge/desktop tauri dev` 在这个环境变量下打开标题为 `Markbridge · 签桥` 的窗口。PrintWindow 使用 `PW_RENDERFULLCONTENT`，退出码 0，`PRINT_OK=True`。1114 宽的位图把右侧状态裁掉。窗口加宽到 1800×1080 后再次 PrintWindow，覆盖 `evidence/native-cached-readonly.png`。资料行右侧是 `缓存 · 只读`，已配对资料右侧是 `1 个资料`。资料名称是 `缓存资料`，缓存节点为 2。

`cmdkey /list` 里 `Markbridge.Pairing` 目标数在种子前、窗口运行中和进程结束后都是 0。harness 命名空间当时有 1 个 `Markbridge.Task03` 目标。计数完成后删除了这个目标，删除后该目标数为 0。`Markbridge.Pairing` 仍是 0。

进程随后被终止。`markbridge-desktop` 不在，端口 1420 已关闭。没有自行退出码。

早前原生记录仍在「原生 JSON 控制项」：吊销后缓存节点数不变，显式重连 565 ms，空闲 309308 ms 后同一 session 收到事件。

| 命令 | 退出码 |
|---|---:|
| `cargo fmt --all -- --check` | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 |

AC03-4 改为 PASS。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。

## V01 再次原生构建

日期：2026-10-11。工作目录为仓库根。产品源码未改。未打开 Tauri 窗口，未使用日常 Chrome Profile，未重跑原生 harness，未挂起主机。

构建前 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe` 为 12913152 字节，SHA256 `84f02bc1a87dc8af69160a1e100bb916b5a137fe0d31121fb60ca2289340bbc3`，最后写入 2026-10-11T05:09:38-04:00。`apps/desktop/src-tauri/src/main.rs` 最后写入 2026-10-11T06:29:19-04:00。上文父级门槛里的 V01 PASS 行记录的是那个旧 exe，保留不删。当时该 exe 的 ASCII 与 UTF-16LE 都没有 `MARKBRIDGE_APP_DATA`，V01 曾改回 FAIL。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm build:native` | 0 | PASS。开始 2026-10-11T06:45:45-04:00，结束 2026-10-11T06:46:07-04:00。日志 `evidence/v01-appdata-rebuild.log`。写出 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，12920832 字节，最后写入 2026-10-11T06:46:07-04:00，SHA256 `0d7557d9ed3e5c45b40e8ee88a777c12a50480e3e65d86012312619970c711bf`。 |
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | 0 | PASS。开始 2026-10-11T06:46:15-04:00，结束 2026-10-11T06:46:16-04:00。日志 `evidence/v01-appdata-scan.log`。扫描路径、字节和 SHA256 与刚写出的 exe 相同。 |

字节扫描：ASCII `MARKBRIDGE_APP_DATA` 为 1，UTF-16LE 为 0。

| 门槛 | 命令 | 退出码 | 状态 | 依据 |
|---|---|---:|---|---|
| V01 | `pnpm build:native`；`node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/v01-artifact-scan.mjs` | 0；0 | PASS | 扫描文件是这次 `pnpm build:native` 写出的 `D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`。12920832 字节。SHA256 `0d7557d9ed3e5c45b40e8ee88a777c12a50480e3e65d86012312619970c711bf`。字节扫描找到 `MARKBRIDGE_APP_DATA`。 |

V02、V03、V04 与 AC03 各行未改。

## Chrome import end

日期：2026-10-12。工作目录为仓库根。只启动了一个临时 Chrome。用户数据目录是 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-import-N10dc9\user-data`。进程映像在同一次运行的 `chrome-app`，没有改 `C:\Program Files\Google\Chrome\Application\initial_preferences`。日常 Chrome Profile、日常 Bookmarks 和已安装扩展未使用。没有打开书签管理器，没有读写 Netscape HTML，没有挂起主机。`Markbridge.Pairing` 在运行前和结束后都是 0。命名空间是 `Markbridge.Task03.d27028`，结束后该目标数是 0。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-harness.mjs` | 1 |

开始 2026-10-12T07:23:05Z，结束 2026-10-12T07:28:47Z。记录在 `evidence/import-d27028.json`。Chrome 为 `Chrome/155.0.8059.39`。`Extensions.loadUnpacked` 加载了 `apps/extension/dist`，扩展 id 为 `blbapbmincddiilocledaajcegiekbfk`。

这次试的是首次运行 `initial_preferences` 里的 JSON 书签块，不是 HTML 文件。调试管线在扩展加载之后不再返回，进程随后退出，退出码 1。退出前直接读取临时资料的 `Bookmarks`：253 字节，仍是播种内容，没有该探针，也没有 `First Run` 哨兵。线上记录是空的，没有 `import_ended`。事件没有发出。

导入保持 UNVERIFIED。V04 总行不改为 PASS。OS 休眠仍未跑。

## 2026-10-12 trellis-check 导入

复核没有再启动 Chrome，也没有重跑 harness。`git diff --name-only -- apps crates packages scripts tests` 无输出。`evidence/import-d27028.json` 的 `importEnded` 为 false，`exitCode` 为 1，`credentialBefore.pairing` 为 0，`credentialAfter.pairing` 为 0，`dailyProfileTouched` 为 false。上文「Chrome import end」引用该文件，导入与 V04 总行都未标 PASS。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。这次只读计算，没有写该文件。

`evidence/chrome-import-harness.mjs` 的 `--user-data-dir` 在 `os.tmpdir()` 下 `markbridge-03-import-*` 的 `user-data`。启动页是 `about:blank`，扩展页是 `chrome-extension://…/options.html`。源码没有 `chrome://bookmarks`，也没有读写 Netscape HTML。`task.json` 的 status 是 `in_progress`。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-harness.mjs` | 1 |

导入保持 UNVERIFIED。V04 总行仍为 UNVERIFIED。OS 休眠仍未跑。03 未归档。

## Bookmarks 文件替换

日期：2026-10-12。工作目录为仓库根。第二个来源：临时 Chrome 配对后退出，只改该临时资料的 `Bookmarks` JSON，再启动同一资料。没有 `initial_preferences`，没有 oplock，没有 Netscape HTML，没有书签管理器，没有 `chrome://bookmarks`，没有挂起主机。没有改产品源码。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 在运行前和结束后都是长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`Markbridge.Pairing` 前后都是 0。命名空间 `Markbridge.Task03.e9d63e` 结束后是 0。配对码只记录长度 220。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-file-harness.mjs` | 1 |

观察文件是 `evidence/import-file-e9d63e.json`。开始 2026-10-12T08:09:06.689Z，结束 2026-10-12T08:09:48.619Z。Chrome 为 `Chrome/155.0.8059.39`。第一次启动的扩展 id 是 `blbapbmincddiilocledaajcegiekbfk`，全树 3 个节点，与缓存一致。退出后临时资料没有 `Bookmarks` 文件。向 `Default/Bookmarks` 写入一份 Chrome JSON，比第一次多一个书签。`Bookmarks.bak` 没有变化。

第二次启动没有自己打开这个已写入 Preferences 的 unpacked 扩展。选项页协议是 `chrome-error:`。启动阶段线上是空的。之后用 `Extensions.loadUnpacked` 又加载了同一个 `apps/extension/dist`。服务工作线程在暂停时装上了 `onImportEnded` 探针，计数是 0。线上是 `hello`、`get_tree`、`tree_full` 和 ping/pong，没有 `import_ended`。扩展状态到了 `connected`。完整树与 `chrome.bookmarks.getTree()` 一致，4 个节点，多出的书签在两边都在。

`import-file-baa97e.json`、`import-file-9af42b.json`、`import-file-0dfcbe.json`、`import-file-580fb0.json`、`import-file-b07930.json` 是同一条命令在这次观察前的中断，不是另一个来源。

这个来源保持 UNVERIFIED。V04 总行不改为 PASS。OS 休眠仍未跑。

## 2026-10-12 trellis-check Bookmarks 文件替换

复核没有再启动 Chrome，没有重跑 `chrome-import-file-harness.mjs`，也没有重跑 `chrome-import-harness.mjs`。上文「Bookmarks 文件替换」未改。没有改 JSON。

`evidence/import-file-e9d63e.json` 的 `command` 是 `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-file-harness.mjs`。`exitCode` 是 1。`importEnded` 是 false。`chromeEmittedImportEnded` 是 false。`probeBegan` 是 0。`probeEnded` 是 0。`wire` 是 `c:hello`、`s:hello_result`、`s:get_tree`、`c:tree_full`、`s:ping`、`c:ping`、`s:pong`、`c:pong`，没有 `import_ended`。`startupWire` 是空的。`extensionStatuses` 只有 `connected`，没有 `reconciling`。`pass` 是 false。`treesMatch` 是 true。`probePresent` 是 true。`credentialBefore.pairing` 和 `credentialAfter.pairing` 都是 0。`dailyProfileTouched` 是 false。`productEdited` 是 false。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 只读重算：长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`dailyBefore` 和 `dailyAfter` 都是这两个值。没有写该文件。`Get-Item` 与 `Get-FileHash -Algorithm SHA256` 的退出码是 0。

`git diff --name-only -- apps crates packages scripts tests` 无输出，退出码 0。`git status --short` 对这组路径和 `task.json` 也无输出，退出码 0。`task.json` 的 status 仍是 `in_progress`。

`chrome-import-file-harness.mjs` 不读取、不写入 Netscape HTML，不打开 `chrome://bookmarks`，不使用 `initial_preferences`，不做 oplock。`--user-data-dir` 是临时目录 `markbridge-03-import-file-*` 下的 `user-data`。JSON 的 `root` 是 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-import-file-m2GYk5`。它不指向日常 Profile。

第二次启动时，Preferences 里仍有第一次的扩展记录：`extensionPersisted` 是 true。扩展目标当时不在：`extensionTargetSeen` 是 false，选项页协议是 `chrome-error:`，`optionsError` 是 `OPTIONS_NOT_READY`。`Extensions.loadUnpacked` 在这之后才调用，`lateLoadUnpacked` 是 true。`onImportEnded` 探针在后加载的 service worker 暂停时装上，`probeInstallPhase` 是 `paused`。第一次启动的扩展在书签模型加载时没有作为监听方。这次运行不能证明加载当时没有该事件。

`import-file-baa97e.json`、`import-file-9af42b.json`、`import-file-0dfcbe.json`、`import-file-580fb0.json`、`import-file-b07930.json` 的 command 与这次相同。五份的 `importEnded` 都是 false，`exitCode` 都是 1。它们仍记为同一条命令在 `e9d63e` 之前的中断。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-file-harness.mjs` | 1 |

导入保持 UNVERIFIED。V04 总行保持 UNVERIFIED。OS 休眠仍未跑。03 未归档。

## 预置 Bookmarks 单进程

日期：2026-10-12。工作目录为仓库根。第三个来源：启动前把一份普通 Chrome Bookmarks JSON 写进临时资料的 `Default\Bookmarks`，只启动一次 Chrome。第一条 CDP 命令是 `Target.setAutoAttach`，`waitForDebuggerOnStart` 为 true，第二条是 `Extensions.loadUnpacked`，加载 `apps/extension/dist`。没有 `initial_preferences`，没有 oplock，没有第二次启动，没有 Netscape HTML，没有书签管理器，没有 `chrome://bookmarks`，没有挂起主机。没有改产品源码。没有设置 `Markbridge.Pairing`。

`evidence/import-live-e1e088.json` 在启动 Chrome 之前退出。`chromeLaunchCount` 是 0。`loadUnpackedCalls` 是 0。退出码是 1。当时读到的日常 Bookmarks 已经不是提示中的长度，命令没有继续。

观察文件是 `evidence/import-live-c55f21.json`。临时目录前缀是 `markbridge-03-import-live-`。命名空间是 `Markbridge.Task03.c55f21`。配对码只记录长度 220。`Markbridge.Pairing` 前后都是 0。该命名空间结束后是 0。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-live-harness.mjs` | 1 |

开始 2026-10-12T08:37:08.335Z，结束 2026-10-12T08:37:32.492Z。Chrome 为 `Chrome/155.0.8059.39`。扩展 id 是 `blbapbmincddiilocledaajcegiekbfk`。`chromeLaunchCount` 是 1。`loadUnpackedCalls` 是 1。`cdpOrder` 的前两项是 `Target.setAutoAttach`、`Extensions.loadUnpacked`。播种文件 903 字节，4 个节点，含探针 `https://example.invalid/mb03-live-probe`。

服务工作线程在脚本运行前暂停。恢复前 `Bookmarks.Storage.TimeToLoadAtStartup2` 的 count 是 1。恢复后 `chrome.bookmarks.getTree()` 等待 0 ms，探针已经在树里。出厂扩展的 `onImportEnded` 监听当时已经装上。监听没有发生在模型加载完成之前。

线上是 `pair`、`hello`、`get_tree`、`tree_full` 和 ping/pong，没有 `import_ended`。扩展状态只有 `connected`，没有 `reconciling`。监听装上之后的计数是 began 0、ended 0。这个计数不覆盖模型加载那一段。没有观察到 Chrome 发出 `import_ended` 之后被 `bridge.ts` 丢掉。完整树与 `chrome.bookmarks.getTree()` 一致，4 个节点，探针在两边都在。`pass` 是 false。

这个来源保持 UNVERIFIED。V04 总行不改为 PASS。OS 休眠仍未跑。缺少该事件不是产品缺陷。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 在这次启动前和结束后都是长度 850304，SHA256 `09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D`。`dailyProfileTouched` 是 false。这与提示中的长度 849515、SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` 不一致。本次命令没有写该文件。

## 2026-10-12 trellis-check 预置 Bookmarks 单进程

复核没有再启动 Chrome，没有重跑 `chrome-import-live-harness.mjs`、`chrome-import-file-harness.mjs` 或 `chrome-import-harness.mjs`，没有写或恢复日常 `Bookmarks`。上文「预置 Bookmarks 单进程」未改。没有改 JSON。没有跑 `task.py`。

两份 JSON 的 `command` 都是 `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-live-harness.mjs`。`source` 都是 `preseeded-bookmarks-one-process`。

`evidence/import-live-c55f21.json` 的 `exitCode` 是 1。`importEnded` 是 false。`chromeEmittedImportEnded` 是 false。`probeBegan` 是 0。`probeEnded` 是 0。`listenerAttachedBeforeModelFinished` 是 false。`extensionStatuses` 只有 `connected`，没有 `reconciling`。`pass` 是 false。`chromeLaunchCount` 是 1。`loadUnpackedCalls` 是 1。`wire` 没有 `import_ended`。`dailyBefore` 和 `dailyAfter` 都是长度 850304、SHA256 `09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D`。`expectedDaily` 是长度 849515、SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。

`evidence/import-live-e1e088.json` 开始于 2026-10-12T08:35:59.669Z，早于 `c55f21` 的 2026-10-12T08:37:08.335Z。`exitCode` 是 1。`chromeLaunchCount` 是 0。`failureCode` 是 `DAILY_GUARD`。它是同一条命令在启动 Chrome 之前的退出，不是第二个来源。当前 `chrome-import-live-harness.mjs` 里没有 `DAILY_GUARD` 这个字符串；`DAILY_GUARD` 只留在这份 JSON 里。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 只读重算：长度 850304，SHA256 `09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D`。与 `c55f21` 的前后摘要相同，与更早的 849515 / `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` 不同。文件里没有文本 `mb03-live-probe`。当前 harness 的播种内容不在这个文件里。打开方式是 `FileAccess.Read`。没有写该文件。该命令退出码是 0。

`git diff --name-only -- apps crates packages scripts tests` 无输出，退出码 0。`git status --short` 对这组路径和 `task.json` 也无输出，退出码 0。`task.json` 的 status 仍是 `in_progress`。

`chrome-import-live-harness.mjs` 不读取、不写入 Netscape HTML。它不打开 `chrome://bookmarks`。它不使用 `initial_preferences`，只在临时资料里确认该文件不存在。它不做 oplock。`--user-data-dir` 来自 `os.tmpdir()` 下的 `markbridge-03-import-live-*`。`c55f21` 的 `root` 是 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-import-live-wqRkjq`。

出厂监听没有在书签模型加载完成之前装上。`listenerAttachedBeforeModelFinished` 是 false。恢复前加载直方图的 count 已经是 1，`getTree` 当时 0 ms 返回，探针已经在树里。线上没有 `import_ended`，探针计数也是 0。这些观察都在模型加载完成之后。这次运行不能证明加载当时没有该事件。

导入保持 UNVERIFIED。V04 总行保持 UNVERIFIED。OS 休眠仍未跑。03 未归档。

## Bookmarks 读保持

日期：2026-10-12。工作目录为仓库根。启动前把一份普通 Chrome Bookmarks JSON 写进临时资料的 `Default\Bookmarks`，并保持对该文件的读，使书签模型完不成加载。保持用的是 `FSCTL_REQUEST_OPLOCK`，不是 `initial_preferences`，也不是首次运行的 level-1 保持。调试管线在读保持期间有应答。第一条 CDP 命令是 `Target.setAutoAttach`，`waitForDebuggerOnStart` 为 true，第二条是 `Extensions.loadUnpacked`。出厂监听装上时 `Bookmarks.Storage.TimeToLoadAtStartup2` 仍没有样本，计数按 0 记录，然后才放开这次读。只有一个 Chrome 进程，`loadUnpacked` 只调用一次。没有 Netscape HTML，没有书签管理器，没有 `chrome://bookmarks`，没有挂起主机。没有改产品源码。没有设置 `Markbridge.Pairing`。

临时目录前缀是 `markbridge-03-import-hold-`。`0fd93c` 的 `root` 是 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-import-hold-Lesrwj`。命名空间是 `Markbridge.Task03.0fd93c`。配对码只记录长度 220。`Markbridge.Pairing` 前后都是 0。该命名空间结束后是 0。

| 命令 | 退出码 |
|---|---:|
| `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-hold-harness.mjs` | 1 |

观察文件是 `evidence/import-hold-0fd93c.json`。开始 2026-10-12T08:58:39.155Z，结束 2026-10-12T08:59:05.521Z。Chrome 为 `Chrome/155.0.8059.39`。扩展 id 是 `blbapbmincddiilocledaajcegiekbfk`。`chromeLaunchCount` 是 1。`loadUnpackedCalls` 是 1。`listenerAttachedBeforeModelFinished` 是 true。`histogramBeforeResume` 和 `histogramAtListener` 都是 0。放开之后探针 began 0、ended 0，结束时仍是 0。线上是 `pair`、`hello`、`get_tree`、`tree_full` 和 ping/pong，没有 `import_ended`。扩展状态只有 `connected`，没有 `reconciling`。后端连接状态经过 `reconciling` 后到 `live`。完整树与 `chrome.bookmarks.getTree()` 一致，4 个节点，探针在两边都在。`pass` 是 false。`chromeEmittedImportEnded` 是 false。`droppedByBridge` 是 false。

这个来源保持 UNVERIFIED。V04 总行不改为 PASS。OS 休眠仍未跑。缺少该事件不是产品缺陷。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 在这次启动前和结束后都是长度 850304，SHA256 `09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D`。`dailyProfileTouched` 是 false。命令结束后只读重算仍是这两个值。文件里没有文本 `mb03-live-probe`。

`git diff --name-only -- apps crates packages scripts tests` 无输出。产品文件没有改。

## 2026-10-12 trellis-check Bookmarks 读保持

复核没有再启动 Chrome，没有重跑 `chrome-import-hold-harness.mjs`、`chrome-import-live-harness.mjs`、`chrome-import-file-harness.mjs` 或 `chrome-import-harness.mjs`，没有写或恢复日常 `Bookmarks`。上文「Bookmarks 读保持」未改。没有改 `evidence/import-hold-0fd93c.json`。没有跑 `task.py`。没有改产品文件。

`evidence/import-hold-0fd93c.json` 的 `command` 是 `node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-import-hold-harness.mjs`。`exitCode` 是 1。`importEnded` 是 false。`chromeEmittedImportEnded` 是 false。`droppedByBridge` 是 false。`probeBegan` 是 0。`probeEnded` 是 0。`probeAfterRelease` 是 began 0、ended 0。`chromeLaunchCount` 是 1。`loadUnpackedCalls` 是 1。`holdStatus` 是 `RELEASED`。`level1FirstRunHold` 是 false。`initialPreferences` 是 false。`pass` 是 false。`extensionStatuses` 只有 `connected`。`reconcilingAfterImport` 是 false。`reconcilingReached` 是 false。`wire` 是 `c:pair`、`s:pair_result`、`c:pair`、`s:pair_result`、`c:hello`、`s:hello_result`、`s:get_tree`、`c:tree_full`、`s:ping`、`c:ping`、`c:pong`、`s:pong`，没有 `import_ended`。`states` 是 `null`、`reconciling`、`live`。这三项由 `rememberState()` 写入，来源是后端 profile connection。扩展状态没有 `reconciling`。后端 connection 里的 `reconciling` 不计入导入核对。

`listenerAttachedBeforeModelFinished` 是 true。`histogramBeforeResume`、`histogramAtListener`、`histogramAfterListeners` 都是 0。`bookmarkLoadHistograms` 是 `[]`。`histogramError` 是 null。`histogramCount` 在 `Browser.getHistograms` 没有返回行时返回 0，并把这些行写入 `bookmarkLoadHistograms`。这次 0 表示查询 `Bookmarks.Storage.TimeToLoad` 当时没有样本，不是某一行上的 count。`histogramCount` 只在 `prepareWorker` 中调用，两次都在 `releaseHold()` 之前。放开读保持之后没有再取直方图。`cdpOrder` 只保留前 12 条，后面的 CDP 调用不在这份列表里。

`probePresent` 是 true。`nodeCount` 和 `seedNodeCount` 都是 4。`treesMatch` 是 true。模型加载了播种内容。`import_ended` 的缺失在这次加载之后：放开后和结束时的探针都是 began 0、ended 0，线上没有 `import_ended`。`chromeEmittedImportEnded` 为 false，没有观察到该事件发出后被桥丢掉。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 只读重算：长度 850304，SHA256 `09F2A5C24BA0EE3E3AFF521B90B8509411C2BCDABFE743746A670B07515C1B9D`。与 JSON 的 `dailyBefore` 和 `dailyAfter` 相同。字节搜索没有 `mb03-live-probe`。打开方式是 `FileAccess.Read`，共享是 `FileShare.ReadWrite`。没有写该文件。该命令退出码是 0。

`git diff --name-only -- apps crates packages scripts tests` 无输出，退出码 0。`git status --short --branch` 对这组路径和 `task.json` 只有 `## main`，退出码 0。`task.json` 的 status 仍是 `in_progress`，`completedAt` 仍是 null。

`chrome-import-hold-harness.mjs` 不读取、不写入 Netscape HTML。它不打开 `chrome://bookmarks`。它不写入 `initial_preferences`，只确认临时资料里没有该文件。`level1FirstRunHold` 保持 false。读保持是临时 `Bookmarks` 上的 `FSCTL_REQUEST_OPLOCK`。`--user-data-dir` 来自 `os.tmpdir()` 下的 `markbridge-03-import-hold-*`，其下是 `user-data`。`0fd93c` 的 `root` 是 `C:\Users\lyh\AppData\Local\Temp\markbridge-03-import-hold-Lesrwj`。

导入保持 UNVERIFIED。V04 总行保持 UNVERIFIED。OS 休眠仍未跑。03 未归档。
