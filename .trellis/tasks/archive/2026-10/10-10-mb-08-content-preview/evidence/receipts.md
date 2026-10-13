# 08 证据

日期：2026-10-11。未提交，未归档。

## 验收

| 项 | 状态 | 证据 |
|---|---|---|
| AC08-1 | PASS | HTTP fixture 返回标题、description 摘要、GIF 来源图片；无元图时 `image` 为空。失败 DTO 带中文原因。React 面板渲染标题、摘要、`data:image/gif` 和「没有来源图片」。桌面窗口 NOT_RUN。 |
| AC08-2 | PASS | Fixture 同时发出 20 个请求，取消前 19 个，结果为 `cancelled` 且标题、摘要、图片为空；最后一条是 `No Image`。随后拒绝连接，同一 URL 返回 `cached` 和 `离线缓存 · …`。取消命令不返回正文。 |
| AC08-3 | PASS | Fixture 阻止 `javascript:`、环回、私网、链路本地、云元数据、DNS 重绑定、指向 `127.0.0.1` 的重定向、gzip 膨胀和 10 秒挂起。来源图片 `http://127.0.0.1/secret.gif` 失败，正文仍在。生产抓取没有允许私网的设置或环境开关。 |
| AC08-4 | PASS | 运行 id `f0edec26-610a-4405-9100-222fd727e127`，退出码 0。临时 user-data-dir，CDP `Extensions.loadUnpacked` 加载本次 `apps/extension/dist`，没有 `--load-extension`。未打开 popup 时 worker `executeScript` 为 `NO_PERMISSION`，扩展存储没有页面文字。扩展菜单里的操作系统点击打开 popup 后，`#capture-result` 仍为空。随后对「采集当前页可见文字」的操作系统点击为 `isTrusted`，`executeScript` 只打到活动标签，结果只含该页标题和可见正文。密码、敏感输入、Cookie 和未选标签页不在结果中。扩展存储没有这些值，没有回环 WebSocket，桌面 `markbridge.sqlite` 长度与 SHA256 未变。Cookie 名称已设置、HttpOnly Cookie 不在 `document.cookie`，这两项来自页面读数。 |
| V10 | PASS | 同一次 `cargo test --workspace --locked` 里的 HTTP fixture 覆盖 20 次切换不串内容、10 秒超时文案 `抓取超过 10 秒`、受禁目标和重定向失败、图片路径同样受限、离线缓存时间标签。React 测试不作为 V10 结论。 |

登录页的真实采集、Tauri 窗口和日常 Chrome 配置均为 NOT_RUN。

## 命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo test -p markbridge-core --lib preview -- --test-threads=8` | 0 | 8 passed。第一次编译因测试夹具的非 ASCII 字节串失败，退出码 1，修正后重跑。墙钟约 10.10 秒，含挂起 10 秒的用例。 |
| `cargo fmt --all` | 0 | 写回格式。 |
| `cargo fmt --all -- --check` | 0 | 通过。 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | 无问题。第一次退出码 1，已按告警改可见性和测试代码。 |
| `cargo test --workspace --locked` | 0 | 72 passed，7 suites，约 10.59 秒。 |
| `pnpm protocol:generate` | 0 | 写出 `content-preview` schema、类型和校验器。 |
| `pnpm protocol:check` | 0 | 与跟踪输出一致。 |
| `pnpm typecheck` | 0 | protocol、extension、desktop、tools 通过。 |
| `pnpm exec vitest run apps/desktop/src/features/preview/preview.test.tsx apps/desktop/src/features/library/library.test.tsx apps/extension/src/capture.test.ts apps/extension/src/bridge.test.ts` | 0 | 37 passed，0 failed。 |
| `pnpm lint` | 1 | 仅 `.omp/extensions/trellis/index.ts`：`no-useless-assignment` 3 条，`no-empty` 1 条。未改该文件。 |
| `node --test scripts/foundation.test.mjs` | 1 | 权限断言仍期望 `bookmarks`、`storage`、`alarms`。清单已增加 `scripting` 和 `activeTab`。本任务未改 `scripts/foundation.test.mjs`。另一条 capability 测试通过。 |
| `pnpm exec vitest run apps/extension/src/capture.test.ts` | 0 | 1 passed。注入函数在没有外部绑定的环境里仍跳过输入框。 |
| `node .trellis/tasks/archive/2026-10/10-10-mb-08-content-preview/evidence/chrome-capture-harness.mjs` | 0 | 运行 id `f0edec26-610a-4405-9100-222fd727e127`。Chrome/155.0.8059.39。五条观察 PASS。临时目录已删。日常 Bookmarks 长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`Markbridge.Pairing` 前后都是 0。检查后另行核对，长度、SHA256 和 Pairing 目标数仍是这三项。Chrome 安装文件长度与写入时间未变。 |

## 范围

公共抓取拒绝环回、私网、链路本地、组播和云元数据地址。Ollama 未接入。解析不执行页面脚本。摘要来自 description 或正文 excerpt。08 不写 Chrome 书签。`extractVisibleText` 的跳过标签集合写在函数内部。第一次真实点击得到失败文案，因为当时打包后的注入函数引用了外部 `Set`。收进函数后实施侧重跑过一次。检查侧再跑一次前，未点击路径必须观察到 `NO_PERMISSION`，Cookie 名称和 HttpOnly 隐藏必须来自页面读数。这次运行 id `f0edec26-610a-4405-9100-222fd727e127`，退出码 0。

## 检查

日期：2026-10-11。重读 `crates/core/src/preview/guard.rs`、`fetch.rs`、`service.rs`、`tests.rs` 和本收据。生产抓取逻辑未改。`blocks_forbidden_targets_before_a_connection` 补了组播 `224.0.0.1`、`239.255.255.255`、`ff02::1`，广播 `255.255.255.255`，未指定地址 `0.0.0.0` 与 `[::]`，IPv4 映射的链路本地和私网，链路本地 `[fe80::1]`，以及 `metadata.goog`。这些地址在补断言之前就会被 `check_url` 拒绝。未提交，未归档。

| 项 | 状态 | 依据 |
|---|---|---|
| AC08-1 | PASS | `http_fixture_shows_text_image_and_empty_image` 从 fixture 读出标题、description 摘要和 GIF；无元图时 `image` 为空。失败路径带中文 `failure_message`。桌面窗口 NOT_RUN。 |
| AC08-2 | PASS | `http_fixture_switches_twenty_times_without_mixing_and_keeps_offline_cache` 发出 20 个 HTTP 请求，取消前 19 个。被取消的结果没有标题、摘要和图片。最后一条标题是服务端页面 `No Image`。拒绝连接后同一 URL 为 `cached`，`cache_label` 以 `离线缓存 · ` 开头。 |
| AC08-3 | PASS | Fixture 拒绝 `javascript:`、`127.0.0.1`、同时解析出公网和环回的域名、指向 `127.0.0.1` 的重定向、gzip 膨胀，以及 `/hang` 的 10 秒超时。`/secret` 命中数为 0，拨号地址不是环回。来源图片 `http://127.0.0.1/secret.gif` 失败，正文仍在。`fetch.rs` 没有允许环回或私网的设置、环境变量或 feature。 |
| AC08-4 | PASS | 上表同一次临时 Profile 观察，运行 id `f0edec26-610a-4405-9100-222fd727e127`，退出码 0。没有启动日常 Profile，没有改已安装扩展，没有写 `Markbridge.Pairing`，没有改 HKLM。 |
| V10 | PASS | 上表 AC08-2、AC08-3 的断言来自同一次 `cargo test --workspace --locked` 里实际启动的 HTTP fixture，不是跳过的用例，也不是只对照源码。墙钟 10.60 秒，含挂起 10 秒的用例。React 测试不作为 V10 结论。 |

`apps/desktop` 没有 `activeTab`、`scripting` 或 `chrome.permissions`。`open_http` 只把 http(s) 交给系统 URL 处理程序。扩展在 popup 的「采集当前页可见文字」点击之后调用 `captureActivePage`。manifest 声明 `scripting` 和 `activeTab`，没有 host permission。Ollama 不经过 `crates/core/src/preview`。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo fmt --all -- --check` | 0 | 补断言前一次，补断言后又一次。 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | 两次都无问题。 |
| `cargo test --workspace --locked` | 0 | 补断言后 72 passed，7 suites，10.60 秒。补断言前一次同样是退出码 0、72 passed、10.57 秒。 |

未改协议和桌面，未跑 `pnpm protocol:check`、`pnpm typecheck` 和 vitest。
