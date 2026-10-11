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
