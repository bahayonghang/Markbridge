# 11 批量整理验收记录

日期：2026-10-11。

未启动 Chrome 或 Chromium。未读取、未写入 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`。未加载已安装扩展。未修改 `C:\Program Files\Google\Chrome`。未写 `HKCU\Software\Policies` 或 `HKLM`。未安装 Ollama，未执行 `ollama pull`。未创建 `Markbridge.Pairing` 凭据。未设置 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`、`MARKBRIDGE_APP_DATA`。

进程内夹具覆盖目录校验、分配覆盖、方案哈希、恢复区间和未确认清理。这些结果不能代替 B100 的真实回滚。

## 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC11-1 | UNVERIFIED | 未运行一次性 Chrome profile，也未做两遍模型生成、用户审查和部分拒绝。`propose_reads_two_folders_and_a_timeout_is_not_repaired` 只证明脚本夹具能解析两个未审查目录，且超时只请求一次。 |
| AC11-2 | UNVERIFIED | 实施记录曾标 PASS。检查改判见文末 `2026-10-11 trellis-check`。原主张：`a_changed_revision_does_not_return_folders`：生成后 `fresh` 为假，返回 `STALE_PROPOSAL`，目录为空。`assignment_stops_before_the_next_window_when_the_revision_changes`：51 条里保留已完成的 50 条，调用 2 次，正文不含 `c050`。`reject_changes_the_plan_hash_and_the_gate_blocks_a_stale_plan`：拒绝改变 plan hash；哈希或资料不新鲜为 `STALE_PROPOSAL`；非 ready 为 `CONFLICT`；非 live 为 `READ_ONLY`。桥接 `apply_organization` 在哈希或资料不一致时于 `edit_commit` 之前返回。未对真实 Chrome 树做外部修改。 |
| AC11-3 | UNVERIFIED | `recovery_lists_applied_pending_and_uncertain_without_a_replay`：45 步中 0..39 为 applied，39..40 为 uncertain（`req-39` 已登记发送且无回执），40..45 为 pending，`next_unsent` 为 `None`，operation 为 uncertain 时 phase 为 `partial`。没有断开扩展，也没有退出进程后再启动。 |
| AC11-4 | UNVERIFIED | `undo_of_create_then_move_restores_the_folder_index_before_delete` 在内存树里先移回再删除，标题变化不写回，外部父节点变化不生成移回。这不是 B100 回滚。未核对真实兄弟顺序、标签或摘要。 |
| AC11-5 | UNVERIFIED | 实施记录曾标 PASS。检查改判见文末 `2026-10-11 trellis-check`。原主张：`unconfirmed_cleanup_does_not_plan_a_delete`：`confirm` 为假返回 `CANCELLED`；书签 id 返回 `INVALID_MESSAGE`；非空目录步骤为空；确认后的空目录只有一条 `Delete`。`cleanup_organization` 在 `confirm` 为假时写入 `未确认删除。没有删除书签或空文件夹。`，不调用 `plan_empty_cleanup`。未对 Chrome 执行删除。 |
| 父 V08 | UNVERIFIED | 进程内撤销夹具不能代替 ack 丢失、apply 后 crash 和真实 rollback。未运行。 |
| 父 V13 | UNVERIFIED | 未对 B100 做两遍分类、部分拒绝、第 40 步断连或条件回滚。 |

## 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `cargo test -p markbridge-core --lib -- organization:: reclassify_creates unconfirmed_cleanup undo_of_create` | 0 | PASS。15 passed，65 filtered out |
| `cargo test -p markbridge-core --lib` | 0 | PASS。79 passed，1 ignored。最后一次在 `BatchCommit` 重构之后 |
| `cargo test -p markbridge-desktop -- every_registered_command_checks_the_caller_window` | 0 | PASS。1 passed，11 filtered out |
| `cargo fmt --all` | 0 | 已格式化。未再跑 `--check` |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。No issues found。前一次退出码 1，已修未使用导入、未使用的 `latest_organization_job` 和 `edit_commit` 参数个数 |
| `pnpm protocol:generate` | 0 | PASS。生成 `organization-plan` schema、类型和 validator |
| `pnpm typecheck` | 0 | PASS |
| `rtk proxy pnpm lint` | 0 | PASS。项目 eslint：`eslint apps packages scripts tests eslint.config.js playwright.config.ts vitest.config.ts --max-warnings 0`。直接的 `pnpm lint` 被改写成 `rtk lint`，退出码 1，报错文件是 `.omp/extensions/trellis/index.ts`，未改该文件 |
| `pnpm test` | 1 | Vitest 13 个文件、97 个测试通过，含 `organization.test.tsx` 与 `executor.test.ts`。协议漂移测试通过。失败点是未跟踪的 `scripts/foundation.test.mjs:7`：期望权限 `bookmarks`、`storage`、`alarms`，`apps/extension/public/manifest.json` 另有 `scripting`、`activeTab`。未改该测试，也未改 manifest |
| `cargo test --workspace --locked` | — | NOT_RUN |
| `pnpm protocol:check` | — | NOT_RUN。`pnpm test` 里的 drift gate 已通过 |
| `pnpm test:e2e` | — | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` | — | NOT_RUN |
| `pnpm build:native` | — | NOT_RUN |
| 一次性 Chrome user-data-dir 下的 B100 | — | NOT_RUN |

## 回退

暂停或取消只停止后续步骤。已登记但没有回执的步骤保持 uncertain，不自动重放。断开连接并把 operation 冻成 uncertain 时清除 `batch_hold`。未确认清理不生成删除。有冲突的撤销保留外部父节点，不生成移回。

## 2026-10-11 trellis-check

未启动一次性 Chrome 或 Chromium user-data-dir。未做 B100 应用、第 40 步断连或条件回滚。未读取、未写入 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`。未加载已安装扩展。未修改 `C:\Program Files\Google\Chrome`。未写 `HKCU\Software\Policies` 或 `HKLM`。未安装 Ollama。未创建 `Markbridge.Pairing` 凭据。未设置 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`。未改产品代码。未提交。

仓库里没有对 `Bridge::apply_organization`、`Bridge::cleanup_organization` 或恢复入口的测试。进程内夹具不能代替 disposable profile。

### 验收

| 项 | 状态 | 判断 |
| --- | --- | --- |
| AC11-1 | UNVERIFIED | `propose_reads_two_folders_and_a_timeout_is_not_repaired` 调用 `propose_folders` 和脚本传输，断言两个未审查目录、一次超时请求。没有用户审查、部分拒绝，也没有真实 Chrome 树。本轮没有 disposable profile。 |
| AC11-2 | UNVERIFIED | 实施记录的 PASS 不成立。`a_changed_revision_does_not_return_folders` 调用 `propose_folders`，`fresh` 闭包固定为 `false`，断言 `STALE_PROPOSAL` 且 `rows` 为空。`assignment_stops_before_the_next_window_when_the_revision_changes` 调用 `classify_scope`，用计数器让第二次 `fresh` 失败，断言保留 50 条、调用 2 次、正文不含 `c050`。这两处是桌面命令使用的组织服务，但没有经过 `Bridge`，也没有改到真实 revision。`reject_changes_the_plan_hash_and_the_gate_blocks_a_stale_plan` 调用 `edit_assignment` 和 `apply_gate`，四个门闩结果都是字面布尔值。`Bridge::apply_organization` 在自有哈希和 `same_basis` 检查之后才调用 `apply_gate(&phase, true, true, true)`。没有测试调用 `Bridge::apply_organization` 或 `edit_commit`，不能证明应用前的外部变化会停在 mutation engine 之外。 |
| AC11-3 | UNVERIFIED | `recovery_lists_applied_pending_and_uncertain_without_a_replay` 手写 45 个 `StepFact`，调用 `to_plan_with_job` 和 `next_unsent`。`req-39` 已登记且无回执时 `next_unsent` 为 `None`。没有调用 `Bridge` 恢复，没有断开扩展，没有进程退出后再启动。本轮没有第 40 步断连。 |
| AC11-4 | UNVERIFIED | `undo_of_create_then_move_restores_the_folder_index_before_delete` 对内存节点调用 `editing::plan`。无冲突时先移回再删除，标题变化不生成 `Update`，外部父节点变化不生成移回。这不是 `Bridge` 回滚，也不是 B100。未核对真实兄弟顺序、标签或摘要。 |
| AC11-5 | UNVERIFIED | 实施记录的 PASS 不成立。`unconfirmed_cleanup_does_not_plan_a_delete` 直接调用 `plan_empty_cleanup`：`confirm` 为假时 `CANCELLED`，书签 id 为 `INVALID_MESSAGE`，非空目录步骤为空，确认后的空目录只有一条 `Delete`。该测试使用了删除规划函数，但没有调用桌面命令入口 `Bridge::cleanup_organization`。源码里 `confirm` 为假时在 `plan_empty_cleanup` 和 `edit_commit` 之前返回，并写入 `未确认删除。没有删除书签或空文件夹。`。这条源码观察没有测试。 |
| 父 V08 | UNVERIFIED | 没有 ack 丢失、apply 后 crash、删除恢复或真实 rollback。内存撤销夹具不能代替。本轮未运行。 |
| 父 V13 | UNVERIFIED | 没有 disposable Chrome user-data-dir 上的 B100 两遍分类、部分拒绝、第 40 步断连或条件回滚。模拟树不能代替。本轮未建浏览器夹具，也未运行该场景。 |

### 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `cargo test -p markbridge-core --lib --locked -- organization:: reclassify_creates unconfirmed_cleanup undo_of_create` | 0 | 15 passed，65 filtered out |
| `cargo clippy -p markbridge-core --all-targets --locked -- -D warnings` | 0 | No issues found |

### 设计限额

源码核对，不是上述行的 PASS。

- 目录提议采样 `SAMPLE_LIMIT` 为 200。`sample_rows` 只取前 200 条。
- 分配窗口 `BATCH_SIZE` 为 25。`classify_scope` 每次最多把两个窗口交给 `run_pair`。
- `parse_batch` 要求引用的输入 id、目录 id 与所选行和已审查目录一致，并拒绝缺项、重复和未知 id。`accept_folders`、`parse_folders`、`order_folders` 拒绝目录环。
- `plan_hash` 覆盖资料、目录和未拒绝分配。`apply_organization` 在 `edit_commit` 前比较调用方哈希，并用 `same_basis` 比较 `source_revision` 与范围指纹。
- `commit_planned` 在 `sender.send` 之前写 Netscape HTML 和侧车备份。备份失败则不发送。
- `plan_reclassify` 先创建目录再移动，计划中没有 `Delete`。`apply_organization` 的 `send_limit` 为 1。`on_receipt` 只在前一步已有 `applied` 回执时发送下一步。
- `next_unsent` 在已登记且没有回执时返回 `None`。暂停或取消把 phase 改离 `applying` 后，`on_receipt` 不再发送。断开时 `freeze_profile` 把 operation 标为 uncertain，并在冻结成功后清除 `batch_hold`。
- `plan_reclassify` 不删除。`cleanup_organization` 在 `confirm` 为假时返回。`plan_empty_cleanup` 在 `confirm` 为假时返回 `CANCELLED`。界面先点「清理空文件夹」，再点「确认删除空文件夹」。

## 2026-10-11 Bridge 证据与一次性 Chrome

上文 `2026-10-11 trellis-check` 的行保持原样。本节是随后补上的调用证据和一次性 Chrome 运行结果。

日常书签文件 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` 在浏览器运行前、失败运行之后和通过运行之后长度都是 849515，SHA256 都是 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。测试进程内也做了同样的前后断言。未使用日常 Profile。未加载已安装扩展。Chrome 155.0.8059.39 使用新的临时 `--user-data-dir`，扩展由 CDP `Extensions.loadUnpacked` 加载 `apps/extension/dist`。未写 `HKCU\Software\Policies` 或 `HKLM`。未修改 `C:\Program Files\Google\Chrome`。未安装 Ollama。未创建 `Markbridge.Pairing` 凭据。模型应答来自 `127.0.0.1` 上的测试桩。凭据只在进程内 `MemoryCredentials`。

`Bridge::apply_organization` 在缓存 revision 和标题被事件改写后返回 `Invalid` / `STALE_PROPOSAL`，出站为空，没有 operation。测试没有把字面布尔值送进 `apply_gate`。`Bridge::cleanup_organization(confirm=false)` 返回 `Cancelled`，不规划、不发送删除，书签 id 和非空目录仍在。恢复走 `Bridge::shutdown` 后的 `Bridge::open`（`freeze_inflight`）再读 `organization_plan`：已发送且无回执的步骤保持 uncertain，重连后的出站没有 `ApplyOperation`。

一次性 Chrome 运行写入 `evidence/b100-run.json`，状态 PASS。浏览器为 `Chrome/155.0.8059.39`，本 profile 的 Chrome 进程 11 个。两遍生成后审查目录，拒绝 5 条，应用 96 步（1 次创建 + 95 次移动）。第 40 步（ordinal 39）已发送且回执为空时挂起并结束该 Chrome 进程。重启后的计划为 `partial`：applied `0..39`，uncertain `39..40`，pending `40..96`。ordinal 0–38 的回执为 `applied`，39 和 40 的回执为空，后续未重放。无冲突回滚恢复了书签栏 102 个兄弟的顺序，侧车 note 与 summary 仍在。外部标题 `RollA external` 保留，operation 为 `RollbackConflict`。脱敏树只保留类型、位置、标题和主机名，见 json 的 `rollback.tree` 与 `recovered.receipts`。

同一次运行暴露出后续移动仍携带计划时的兄弟 index，扩展报冲突，operation 变为 `Partial`。`substitute` 只按已 applied 的前序步骤修正 index。标题和父节点保持计划时的值。

### 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC11-1 | PASS | `b100-run.json`：审查后的计划、拒绝 5 条、96 步里已应用 39 步。未选项不在这 95 次移动中。 |
| AC11-2 | PASS | `apply_organization_returns_before_edit_when_the_cached_revision_changes` 调用 `Bridge::apply_organization`。缓存 revision 变化后于 `edit_commit` 前返回。 |
| AC11-3 | PASS | 库测试 `restart_leaves_a_dispatched_step_uncertain_and_does_not_replay` 经 `Bridge::open` 恢复且不重放。Chrome 第 40 步断连后的区间见 json `recovered`。 |
| AC11-4 | PASS | json `rollback.restored`、`noteKept`、`summaryKept` 与 `externalEditKept`。兄弟顺序在 `rollback.tree`。 |
| AC11-5 | PASS | `cleanup_organization_without_confirm_does_not_delete` 调用 `Bridge::cleanup_organization(confirm=false)`，无删除计划，无出站删除。 |
| 父 V08 | PASS | 第 40 步无回执并在重启后保持 uncertain，未重放。无冲突回滚恢复语义树、顺序和侧车。有冲突时保留外部标题。 |
| 父 V13 | PASS | 同一一次性 profile 完成两遍分类、部分拒绝、第 40 步断连、重启区间和条件回滚。无额外删除。 |

### 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `Get-FileHash` 日常 `Bookmarks`（Chrome 运行前） | 0 | 849515，`DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture` | 1 | 小计划 20 秒未到 `Applied`。当时后续移动的 `expected_before.position` 仍是计划时的 index |
| `Get-FileHash` 日常 `Bookmarks`（上述失败后） | 0 | 与运行前相同 |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture` | 1 | 小计划停在 `Partial`，连接为 `Live`，扩展状态为 `connected` |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture` | 1 | 0.77 秒。选项页目标上 `chrome.bookmarks` 尚未出现。随后只等待 `options.html` 并重试创建 |
| `cargo fmt -p markbridge-core` 后 `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture` | 0 | 1 passed，83 filtered out，测试体 3.09 秒。`b100-run.json` 状态 PASS |
| `Get-FileHash` 日常 `Bookmarks`（通过之后） | 0 | 与运行前相同 |
| `cargo test -p markbridge-core --lib --locked` | 0 | 82 passed，2 ignored，10.54 秒。忽略项含 `disposable_chrome_b100_apply_interrupt_and_rollback` 与既有 Reqwest 测试。三则 Bridge 库测试在通过的 82 则里 |

## 2026-10-11 trellis-check B100

上文两节保持原样。本节只记录本轮重跑。未改产品代码。未提交。未安装 Ollama。未创建凭据。未设置 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`。未写 `HKCU\Software\Policies` 或 `HKLM`。未修改 `C:\Program Files\Google\Chrome`。未加载已安装扩展。日常 `Bookmarks` 只做哈希，未写入。

写给测试进程的命令在 `--` 前放了三个过滤器，Cargo 直接拒绝，退出码 1，没有执行测试。三个测试改由测试进程接收同名过滤器后执行，退出码 0。一次性 Chrome 测试退出码 0，套件 3.77 秒。这个时间停在第 40 步已发出、回执未到，不是 96 步全部完成。

采样到 7 个 `chrome.exe`。命令行含 `--remote-debugging-port=9265` 和 `--user-data-dir=C:\Users\lyh\AppData\Local\Temp\.tmpwNaGfM`。测试结束后该目录下的进程为 0。`b100-run.json` 于 21:52:52 重写，`browser` 为 `Chrome/155.0.8059.39`，`chromePids` 为 11，`status` 为 PASS。扩展包 `worker.js` 在 `await e.move` / `create` 返回后才写 `applied`，入口是 `(chrome).start()`。39 条 `applied` 回执来自这次浏览器里的 `chrome.bookmarks`，不是手写 JSON。

重跑后的 json：拒绝后的计划为 1 次 `create` 加 95 次 `move`，没有 `delete`。100 条批量书签减去测试断言的 5 条拒绝，对应这 95 次移动。`interrupted` 与 `recovered` 都是 applied `0..39`、uncertain `39..40`、pending `40..96`。ordinal 0–38 为 `applied`，39 和 40 以及 41–95 的回执为空，没有重放。`rollback.restored`、`noteKept`、`summaryKept` 为真，书签栏 102 个兄弟，顺序是 `RollA`、`RollB`、`Item 000` 到 `Item 099`。`externalEditKept` 为真。json 里的树是恢复后的原顺序，外部标题 `RollA external` 由测试断言缓存，不在这棵树里。夹具是书签栏上的平面英文书签，没有父级 B100 定义里的嵌套目录、重复 URL、保护节点或特殊分隔符。

日常 `Bookmarks` 重跑前和重跑后长度都是 849515，SHA256 都是 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。json 内的 `dailyBefore` 与 `dailyAfter` 相同。

### 验收

| 项 | 状态 | 判断 |
| --- | --- | --- |
| AC11-1 | PASS | 一次性 Chrome 上两遍桩模型、目录审查、5 条拒绝。95 次移动对应未拒绝项。拒绝项不在这 96 步里。 |
| AC11-2 | PASS | `apply_organization_returns_before_edit_when_the_cached_revision_changes` 调用 `Bridge::apply_organization`。缓存 revision 和标题变化后为 `Invalid` / `STALE_PROPOSAL`，出站为空，没有 operation。 |
| AC11-3 | PASS | `restart_leaves_a_dispatched_step_uncertain_and_does_not_replay` 经 `Bridge::shutdown` 后 `Bridge::open`，重连出站没有 `ApplyOperation`。Chrome 第 40 步 uncertain，40 之后没有回执。 |
| AC11-4 | PASS | 无冲突撤销后缓存回到原兄弟顺序，note 与 summary 仍在。外部标题保持 `RollA external`，operation 为 `RollbackConflict`。 |
| AC11-5 | PASS | `cleanup_organization_without_confirm_does_not_delete` 调用 `Bridge::cleanup_organization(confirm=false)`。`Cancelled`，树不变，无出站。B100 的 96 步没有 `delete`。 |
| 父 V08 | PASS | 已发送且无回执的步骤在 `Bridge::open` 后仍为 uncertain，未重放。无冲突回滚恢复顺序和侧车。有冲突时不覆盖外部标题。本轮没有单独的并发回滚。 |
| 父 V13 | PASS | 同一次临时 profile 完成两遍分类、部分拒绝、第 40 步断连、重启区间和条件回滚。无额外删除。样本不是父级 B100 的完整合成树。 |

### 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `Get-FileHash` 日常 `Bookmarks`（重跑前） | 0 | 849515，`DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `cargo test -p markbridge-core --lib --locked apply_organization_returns_before_edit cleanup_organization_without_confirm restart_leaves_a_dispatched_step -- --test-threads=1` | 1 | Cargo：`unexpected argument 'cleanup_organization_without_confirm'`。测试未启动 |
| `cargo test -p markbridge-core --lib --locked -- apply_organization_returns_before_edit cleanup_organization_without_confirm restart_leaves_a_dispatched_step --test-threads=1` | 0 | 3 passed，81 filtered out，0.22 秒 |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture --test-threads=1` | 0 | 1 passed，83 filtered out，3.77 秒。`b100-run.json` 重写为 PASS |
| `Get-FileHash` 日常 `Bookmarks`（重跑后） | 0 | 与重跑前相同 |

## 2026-10-11 B100 合成树

上文各节保持原样。本节只记录合成树重跑。未提交。未安装 Ollama。未创建凭据。未设置 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`。未写 `HKCU\Software\Policies` 或 `HKLM`。未修改 `C:\Program Files\Google\Chrome`。未加载已安装扩展。日常 `Bookmarks` 只做哈希，未写入。

一次性 Chrome 仍使用临时 `--user-data-dir`，扩展由 CDP `Extensions.loadUnpacked` 加载 `apps/extension/dist`。`b100-run.json` 状态 PASS。浏览器为 `Chrome/155.0.8059.39`，`chromePids` 为 11。脱敏树只保留类型、位置、标题、主机名和 `urlKey`，没有 `://`，也没有用户信息。

`shape.bookmarkCount` 为 100。`nestedFolders` 为 1，目录名 `分类`，位于书签栏下。其兄弟顺序是 `RollA`、`RollB`、`留在原位`、`中文 | 分隔`。`Item 000` 与 `条目 001` 的 `urlKey` 都是 `4b4017334be345a1`，主机名都是 `example.test`，`duplicateUrl` 为真。`chineseTitle` 与 `englishTitle` 为真。`separator` 为 `|`。保护节点是根、`bookmarks-bar` 和 `other`，`moved` 与 `deleted` 都为假。这次快照没有 `mobile` 节点。四条未选项的 `stayed` 为真，位置仍是 0 到 3。`deletes` 为 0。

100 条里 4 条在 `分类` 中，不进入大批量计划。大批量选择其余 96 条，拒绝 5 条，所以回执是 1 次 `create` 加 91 次 `move`，没有 `delete`。`interrupted` 与 `recovered` 都是 applied `0..39`、uncertain `39..40`、pending `40..92`。ordinal 0–38 为 `applied`，39 和 40 以及其后回执为空，没有重放。无冲突回滚后的 `rollback.siblings` 是上面的四条顺序，`noteKept` 与 `summaryKept` 为真。外部标题仍由缓存断言保持 `RollA external`，`externalEditKept` 为真；`rollback.tree` 是改名之前的恢复树。

日常 `Bookmarks` 重跑前和重跑后长度都是 849515，SHA256 都是 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。json 内的 `dailyBefore` 与 `dailyAfter` 相同。

### 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC11-1 | PASS | json `shape`：100 条书签、嵌套目录、重复 `urlKey`、中文和英文标题、分隔符 `|`。拒绝 5 条。未选项 `stayed` 为真。 |
| AC11-2 | PASS | `apply_organization_returns_before_edit_when_the_cached_revision_changes` 退出码 0。缓存 revision 变化后 `apply_organization` 返回，不编辑。 |
| AC11-3 | PASS | `restart_leaves_a_dispatched_step_uncertain_and_does_not_replay` 退出码 0。Chrome 区间见 json `recovered`：applied `0..39`，uncertain `39..40`，pending `40..92`。 |
| AC11-4 | PASS | json `rollback.siblings` 恢复 `分类` 内兄弟顺序。`noteKept`、`summaryKept`、`externalEditKept` 为真。 |
| AC11-5 | PASS | `cleanup_organization_without_confirm_does_not_delete` 退出码 0。B100 回执 `deletes` 为 0，没有 `delete`。 |
| 父 V08 | PASS | 第 40 步无回执，重启后仍为 uncertain，未重放。无冲突回滚恢复嵌套目录里的兄弟顺序和侧车。有冲突时保留外部标题。 |
| 父 V13 | PASS | 同一次临时 profile 的 json 显示 100 条书签、嵌套目录、重复 URL、中文和英文标题、分隔符 `|`，以及未移动且未删除的 `bookmarks-bar`。部分拒绝、第 40 步断连、重启区间和条件回滚都在这次运行里。无额外删除。 |

### 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `Get-FileHash` 日常 `Bookmarks`（合成树重跑前） | 0 | 849515，`DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture --test-threads=1` | 0 | 1 passed，83 filtered out，3.81 秒。`b100-run.json` 为 PASS，`shape` 含上述六项 |
| `cargo test -p markbridge-core --lib --locked -- apply_organization_returns_before_edit cleanup_organization_without_confirm restart_leaves_a_dispatched_step --test-threads=1` | 0 | 3 passed，81 filtered out，0.20 秒 |
| `Get-FileHash` 日常 `Bookmarks`（合成树重跑后） | 0 | 与重跑前相同 |

## 2026-10-11 trellis-check B100 合成树

上文各节保持原样。本节只记录检查代理对合成树的重跑。未提交。未归档。未安装 Ollama。未创建凭据。未设置 `HOME`、`CARGO_HOME`、`RUSTUP_HOME`。未写 `HKCU\Software\Policies` 或 `HKLM`。未修改 `C:\Program Files\Google\Chrome`。未加载已安装扩展。未改产品代码。日常 `Bookmarks` 只做哈希，未写入。

`disposable_chrome_b100` 退出码 0：1 passed，83 filtered out，3.39 秒。`b100-run.json` 由这次运行重写，`status` 为 PASS，`chromePids` 为 12，浏览器为 `Chrome/155.0.8059.39`。三则 Bridge 过滤在同一次 `cargo test` 里退出码 0：3 passed，81 filtered out，0.19 秒。

`shape.bookmarkCount` 为 100。`nestedFolders` 为 1，目录名 `分类`。`duplicateKeys` 只有 `4b4017334be345a1`。`chineseTitle` 与 `englishTitle` 为真。标题 `中文 | 分隔` 在 `nestedChildTitles`、`unselected` 和 `rollback.siblings` 里都是一整条标题。json 没有 `tags` 字段，这条标题没有被拆成标签。对应未选项 `stayed` 为真，位置 3。保护节点有根、`bookmarks-bar` 和 `other`，三者 `moved` 与 `deleted` 都为假。

`interrupted` 与 `recovered` 都是 applied `0..39`、uncertain `39..40`、pending `40..92`。`recovered.phase` 为 `partial`。92 条回执的 ordinal 不重复。ordinal 0–38 为 `applied`，39 到 91 的 `state` 为空。没有重放。`kind` 为 1 次 `create` 和 91 次 `move`。`shape.deletes` 为 0。

`rollback.restored` 为真。嵌套目录兄弟顺序是 `RollA`、`RollB`、`留在原位`、`中文 | 分隔`。`noteKept` 与 `summaryKept` 为真。`externalEditKept` 为真。测试在写入该字段前断言缓存标题仍是 `RollA external`，operation 为 `RollbackConflict`。json 没有另存这个标题字符串。

日常 `Bookmarks` 在 B100 重跑前、以及两条 cargo 命令之后，长度都是 849515，SHA256 都是 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。文件最后写入时间仍是 `2026-10-11T09:22:27.9570134Z`。json 内 `dailyBefore` 与 `dailyAfter` 相同。

### 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC11-1 | PASS | 同一次临时 profile 退出码 0。测试在 `Folders` 后把目录标为已审查，再进入 `Ready`，并断言拒绝 5 条。json 未选项 4 条 `stayed` 为真。回执是 1 次 `create` 加 91 次 `move`，对应 96 条大批量减去这 5 条拒绝。 |
| AC11-2 | PASS | `apply_organization_returns_before_edit_when_the_cached_revision_changes` 在 3 passed 的同一次运行里。缓存 revision 和标题变化后，`Bridge::apply_organization` 返回 `Invalid` / `STALE_PROPOSAL`，出站为空，没有 operation。 |
| AC11-3 | PASS | `restart_leaves_a_dispatched_step_uncertain_and_does_not_replay` 在同一次 3 passed 里：`Bridge::shutdown` 后 `Bridge::open`，重连出站没有 `ApplyOperation`。Chrome json 的 uncertain 为 `39..40`，ordinal 39 及之后回执为空。 |
| AC11-4 | PASS | `rollback.restored` 为真，嵌套兄弟顺序恢复。`noteKept`、`summaryKept`、`externalEditKept` 为真。有冲突时测试断言外部标题仍是 `RollA external`。 |
| AC11-5 | PASS | `cleanup_organization_without_confirm_does_not_delete` 在同一次 3 passed 里。`confirm` 为假时 `Cancelled`，树不变，无出站。B100 的 `deletes` 为 0，回执没有 `delete`。 |
| 父 V08 | PASS | 第 40 步已发送且无回执，重启后仍为 uncertain，未重放，没有重复 create 或 delete。无冲突回滚恢复嵌套顺序和侧车 note、summary。有冲突时不覆盖外部标题。本轮没有另跑并发回滚。 |
| 父 V13 | PASS | 这次重跑退出码 0。json 有 100 条书签、1 个嵌套目录、1 个重复 `urlKey`、中文和英文标题、未拆成标签的 `中文 \| 分隔`，以及 `moved` 与 `deleted` 都为假的根和 `bookmarks-bar`。部分拒绝、第 40 步 uncertain、无重放、无额外删除、嵌套顺序恢复和外部标题保留都在这次运行里。 |

### 命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `Get-FileHash` 日常 `Bookmarks`（检查重跑前） | 0 | 849515，`DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture --test-threads=1` | 0 | 1 passed，83 filtered out，3.39 秒。`b100-run.json` 重写为 PASS，`chromePids` 为 12 |
| `cargo test -p markbridge-core --lib --locked -- apply_organization_returns_before_edit cleanup_organization_without_confirm restart_leaves_a_dispatched_step --test-threads=1` | 0 | 3 passed，81 filtered out，0.19 秒 |
| `Get-FileHash` 日常 `Bookmarks`（检查重跑后） | 0 | 849515，`DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`，最后写入时间未变 |
