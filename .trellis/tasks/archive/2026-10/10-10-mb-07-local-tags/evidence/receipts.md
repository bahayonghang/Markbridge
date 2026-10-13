# 07 证据

日期：2026-10-11。工作树未提交。此前检查复跑了表内 Cargo 和 pnpm 命令。本次检查只重跑了一次 `chrome-tag-harness`，退出码 0，run `7d423b1d-da25-4dbb-87dc-b2bff7181433`。旧 run `97c804e7-7467-462a-aed2-a0c1fbb2ec63` 不再作为 V09 证据。未启动日常 Chrome。另开了 TEMP 下的临时 Profile。未改已安装扩展，未写 `Markbridge.Pairing`，未改 AppliedDPI、HKLM、`HKCU\Software\Policies` 或 `C:\Program Files\Google\Chrome`。

## 命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo fmt -p markbridge-core` | 0 | PASS。写回本轮 Rust 格式。 |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS。64 passed，7 suites。 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。No issues found。 |
| `pnpm protocol:check` | 0 | PASS。Protocol generation matches tracked outputs。 |
| `pnpm typecheck` | 0 | PASS |
| `pnpm test` | 0 | PASS。Vitest 77，node:test 5。 |
| `pnpm lint` | 1 | 4 个错误都在 `.omp/extensions/trellis/index.ts`：`no-useless-assignment` 3，`no-empty` 1。未改该文件。本轮复跑退出码仍是 1，文件未改。 |
| `cargo build -p markbridge-core --example tag_harness --locked` | 0 | PASS。一次性 `examples/tag_harness.rs`。 |
| `node .trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/evidence/chrome-tag-harness.mjs` | 0 | PASS。run `7d423b1d-da25-4dbb-87dc-b2bff7181433`。报告 `evidence/v09-report.json`。 |
| `pnpm --filter @markbridge/desktop tauri dev` |  | NOT_RUN |
| `pnpm build:native` |  | NOT_RUN |

## 验收

| 条款 | 命令 | 退出码 | 状态 | 覆盖 |
|---|---|---|---|---|
| AC07-1 | `cargo test --workspace --locked`；`pnpm test` | 0；0 | PASS | `offline_tag_and_note_edits_leave_chrome_titles_and_round_trip` 在离线库上添加、改备注、删除并恢复标签，比较前后的 `chrome_id/title/url`，操作数为 0。桌面测试对多选执行添加、移除、备注和标签筛选，调用里没有 `preview_edit`、`apply_edit`、`preview_title_encoding`、`apply_title_encoding`。 |
| AC07-2 | `cargo test --workspace --locked` | 0 | PASS | `normalization_folds_case_space_and_unicode_the_same_way` 与存储测试把 `Work` / `work` / `É` / NFD `é` 收成同一个标签。删除后撤销恢复关联。`deleting_a_shared_tag_keeps_the_other_profile_link` 保留另一个 Profile 的链接。重命名撞键后界面要求确认合并。 |
| AC07-3 | `cargo test --workspace --locked`；`pnpm test` | 0；0 | PASS | `pipes_backslashes_and_empty_tags_round_trip_without_a_second_copy` 覆盖竖线、反斜杠、空标签和再次编码不追加。`title_plan_includes_only_the_selected_change_and_not_the_url` 只改选中项，网址步骤为空。`restore_receipt_keeps_the_raw_title_as_last_encoded` 要求恢复回执把 raw 记为 last，缓存仍是旧编码标题时为冲突，对齐后从 raw 再编码且不追加。桌面测试先启用编码并展示两条完整差异，之后才调用 `apply_title_encoding`；第二次预览没有确认按钮。关闭编码只发 `set_encoding`，不增加标题写入。`drops a title diff when local tags change, including a late preview` 在本地标签变更后丢掉差异，迟到的预览不能重新出现确认按钮。 |
| AC07-4 | `cargo test --workspace --locked`；`pnpm test` | 0；0 | PASS | `encoding_preview_is_scoped_and_offline_apply_does_not_write` 把外部标题标成冲突，离线 apply 返回 `ReadOnly`，关闭编码后标题和操作数不变。桌面测试显示「外部标题已改变，这一条不会写入」，且没有确认写入按钮。 |
| V09 | `cargo build -p markbridge-core --example tag_harness --locked`；`node .trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/evidence/chrome-tag-harness.mjs` | 0；0 | PASS | 本次只重跑 node 命令，退出码 0。Google Chrome 155.0.8059.39。run `7d423b1d-da25-4dbb-87dc-b2bff7181433`。总状态 PASS 由 7 条观察同时为 PASS 并且清理通过才写出。临时 `--user-data-dir` 在 TEMP。启动参数包含 `--load-extension`，同一临时 Profile 再用 CDP `Extensions.loadUnpacked` 加载 `apps/extension/dist`。没有使用 `%TEMP%\markbridge-06-chromium`。`Markbridge.Pairing` 被拒绝，进程退出码 1。标题和 URL 来自扩展页 `chrome.bookmarks.get`，不是 SQLite。1. `obs1_local_unchanged` PASS：本地标签和备注后标题与 URL 不变，空标签被拒绝，浏览器操作数不变。2. `obs2_selected_scope` PASS：启用编码本身不改标题；先有 2 条完整 title 差异，然后才 apply；只改选中项，URL 不变。3. `obs3_no_second_copy` PASS：再次预览差异数 0，apply 返回 `INVALID_MESSAGE`，没有第二份编码。4. `obs4_round_trip` PASS：竖线和反斜线往返，无空片段，确认恢复后 `chrome.bookmarks.get` 回到原标题。5. `obs5_disable_and_restore` PASS：关闭编码不改标题、不改树摘要、不增加浏览器操作；确认恢复后回到编码前。6. `obs6_external_conflict` PASS：外部 `chrome.bookmarks.update` 后该条冲突，预览差异数 0，apply 返回 `CONFLICT`，外部标题保留。7. `obs7_tag_restore` PASS：合并后撤销、删除后撤销，关联恢复，标题和 URL 不变。清理：临时目录已删除，Task07 目标数 0，Pairing 目标数 0。运行前后独立核对：日常 Bookmarks 长度 849515、SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`、写入时间均未变；`chrome.exe` 长度与写入时间未变；AppliedDPI 仍是 120；HKLM 值数量 5、子键 0；`HKCU\Software\Policies\Google\Chrome` 与 `Chromium` 仍不存在。 |

## 未跑的原生项

没有启动桌面窗口。`tauri dev` 与 `build:native` 保持 NOT_RUN。V09 的浏览器观察已完成，见上表。
