# 06 证据

日期：2026-10-11。HEAD 起点 `757977c`。工作树未提交。未使用日常 Chrome 资料、未修改已安装扩展、未写入 `Markbridge.Pairing`。

## 命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm protocol:check` | 0 | PASS |
| `pnpm typecheck` | 0 | PASS |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | PASS。Vitest 70，node:test 5。修复前同命令退出码 1：`App.test.tsx` 中 backend mock 没有 `listOperations`，EditDesk 挂载时抛错并拆掉页面。补上 mock 与 effect 内捕获后重测通过。 |
| `cargo test --workspace --locked --offline` | 0 | PASS。52 passed，7 suites。实施者命令，检查阶段另跑了不带 `--offline` 的 locked 形式。 |
| `pnpm test:e2e` |  | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` |  | NOT_RUN |
| `pnpm build:native` |  | NOT_RUN |

## 验收

| 条款 | 命令 | 退出码 | 状态 | 覆盖 |
|---|---|---|---|---|
| AC06-1 | `pnpm test` | 0 | PASS | 扩展执行器覆盖创建、更新、移动、同父排序、删除。实时快照后 `apply_operation` 调用 `chrome.bookmarks` 一次，相同 requestId 再次到达不再创建。桌面测试在确认前不调用 `apply_edit`。 |
| AC06-2 | `pnpm test`；`cargo test --workspace --locked --offline` | 0；0 | PASS | 根、`folderType`、managed 后代、环、managed 下创建均不调用 Chrome。未连接或核对中的 `apply_edit` / `apply_operation` 返回 `READ_ONLY` 且不写备份。错误世代返回 `WRONG_PROFILE`，配对不被清除。 |
| AC06-3 | `cargo test --workspace --locked --offline` | 0 | PASS | `editing` 测试覆盖无冲突撤销恢复内容与顺序，外部标题或兄弟顺序变化时保留外部值并记录冲突。冲突撤销不发送浏览器写入。 |
| AC06-4 | `pnpm test` | 0 | PASS | `before-effect`、`after-effect`、`before-ack` 后重启：create/delete 不重复执行；没有回执时结果为 `uncertain`，不报告 `applied`。已保存回执只重放。 |
| AC06-5 | `cargo test --workspace --locked --offline` | 0 | PASS | Netscape HTML 保留目录并转义。侧车 JSON 单独导出。备份目录不可创建时返回 `STORAGE_ERROR`，不发送 `apply_operation`，不插入操作。发送失败把操作记为 `failed`。 |
| V07 | `node .trellis/tasks/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs` | 0 | PASS | Chromium 157.0.8099.0，临时目录中的 `chrome-win\chrome.exe`，ProductName 为 Chromium。run `1f4ba946-621b-47a1-b214-821a791037ce`。`chrome.dll` 偏移 305431232 与 `chrome.exe` 偏移 2458832 各有 1 次 UTF-16LE `SOFTWARE\Policies\Chromium`，只把这 52 字节换成 `SOFTWARE\MBPolicy\Chromium`。文件长度仍是 337448960 和 3100672。当前用户写入 `HKCU\Software\MBPolicy\Chromium`，没有提权。`protected_managed` 为 PASS，`managedPresent` true，`descendantChecked` true。同一次运行的创建、更新、同父排序、跨父移动、根和 `folderType` 拒绝、外部冲突都是 PASS。清理 `mbPolicyAbsent`、`chromiumPolicyAbsent`、`googleChromePolicyAbsent`、`hklmUnchanged`、`dailyBookmarksUnchanged` 都是 true。同一次运行的 V08 控制也是 PASS。 |
| V08 | `node .trellis/tasks/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs` | 0 | PASS | run `1f4ba946-621b-47a1-b214-821a791037ce`，Chromium 157.0.8099.0。`delete_recovery` 更换了 chrome id，并恢复顺序和备注。`concurrent_rollback` 返回 `BACKEND_CONFLICT`。`crash_after_apply` 重启后仍是一个 `applied` 副本。`lost_ack` 重连刷新后仍是一个 `applied` 副本，copies 1。`final_tree` 为 PASS，节点数 11，摘要 `da12dc8db94c4e51`。先前 Chrome 155.0.8059.39 的观察仍在 `evidence/check-review.md`。run `a4f97126-8caa-49dc-8034-4968bde03e6d` 未执行 V08，不是这一轮的通过记录。 |

## 检查命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS。55 passed，7 suites。 |
| `pnpm typecheck` | 1，修复后 0 | 首次 `executor.test.ts` 把闭包赋值收窄成 `never`。改为对象字段后退出码 0。 |
| `pnpm protocol:check` | 0 | PASS |
| `node .trellis/tasks/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs` | 0 | 报告 `evidence/v07-v08-report.json`，run `1f4ba946-621b-47a1-b214-821a791037ce`。状态 PASS。`protected_managed` PASS，`managedPresent` true，`descendantChecked` true。`Markbridge.Pairing` 与 Task06 目标数量都是 0。这一轮执行了 V07 和 V08 控制，全部 PASS。清理五个布尔值都是 true。 |
