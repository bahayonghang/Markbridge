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

## V07 policy file

上面的 V07 行仍是注册表来源，不是这一轮的结果。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/v07-policy-file.mjs` | 0 | PASS |
| `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/v07-policy-file.mjs` | 0 | PASS。检查重跑。 |

报告 `evidence/v07-policy-file-report.json`，run `9d7b4289-ec72-480e-b9ee-0d26a6a980eb`。浏览器是 stock Chromium 157.0.8100.0，ProductName 为 Chromium，路径 `%TEMP%\markbridge-06-filepolicy\chrome-win\chrome.exe`。没有使用 `%TEMP%\markbridge-06-chromium`，没有改 `chrome.exe` 或 `chrome.dll`。两个文件的 SHA256 前后都是 `6b92945a2d3da600a99a0d14c0fb2ff32538037d4ca8933c839313497be4c234` 和 `81582b6200295c7de89109f71edcf8c1332e98df63dbd2a94bc647f9986ade31`。

策略文件 `C:\Users\lyh\AppData\Local\Temp\markbridge-06-filepolicy\chrome-win\policies\managed\mb06.json`，109 字节，SHA256 `8b53ab17c7733820897efe91fa0dcb6fa3709ac25d0708505dedcd3f67f12745`。Chromium 进程退出码 0。`chrome.bookmarks` 没有 managed 节点，`markerPresent` 为 false，`chrome://policy` 正文没有 `ManagedBookmarks`。stock Windows Chromium 没有从该 JSON 文件加载托管书签。第二次启动前该文件已移走。

隔离用户数据目录 `C:\Users\lyh\AppData\Local\Temp\markbridge-06-userdata-PZrh6i` 是 managed 节点的来源。`Local State` 里的 `local_test_policies_for_next_startup` 提供 `ManagedBookmarks`。Chromium 进程退出码 0。`managedPresent` 与 `markerPresent` 都是 true。`chrome://policy` 正文仍然没有 `ManagedBookmarks`；节点来自扩展页的 `chrome.bookmarks.getTree`。

managed 节点和它的一个后代，delete 与 move 都被产品拒绝，代码都是 `BACKEND_PROTECTED_NODE`。树摘要不变：节点数 5，摘要 `c0beed9b9e917afb`。后代仍在。

脚本没有调用注册表写入。前后快照的 `registryChangedKeys` 为空，`noRegistryKeyWritten` 为 true。`HKCU\Software\MBPolicy` 不存在。已有的 `HKCU\Software\Chromium` 没有 `ManagedBookmarks` 值，哈希未变。日常书签长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。已安装 Chrome 的 `chrome.exe` 哈希未变。`Markbridge.Pairing` 目标数 0。凭据命名空间 `Markbridge.Task06.7ecfa3`，结束时目标数 0。

检查重跑同一命令，退出码 0，PASS。报告仍是 `evidence/v07-policy-file-report.json`，run `1df7c034-1d6a-4dee-978a-030758275fa2`。策略 JSON 阶段 `managedPresent` 与 `markerPresent` 都是 false，`policyPageListsManagedBookmarks` 为 false，Chromium 退出码 0。managed 节点来自隔离用户数据目录，机制是 `local_test_policies_for_next_startup`，`cause` 为 `user-data`。该阶段 `managedPresent` 与 `markerPresent` 都是 true。脚本把 `markerPresent` 记为 true 的条件是：根的一个子节点 `folderType` 为 `managed` 或 `unmodifiable` 为 `managed`，并且它的后代 URL 等于探测地址 `https://example.invalid/mb06/managed`。

该节点和它的一个后代，delete 与 move 的产品调用都返回 `BACKEND_PROTECTED_NODE`。树摘要未变：节点数 5，摘要 `c0beed9b9e917afb`。后代仍在。

`registryChangedKeys` 为空。`registryWriteApiCalled` 为 false，脚本源码没有注册表写入调用。`chrome.exe` 与 `chrome.dll` 的 SHA256 前后都是 `6b92945a2d3da600a99a0d14c0fb2ff32538037d4ca8933c839313497be4c234` 和 `81582b6200295c7de89109f71edcf8c1332e98df63dbd2a94bc647f9986ade31`。浏览器路径是 `%TEMP%\markbridge-06-filepolicy\chrome-win\chrome.exe`，没有使用 `%TEMP%\markbridge-06-chromium`，没有改二进制。日常书签长度 849515，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`Markbridge.Pairing` 目标数前后都是 0。任务命名空间结束时目标数 0。

## V07 隔离来源收束

日期：2026-10-12。没有新开 Chromium 或 Chrome 进程。上面的 PASS 行保持原记录，这一节不是一次新运行的 PASS。V07 保持 PASS。

已记录命令 `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/v07-policy-file.mjs`，退出码 0，run `1df7c034-1d6a-4dee-978a-030758275fa2`。报告 `evidence/v07-policy-file-report.json` 的 `status` 为 PASS。策略文件 `C:\Users\lyh\AppData\Local\Temp\markbridge-06-filepolicy\chrome-win\policies\managed\mb06.json` 的 `markerPresent` 为 false，`managedPresent` 为 false。隔离用户数据目录 `C:\Users\lyh\AppData\Local\Temp\markbridge-06-userdata-5a2ab4` 经 `Local State` 的 `local_test_policies_for_next_startup` 产生 managed 节点，`cause` 为 `user-data`，`markerPresent` 为 true。delete 与 move 返回 `BACKEND_PROTECTED_NODE`。树节点数 5，摘要 `c0beed9b9e917afb`。

没有还能在不提权、不使用日常 Chrome 资料的前提下观察的未用隔离来源，所以没有新开进程。

## V07 隔离来源收束核对

日期：2026-10-12。对照 `evidence/v07-policy-file-report.json`。未重跑 `v07-policy-file.mjs`，未新开 Chromium 或 Chrome。

`command` 为 `node .trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/evidence/v07-policy-file.mjs`，`exitCode` 为 0，`runId` 为 `1df7c034-1d6a-4dee-978a-030758275fa2`，`status` 为 PASS。`policyFile.markerPresent` 与 `policyFile.managedPresent` 都是 false。`userData.directory` 为 `C:\Users\lyh\AppData\Local\Temp\markbridge-06-userdata-5a2ab4`，`userData.mechanism` 为 `local_test_policies_for_next_startup`，`cause` 为 `user-data`，`userData.markerPresent` 为 true。四条 delete/move 控制的 `code` 都是 `BACKEND_PROTECTED_NODE`。`tree_digest.count` 为 5，`hash` 为 `c0beed9b9e917afb`，`unchanged` 为 true。上一节与这些字段一致。V07 保持 PASS。`git diff --name-only -- apps crates packages scripts tests` 为空。
