# 09 网页预览证据

日期：2026-10-11。任务保持 `in_progress`。未提交，未归档，未 push。

检查只重跑了一次 `node .trellis/tasks/10-10-mb-09-webpage-preview/evidence/native-preview.mjs`，退出码 0。`handedToSystem` 由这次观察计算，不是写死的 true。没有恢复 `\system32\rundll32.exe` 后缀判据。

## 验收

| 项 | 状态 | 证据 |
|---|---|---|
| AC09-1 | PASS | 本次探针：资料 A 与 `/a` 打开独立窗口，刷新、后退、前进到达对应页面。面板写明当前资料、选中网址和预览窗口网址。预览窗口 HWND 与主窗口不同，标题为网页预览，`FG_SAME=True`。 |
| AC09-2 | PASS | 关闭后会话保留，与界面「关闭后会话保留」一致。清除后 A 的页面存储为空，B 的目录仍在。B 首次 `localStorage` 与 Cookie 为空。main 写入的 `mb09main` 在预览页不可见。存储由预览页脚本写入。 |
| AC09-3 | PASS | 预览页脚本调用 37 个 command，全部 `DENIED`，消息含 `not allowed`。主窗口同一 `invoke('get_bridge_state')` 返回 `MAIN_OK 2`，不是同一条拒绝。主文档没有 `#mb09`。`cmdkey` 的 Markbridge 行数前后都是 1，没有 `Markbridge.Pairing`。报告不保存目标名或哈希。 |
| AC09-4 | PASS | 失败页写明网站没有在应用内网页中打开，并说明不保证该网站或 Chrome 登录状态可用。点击「在 Chrome 中打开」之后才出现交接进程，父进程是桌面进程。映像文件名是 `rundll32.exe`。命令行原文是 `"rundll32.exe" url.dll,FileProtocolHandler http://127.0.0.1:1/mb09-fail`。唯一线程状态 `5:5`，挂起计数 1，子进程数 0；进程在该状态下被结束，`url.dll` 没有执行。日常 Chrome 书签文件 1 个，长度 849515，SHA256 前后相同。浏览器进程数由 22 变为 21，新增 0，没有启动日常 Profile。 |
| 父 V11 | PASS | 本次 PrintWindow 截到独立预览窗口和主窗口。资料隔离、37 条预览页拒绝、危险 scheme、弹窗和下载拦截成立。预览调试目标没有出现在主窗口的 9347 列表里；拒绝回执来自预览页脚本，不是主窗口调用失败。 |

## 本次检查命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test -p markbridge-desktop --locked` | 0 | PASS。11 passed。未重跑 `cargo test --workspace --locked`。 |
| `pnpm test` | 1 | Vitest 11 files / 91 tests passed。`node --test` 仅 `scripts/foundation.test.mjs` 失败：扩展 manifest 权限含 `scripting` 与 `activeTab`。未改该测试，也未改扩展 manifest。 |
| `pnpm lint` | 1 | 4 个错误都在 `.omp/extensions/trellis/index.ts`。未改该文件。 |
| `node .trellis/tasks/10-10-mb-09-webpage-preview/evidence/native-preview.mjs` | 0 | 本次检查只跑了这一次。标准输出 `{"passed":true,"failed":[],"error":null}`。 |
| `pnpm --filter @markbridge/desktop tauri dev` | — | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri build` | — | NOT_RUN |
| `pnpm build:native` | — | NOT_RUN |
| `pnpm typecheck` | — | 本次 NOT_RUN |
| `pnpm protocol:check` | — | 本次 NOT_RUN |
| `cargo build -p markbridge-desktop` | 0 | 上一次检查为了让探针使用新的 debug exe。这次未重跑。 |

## 原生探针

除探针外，上表其余命令仍是上一次检查的结果，这次没有重跑。Rust 源码未改。

这次运行的应用数据在 `mb09-preview-JFQ4Tm\app-data`，路径不含 `com.markbridge.desktop`。未设置 `WEBVIEW2_USER_DATA_FOLDER`。未改 AppliedDPI。验收进程设置 `MARKBRIDGE_OPEN_HTTP_SUSPEND=1`。报告保存命令行原文，PASS 不依赖映像路径后缀。点击之后创建的进程映像文件名是 `rundll32.exe`，唯一线程挂起计数为 1，随后结束，`url.dll` 没有执行。日常 Chrome 书签的长度和 SHA256 未变。没有新增浏览器进程，没有启动日常 Profile。这次运行里 AC09-1、AC09-2、AC09-3 和 V11 的检查仍为通过。

`cmdkey` 只记录 Markbridge 行数和是否出现 `Markbridge.Pairing`。前后行数都是 1，`hasPairing` 都是 false。

截图是这次窗口：

- `evidence/native-preview-ready.png`：`PRINT_OK=True`，`FG_SAME=True`，HWND `8980734`，标题为网页预览
- `evidence/native-main-ready.png`：`PRINT_OK=True`，HWND `16255782`
- `evidence/native-main-failed.png`：`PRINT_OK=True`，同一主窗口 HWND `16255782`。交接证据来自进程观察，不来自这块截图像素。

调试端口 9347 上没有探针 URL 的第二个 page 目标。预览 WebView2 使用单独数据目录，不保证能复用该端口。
