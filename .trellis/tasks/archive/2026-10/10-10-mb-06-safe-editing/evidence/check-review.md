# 06 检查

日期：2026-10-11。HEAD `757977c`。工作树未提交。未使用日常 Chrome 资料，未修改已安装扩展，未改 AppliedDPI，未挂起主机。`MARKBRIDGE_CREDENTIAL_NAMESPACE=Markbridge.Pairing` 的探针退出码 1，配对目标数量不变。

AC06-1 到 AC06-5 保持 PASS。对应测试调用 `runSteps`、`applyWrites` 或 `Bridge::apply_edit`。

## 命令

| 命令 | 退出码 |
|---|---|
| `cargo fmt --all -- --check` | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 |
| `cargo test --workspace --locked` | 0（55 passed，7 suites） |
| `pnpm typecheck` | 1，修复后 0 |
| `pnpm protocol:check` | 0 |
| `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs` | 0 |

修复前的同脚本运行退出码依次为 1：缺少 `edit_harness.exe`，随后是 `CREATE_NOT_APPLIED`、`uncertain` / `UNCERTAIN_WRITE`、`NOTE_NOT_MIGRATED`。最终记录的是退出码 0 的那次。

## 一次性 Chrome

Chrome 155.0.8059.39。应用数据目录和 Chrome 用户目录都在临时目录。凭据命名空间为 `Markbridge.Task06.{id}`。报告只记录计数、摘要和状态。

V07 保持 UNVERIFIED。创建、更新、同父排序、跨父移动通过，缓存摘要与 Chrome 一致。根和 `folderType` 变更被拒绝，树摘要不变。外部标题冲突后标题和父节点保持外部结果。资料没有 managed 节点，不能把整行标成 PASS。

V08 为 PASS。删除恢复更换了 chrome id，并恢复顺序和备注。干净撤销恢复了内容和地址。并发写入返回 `BACKEND_CONFLICT`。apply 后结束进程，重启后仍是一个 `applied` 副本。创建返回后立即结束进程，重连刷新后仍是一个 `applied` 副本，没有第二次创建。

## 修复

- `authenticated_loop` 原先把 `operation_receipt` 当成非法命令并断开连接，写操作被冻结为 `uncertain`。现在把回执交给 `Bridge::receive`。回归测试 `websocket_operation_receipt_stays_applied_and_connected`。
- 创建事件可能先于回执写入缓存。回执记下新旧 id 映射后立刻调用 `copy_mapped_metadata`，备注会迁到新行。
- `executor.test.ts` 的标记捕获改成对象字段，消除 `pnpm typecheck` 的 `never` 错误。

## 边界

扩展是 Chrome 写入方。Rust 只发 `apply_operation` 并接收回执。harness 里的 `chrome.bookmarks.update` 只用于制造外部编辑。

备份文件在发送前写好。备份失败取消浏览器变更由 `edit_requires_a_live_session_and_keeps_chrome_unchanged_when_backup_or_send_fails` 覆盖，这次 Chrome 运行没有故意制造备份失败。

没有回执时操作保持 `uncertain` 或停留在已保存回执的真实结果。这次丢失 ack 的最终状态是 `applied`，因为扩展保存了回执，且只有一个节点。

同一 Profile 的第二次 `apply_edit` 在第一次仍占用时返回 `BACKEND_CONFLICT`。

桌面、扩展和 harness 的报告没有凭据、完整标题或书签树。

## 复核 run 1f4ba946-621b-47a1-b214-821a791037ce

日期：2026-10-11。未重跑 harness，未改产品代码，未改 `evidence/receipts.md`。上面 Chrome 155.0.8059.39 的 V07 UNVERIFIED 仍指那一次观察。

`evidence/v07-v08-report.json` 的 `status` 为 PASS，`exitCode` 为 0。`protected_managed` 为 PASS，`managedPresent` 为 true，`descendantChecked` 为 true。同一报告里 `crud_create`、`crud_update`、`same_parent_reorder`、`cross_parent_move`、`protected_root_folder_type`、`external_edit_conflict`、`delete_recovery`、`concurrent_rollback`、`crash_after_apply`、`lost_ack`、`final_tree` 都是 PASS。清理五个布尔值都是 true。

`receipts.md` 的 V07 与 V08 行命令都是 `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs`，退出码 0，状态 PASS。这两行与报告控制一致。

`evidence/chrome-edit-harness.mjs` 没有 `Start-Process -Verb RunAs`。`protected_managed` 写成 PASS 之前要有 managed id，删除该节点和它的后代都得到 `BACKEND_PROTECTED_NODE`，两次比对的树摘要都不变，后代 id 仍在。

本机只读核对，没有写注册表，没有读取书签正文：

| 项 | 观察 |
|---|---|
| `HKCU\Software\MBPolicy` | 不存在 |
| `HKCU\Software\Policies\Chromium` | 不存在 |
| `HKCU\Software\Policies\Google\Chrome` | 不存在 |
| `HKLM\SOFTWARE\Policies\Google\Chrome`（64 位与 32 位视图） | 值名恰好是 `ChromeCleanupEnabled`、`ChromeCleanupReportingEnabled`、`DeviceMetricsReportingEnabled`、`MetricsReportingEnabled`、`UserFeedbackAllowed`；子键数 0 |
| 日常 `Bookmarks` | SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`，长度 849515 |
