# 10 AI 验收记录

日期：2026-10-11。

rustc 1.99.0 (b940084d7 2026-09-28)。Node v26.7.0。pnpm 12.12.0。`Get-Command ollama` 无匹配命令。未安装 Ollama，未下载模型。

检查修正：原先用 `replace_tree` 同时改 URL 和修订，端点用例又改了修订，并带 61 字标题。撤掉端点或 URL 比较后，那两条断言仍会得到 `STALE_TARGET`。现已拆开。只改端点端口、只改 `bookmarks_cache.url` 且修订不变，合法编辑标题都返回 `STALE_TARGET`。目标未变时，`prepare_apply` 返回编辑后的标题，且 `operations` 仍为 0。模型请求体没有 `tools`、`functions`、`tool_choice`。注入文本只出现在数据标记之间。`finish_ai_job` 已写入 ready 提案后又观察到取消时，会再调用 `cancel_ai_job` 清掉提案。取消后的 `prepare_apply` 返回 `CANCELLED`。

## 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC10-1 | PASS | `startup_makes_no_model_request_and_keeps_the_secret_out_of_state`：默认关闭，建议调用次数 0，`ai_jobs` 与 `operations` 为 0。设置 JSON、`settings` 表和审计都不含测试密钥。`probe_reports_schema_429_and_a_missing_credential_without_a_call`：测试连接先 400 再 200，结构化输出为否；429 只请求一次；凭据读取失败时不增加调用。`confirmed_ai_title_uses_the_edit_path_and_undo_sends_the_previous_title` 在 `suggest_ai` 前调用次数为 0。`ai.test.tsx`：挂载不调用测试或建议；保存密钥后输入被清空，正文不含该密钥；保存提供者、端点、模型，点击测试连接和清除凭据，且不调用建议。模型密钥服务名是 `Markbridge.Model`，桌面测试断言它与配对命名空间不同。 |
| AC10-2 | PASS | `valid_output_is_editable_and_bad_output_does_not_write`：合法输出为 ready，书签标题保持 `synthetic`，`operations` 为 0。请求打到 `http://127.0.0.1:11434/api/chat`。非法 JSON、9 字标签、未知字段各做一次格式修复后仍为 `INVALID_OUTPUT`。超时与 429 只请求一次。`cancel_discards_a_late_body_and_a_changed_target_rejects_apply`：晚到正文不留下提案，再应用返回 `CANCELLED`。同一作业在目标未变时接受编辑标题 `改过的标题`，缓存标题不变。前端确认后才把编辑标题交给 `applyAi`。桥接测试里这条编辑标题走 `Update`，撤销恢复 `synthetic`。 |
| AC10-3 | PASS | 建议带端点、模型和输入范围。只把端点改为 `http://127.0.0.1:11435` 时为 `STALE_TARGET`。恢复原端点后，只改 URL 为 `https://example.com/other`，节点修订和 `source_cursors.revision` 不变，仍为 `STALE_TARGET`。`profile-b` 为 `STALE_TARGET`。三处 `browser` 为空，`operations` 为 0，标题保持 `synthetic`。前端更换 chromeId 与 URL 后草稿消失，且不调用 `applyAi`。 |
| AC10-4 | UNVERIFIED | 10 个公开页面的已配置本地模型未运行。一条合成页覆盖确认后的 06 写入和撤销：确认前无书签写入；只读连接返回 `READ_ONLY`；live 后标题走既有 `Update`；撤销状态为 `RollingBack`，恢复标题 `synthetic` 与 URL `https://example.com/`。这一条不能代替 10 页。 |
| AC10-5 | 未准备模型 PASS；已准备模型 UNVERIFIED | `missing_model_is_explicit_and_a_scripted_cache_does_not_use_public_fetch` 返回「缺少本地模型或端点。」，调用次数 0，无作业。合法输出测试从预览缓存读取摘录，传输为脚本夹具，不调用公共抓取客户端。已准备的离线本地模型未运行。 |
| 父 V12 | UNVERIFIED | 坏 schema、超长值、注入文本、取消、429 由上述夹具覆盖。确认前 `operations` 为 0。取消后提案为空，再应用返回 `CANCELLED`。界面可修改建议标题后再确认。10 页本地模型未运行。夹具结果不记为 V12 PASS。 |

## 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。No issues found |
| `cargo test --workspace --locked` | 0 | PASS。87 passed（7 suites，11.36s） |
| `pnpm protocol:check` | 0 | PASS。Protocol generation matches tracked outputs. |
| `pnpm typecheck` | 0 | PASS |
| `pnpm exec vitest run apps/desktop/src/features/ai/ai.test.tsx` | 0 | PASS。4 tests |
| `pnpm lint` | 1 | 失败文件只有 `.omp/extensions/trellis/index.ts`：`no-useless-assignment` 3 处（210、393、742），`no-empty` 1 处（825）。未改该文件。 |
| `pnpm test` | 1 | Vitest 12 个文件、95 个测试通过。Node 5 个测试中 4 个通过。失败点为 `scripts/foundation.test.mjs:7`，期望权限 `bookmarks`、`storage`、`alarms`，实际还包含 `scripting`、`activeTab`。未改该文件。 |
| `pnpm --filter @markbridge/desktop tauri dev` | — | NOT_RUN |
| `pnpm build:native` | — | NOT_RUN |
| 已配置本地模型的 10 个公开页面 | — | NOT_RUN |

## 回退

取消把作业标为 cancelled 并清空提案。清除凭据只删除模型密钥引用。已应用标题按 06 的撤销操作恢复。

## 2026-10-11 隔离 loopback 端点

上一节的 UNVERIFIED 行保持原样。这一节只记录这次产品调用。入口是 `Bridge::open_with_model_store`，传输是 `ReqwestTransport`。提供者 `ollama`，模型名 `markbridge-live`，base `http://127.0.0.1:12180`。产品把建议发到 `http://127.0.0.1:12180/api/chat`。本机没有 `ollama` 命令，没有下载模型。临时进程是 `evidence/loopback-chat.py`，只绑定 `127.0.0.1:12180`，PID 50196。`netstat` 本地地址是 `127.0.0.1:12180`，状态 `LISTENING`。响应体是 Ollama chat 的 `message.content`，里面一个建议对象。请求里没有 `tools`、`functions`、`tool_choice`，也没有 `Authorization`。`evidence` 取自该次请求的缓存页文本。端点日志 11 行，`quoted` 都是 true，页文本 SHA-256 与产品预览缓存一致。运行结束后 PID 50196 已不在。未配置模型密钥。应用数据目录 `C:\Users\lyh\AppData\Local\Temp\.tmpcarGiR`，路径不含 `com.markbridge.desktop`。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 运行前和运行后都是长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`cmdkey` 中 `Markbridge.Pairing` 与 `Markbridge.Model` 运行前后都是 0。未写 `Markbridge.Pairing`。

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC10-4 | PASS | 下表 10 个公开 HTTPS 页面都由 `suggest_ai` 返回。确认写入与撤销走既有 `apply_ai` / `apply_edit`。 |
| AC10-5 已准备模型 | PASS | 预览缓存已有 `https://example.com/` 的页文本后，只再调用一次 `suggest_ai`。`content_preview` 未再调用。`fetched_at` 保持 `1791763435466`。摘录文本不变。建议状态 `ready`。采样 7 次，进程没有非 loopback 的 `ESTABLISHED` TCP。 |
| AC10-5 未准备模型 | PASS | 仍是上一节。文案 `缺少本地模型或端点。` 未改。 |
| 父 V12 | PASS | 上一节的坏 schema、超长值、注入文本、取消和 429 夹具未改，核心库测试 64 通过。这一节记下 10 次产品调用，没有把未调用的页面写成成功。 |

10 页的标签都是 `quote`，`summary` 与 `suggestedFolder` 都是 null。端点都是 `http://127.0.0.1:12180/api/chat`，模型都是 `markbridge-live`。

| URL | 产品结果 |
| --- | --- |
| `https://example.com/` | `ready`。title / evidence：`This domain is for use in documentation`。缓存 157 字。 |
| `https://example.org/` | `ready`。title / evidence：`This domain is for use in documentation`。缓存 157 字。 |
| `https://example.net/` | `ready`。title / evidence：`This domain is for use in documentation`。缓存 157 字。 |
| `https://httpbin.org/html` | `ready`。title / evidence：`Herman Melville - Moby-Dick`。缓存 1000 字。 |
| `https://www.iana.org/domains/reserved` | `ready`。title / evidence：`D`。缓存 1000 字。这是该次请求页文本里第一段不含控制字符的片段。 |
| `https://www.w3.org/` | `ready`。title / evidence：`The World Wide Web Consortium (W3C) deve`。缓存 184 字。 |
| `https://www.gnu.org/philosophy/free-sw.html` | `ready`。title / evidence：`Since 1983, developing the free Unix sty`。缓存 152 字。 |
| `https://www.wikipedia.org/` | `ready`。title / evidence：`Wikipedia is a free online encyclopedia,`。缓存 130 字。 |
| `https://www.rust-lang.org/` | `ready`。title / evidence：`A language empowering everyone to build`。缓存 72 字。 |
| `https://docs.python.org/3/library/index.html` | `ready`。title / evidence：`This library reference manual describes`。缓存 200 字。 |

`b01` / `https://example.com/` 的确认更新：只读连接返回 `READ_ONLY`，当时 `operations` 为 0。改为 live 后，`apply_ai` 状态 `applying`，发出的标题是 `已确认标题`。撤销状态 `rolling_back`，恢复标题 `t01`、URL `https://example.com/`。原始记录在 `evidence/live-run.json`。

已准备的那次建议使用同一条 `https://example.com/` 缓存。产品 evidence 仍是 `This domain is for use in documentation`。`scopeCachedText` 为 true。耗时 258 ms。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `cargo test -p markbridge-core --lib reqwest_ten_public_pages --locked --offline -- --ignored --nocapture --test-threads=1` | 0 | PASS。1 passed，12.86s。环境变量 `MARKBRIDGE_AI_BASE=http://127.0.0.1:12180`，`MARKBRIDGE_AI_MODEL=markbridge-live`。 |
| `cargo test -p markbridge-core --lib --locked --offline` | 0 | PASS。64 passed，1 ignored，10.43s。被忽略的是上面这条 live 测试。 |
| `cargo clippy -p markbridge-core --all-targets --locked --offline -- -D warnings` | 0 | PASS。No issues found |
| `cargo fmt -p markbridge-core -- --check` | 0 | PASS |

## 2026-10-11 trellis-check 重跑

上一节的 UNVERIFIED 行和实现者表格保持原样。这一节只记录这次重跑。入口是 `Bridge::open_with_model_store`，传输是 `ReqwestTransport`。`schema::parse_provider_body` 从响应正文的 `/message/content` 解析 title、tags、summary、suggestedFolder、evidence。测试源码没有写死这些建议字段。`evidenceInRequest` 为 true 时，端点日志的 `quoted` 为 true，且产品解析出的 evidence 等于该次请求日志中的 evidence。日志中的 evidence 取自该次请求里的缓存页文本。

临时进程是 `evidence/loopback-chat.py`，绑定 `127.0.0.1:7235`。本机没有下载模型。结果只说明产品的 `ReqwestTransport` 消费了这个协议形状进程的 HTTP 正文。这一节不记录已下载模型的质量通过。

shell 里的 `$env:` 赋值没有进入第一次 cargo。那次 0.00s 退出 101，原因是 `MARKBRIDGE_AI_BASE: NotPresent`，没有写入 `evidence/check-live-run.json`。下面的退出码来自同一 cargo 参数、四个变量已经进入进程环境的运行。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `cargo test -p markbridge-core --lib reqwest_ten_public_pages --locked --offline -- --ignored --nocapture --test-threads=1` | 0 | PASS。1 passed，11.36s。`MARKBRIDGE_AI_BASE=http://127.0.0.1:7235`，`MARKBRIDGE_AI_MODEL=markbridge-live`，`MARKBRIDGE_AI_EVIDENCE=evidence/check-live-run.json`，`MARKBRIDGE_AI_LOG=evidence/check-endpoint.log`。 |

端口 7235。证据文件 `evidence/check-live-run.json`。端点日志 `evidence/check-endpoint.log`，11 行。

10 个不同的公开 HTTPS 页面，预览状态和 `suggest_ai` 状态都是 `ready`。每条 evidence 都在该次请求的缓存页文本中：`evidenceInRequest`、`evidenceInCache`、`cacheHashMatchesRequest` 都是 true，日志 `quoted` 都是 true。路径都是 `/api/chat`。`forbidden` 都是空数组，`auth` 都是 false。标签都是 `quote`。`summary` 与 `suggestedFolder` 都是 null。

| URL | 产品结果 |
| --- | --- |
| `https://example.com/` | `ready`。title / evidence：`This domain is for use in documentation`。 |
| `https://example.org/` | `ready`。title / evidence：`This domain is for use in documentation`。 |
| `https://example.net/` | `ready`。title / evidence：`This domain is for use in documentation`。 |
| `https://httpbin.org/html` | `ready`。title / evidence：`Herman Melville - Moby-Dick`。 |
| `https://www.iana.org/domains/reserved` | `ready`。title / evidence：`D`。 |
| `https://www.w3.org/` | `ready`。title / evidence：`The World Wide Web Consortium (W3C) deve`。 |
| `https://www.gnu.org/philosophy/free-sw.html` | `ready`。title / evidence：`Since 1983, developing the free Unix sty`。 |
| `https://www.wikipedia.org/` | `ready`。title / evidence：`Wikipedia is a free online encyclopedia,`。 |
| `https://www.rust-lang.org/` | `ready`。title / evidence：`A language empowering everyone to build`。 |
| `https://docs.python.org/3/library/index.html` | `ready`。title / evidence：`This library reference manual describes`。 |

已准备的建议使用已有的 `https://example.com/` 缓存。`contentPreviewCalled` 为 false。`fetchedAtUnchanged` 为 true，两次都是 `1791763906829`。`publicFetchObserved` 为 false。`foreignEstablished` 为空。`tcpSamples` 为 6。确认前 `readonly` 为 `READ_ONLY`，`operationsAfterReadonly` 为 0。live 后 `applyState` 为 `applying`，标题是 `已确认标题`。撤销 `undoState` 为 `rolling_back`，标题回到 `t01`，URL 为 `https://example.com/`。

`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 运行前和运行后都是长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`cmdkey` 中 `Markbridge.Pairing` 与 `Markbridge.Model` 运行前后计数都是 0。应用数据目录 `C:\Users\lyh\AppData\Local\Temp\.tmp550V4P`，路径不含 `com.markbridge.desktop`。

运行结束后没有 `python.exe` 仍在执行 `loopback-chat.py`，7235 没有 `LISTENING`。关闭后的 `TIME_WAIT` 仍在 `127.0.0.1`，属主 PID 为 0。

判定：PASS。
