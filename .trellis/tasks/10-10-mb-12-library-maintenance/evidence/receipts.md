# 12 库维护证据

日期：2026-10-11
平台：Windows
代码版本：`0251e80`，任务 12 的实现仍未提交。
Fixture：临时库和本机 HTTP fixture。403、429、404、410、登录页和超时都打到 fixture。公共地址检查仍拒绝 loopback、私网、链路本地、组播和云元数据地址。没有向日常书签批量发请求。

## 命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo test --locked -p markbridge-core --lib duplicate_groups_do_not_merge_query_fragment_or_metadata` | 0 | 1 passed |
| `cargo test --locked -p markbridge-core --lib link_probe_keeps_unknown_and_rechecks_gone` | 0 | 1 passed，1.24s |
| `cargo test --locked -p markbridge-core --lib link_timeout_is_unknown` | 0 | 1 passed，10.08s |
| `cargo test --locked -p markbridge-core --lib link_check_cancel_does_not_block_tree_or_edit` | 0 | 1 passed |
| `cargo test --locked -p markbridge-core --lib cleanup_preview_confirm_receipt_and_undo` | 0 | 1 passed |
| `cargo test --locked -p markbridge-core --lib text_search_is_profile_scoped` | 0 | 1 passed |
| `cargo test --workspace --locked` | 0 | 112 passed，2 ignored，12.34s |
| `pnpm protocol:generate` | 0 | 已生成 schema 和 TypeScript |
| `pnpm protocol:check` | 0 | 生成结果与磁盘输出一致 |
| `pnpm typecheck` | 0 | protocol、desktop、extension 和 tools 通过 |
| `pnpm test` | 1 | Vitest 99 passed，含 `maintenance.test.tsx` 2 passed。失败点是未跟踪的 `scripts/foundation.test.mjs`：扩展权限实际含 `scripting` 和 `activeTab`，断言只列了 `bookmarks`、`storage`、`alarms`。该文件不在本任务修改范围内。 |
| `pnpm --filter @markbridge/desktop tauri dev` | 未运行 | NOT_RUN |
| `pnpm build:native` | 未运行 | NOT_RUN |

上述 Rust 测试调用 `Bridge::inspect_library`、`check_links`、`cancel_link_check`、`preview_cleanup`、`confirm_cleanup`、`search_text` 和 `apply_edit`。

## 验收

| 行 | 结果 | 依据 |
|---|---|---|
| AC12-1 | PASS | 重复分组测试退出码 0。scheme、host 和默认端口相同的地址归为一组。query、fragment、路径大小写和尾部斜线不自动合并。检查后标签和备注保持原值。 |
| AC12-2 | PASS | 探针测试退出码 0。403、429 和登录页为 unknown。404 与 410 第一次为 pending，间隔至少 1000 ms 的再次检查后为 candidate。超时测试退出码 0，耗时 10.08s，结果为 unknown。取消测试退出码 0，8 个慢地址只启动 4 个请求。 |
| AC12-3 | PASS | 清理测试退出码 0。确认前展示保留项、移除项、标签并集和备注冲突，且没有浏览器写入。确认后有删除回执。撤销后原操作状态为 rolled_back，只撤回本次新增的标签，保留项备注不变。 |
| AC12-4 | PASS | 检索测试退出码 0。中文摘要和英文备注可检索。1 到 2 个字符走子串查询，3 个及以上字符走 FTS。另一 Profile 的相同文本不出现。重建索引后摘要和备注仍在。 |
| AC12-5 | PASS | 取消测试在检查进行时，`tree` 和 `preview_edit` 都在 500 ms 内返回。确认清理的浏览器删除进入既有 `ApplyOperation` 队列。 |
| V14 | PASS | 同一组测试覆盖 404/410、403/429、超时，以及 query 或 fragment 不同的地址。unknown 不是 candidate。不同资源没有并成一组。清理有预览和确认，撤销有回执。 |

失败原因：AC12-1 到 AC12-5 和 V14 无失败。`pnpm test` 的失败不改变上表，因为失败断言不调用库维护入口。
重测：无。
原生截图：NOT_RUN。

## 2026-10-11 trellis-check

独立重跑。未删除上面的实现者记录。未改产品代码。原生 `tauri dev` 与 `pnpm build:native` 仍是 NOT_RUN。

命令（过滤器在 `--` 之后）：

`cargo test -p markbridge-core --lib --locked -- duplicate_groups_do_not_merge link_probe_keeps_unknown link_timeout_is_unknown link_check_cancel cleanup_preview_confirm text_search_is_profile --test-threads=1`

退出码：0。结果：6 passed，84 filtered out，1 suite，11.71s。Cargo 接受该过滤器位置，没有第二条命令。六个过滤器各自只对应 `crates/core/src/bridge/tests.rs` 里的一个测试。

| 测试 | Bridge 入口 | 断言 |
|---|---|---|
| `duplicate_groups_do_not_merge_query_fragment_or_metadata` | `inspect_library` | query、fragment、路径大小写、尾部斜线不进入重复组。备注和标签留在原成员。 |
| `link_probe_keeps_unknown_and_rechecks_gone` | `check_links` | 403、429、登录页为 Unknown。404 与 410 第一次和立即复查为 Pending，间隔 1100 ms 的下一次为 Candidate。loopback、私网、链路本地、组播、云元数据、userinfo 为 Unknown，且没有 HTTP 状态。 |
| `link_timeout_is_unknown` | `check_links` | hang fixture 耗时至少 9 s，结果为 Unknown，不是 Candidate。 |
| `link_check_cancel_does_not_block_tree_or_edit` | `check_links`、`tree`、`preview_edit`、`cancel_link_check` | 检查进行时 `tree` 和 `preview_edit` 在 500 ms 内返回。已见请求停在 4。失败码为 Cancelled。 |
| `cleanup_preview_confirm_receipt_and_undo` | `preview_cleanup`、`confirm_cleanup`、`apply_edit` | 预览含保留项、移除项、标签并集和备注冲突，且没有 `ApplyOperation`。`confirm=false` 不写浏览器。确认后删除走 `ApplyOperation`。回执后为 Applied。撤销回执后为 RolledBack。保留项备注不变，只撤回本次新增标签。 |
| `text_search_is_profile_scoped` | `search_text` | `签`、`书签`、`re`、`reading`、`书签摘` 只命中当前 Profile。重建索引后摘要和备注仍可检索。 |

状态不是写死的返回值。`check_links` 经 `preview::probe_public` 写入观测。`classify_probe` 把 403、429、登录页和超时标为 unknown，把 404 与 410 标为 gone。`verdict_for` 只在两条 gone 观测间隔至少 1000 ms 时升为 Candidate。重复键来自 `normalize_url`，保留原始 query、fragment、路径大小写和尾部斜线。清理经 `edit::commit_planned`。`search_text` 在少于 3 个字符时用参数化 LIKE，3 个及以上用 FTS，并按 `profile_id` 过滤。

| 行 | 结果 | 依据 |
|---|---|---|
| AC12-1 | PASS | 重复分组测试退出码 0，调用 `inspect_library`，并断言 query 与 fragment 不合并。 |
| AC12-2 | PASS | 探针、超时、取消三个测试退出码 0。403、429、登录页和超时保持 Unknown。404 与 410 在有间隔的复查后才成为 Candidate。取消后不再请求其余地址。 |
| AC12-3 | PASS | 清理测试退出码 0。预览在确认之前，确认后才有删除回执，撤销后为 RolledBack。 |
| AC12-4 | PASS | 检索测试退出码 0。1 到 2 个字符和更长查询都调用 `search_text`，另一 Profile 不出现。 |
| AC12-5 | PASS | 取消测试在检查进行时，`tree` 和 `preview_edit` 在 500 ms 内返回。确认清理的删除进入既有 `commit_planned` 队列。 |
| V14 | PASS | 同一组测试覆盖两次有间隔的 404/410 确认、403/429/超时保持 Unknown、query 或 fragment 不合并、清理前预览和确认，以及撤销。 |
