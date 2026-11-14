# K02 阶段验收收据（桌面端本地书签库展示与数据库实时感知）

验证日期：2026-11-13  
分支：`dev`  
目标子任务：`11-13-mb-k02-desktop-local-sync`

## 1. 交付摘要

1. **桌面可信协议扩展（`BridgeConnection::Local`）**：
   - `crates/protocol/src/bridge.rs` 新增 `BridgeConnection::Local`（序列化为 `"local"`）；运行 `pnpm protocol:generate` 重新导出 JSON Schema、TypeScript 定义与 MV3 CSP 兼容的静态校验器；MV3 扩展 wire 协议未做任何破坏性改动。
2. **后端 `Bridge` 隔离保护与外部 SQLite 变更热重载**：
   - `crates/core/src/bridge/local_watch.rs`：实现 `Bridge::ensure_local_library`、`Bridge::reload_local_space` 以及针对数据库目录的非递归 `notify` 监听（仅响应 `markbridge.sqlite` / `-wal` / `-shm` 事件，120ms 防抖合并），`Bridge::shutdown` 先停止监听并等待协程退出，保证 Windows 下临时目录可立即删除。
   - `crates/core/src/bridge/{mod.rs,tags.rs,organization.rs,maintenance.rs,ai.rs}`：空库启动保持惰性不创建 `local-skills`；对 `local-skills` 调用 `revoke_pairing`、`reconnect_profile`、`associate_file_mirror`、`apply_edit`、`apply_batch_edit`、`preview_title_encoding`、`apply_title_encoding`、`TagCommand::SetEncoding`、`propose_organization`、`apply_organization`、`confirm_cleanup` 等全部返回 `ErrorCode::ReadOnly` 或 `WrongProfile`，`preview_edit` / `preview_batch_edit` 返回 `writable: false`，且不访问系统凭据存储；本地标签、备注、摘要、检索、预览与导出正常开放并同步递增本地 `revision`。
   - `apps/desktop/src-tauri/src/main.rs`：注册主窗口受保护命令 `ensure_local_library`（带 `trusted(&window)?` 守卫，通过 `preview::tests::every_registered_command_checks_the_caller_window`），并在 `RunEvent::Resumed` 中触发 `bridge.reload_local_space().await`。
3. **前端 UI 适配与测试覆盖**：
   - 更新 `apps/desktop/src/backend.ts`、`apps/desktop/src/features/settings/{source-status.ts,ConnectionSettings.tsx}`、`apps/desktop/src/features/tags/TagDesk.tsx`、`apps/desktop/src/features/library/LibraryWorkspace.tsx` 与 `tests/e2e/mock-bridge.ts`：
     - 连接设置支持一键启用并跳转浏览 `Skills 书签库`，对 `local` 资料隐藏重新连接与吊销配对按钮，镜像关联下拉框过滤掉 `local` 资料，且保持空库首次启动 `onboarding` 契约完全不变；
     - 书签库工作台在 `local` 来源下隐藏 Chrome 结构写入口与标题编码开关，完整保留浏览、搜索、标签过滤、标签/备注编辑、内容/网页预览及 HTML/侧车导出。

## 2. 验证矩阵与结果

| 检查项 | 命令 | 结果 | 关键证据 |
|---|---|---|---|
| 协议漂移门禁 | `pnpm protocol:check` | **PASS** | `Protocol generation matches tracked outputs.` |
| Rust 格式与静态检查 | `cargo fmt --all -- --check` & `cargo clippy --workspace --all-targets -- -D warnings` | **PASS** | 0 警告、0 格式差异 |
| Rust 全工作区测试 | `cargo test --workspace` | **PASS** | `markbridge-core`: 148 passed (含 `bridge::tests::local_skills_library_stays_lazy_isolates_from_chrome_and_rejects_browser_mutations` 与 `bridge::tests::external_sqlite_writes_trigger_live_bridge_reload_and_clean_shutdown`)；`markbridge-desktop`: 35 passed；`markbridge-protocol`: 16 passed；`markbridge-skill`: 3 passed |
| 前端代码规范与类型检查 | `pnpm lint` & `pnpm typecheck` | **PASS** | ESLint `--max-warnings 0` 零警告，全包 TypeScript 严格模式通过 |
| 前端组件与协议单测 | `pnpm test` | **PASS** | Vitest 31 files / 274 tests passed（含新增 `App.test.tsx` 与 `backend.test.tsx` 本地库测试），Node 35 contract tests passed |
| Web 与扩展产物构建 | `pnpm build` | **PASS** | `check-artifacts.mjs` 通过（无源码映射、动态代码、密钥或本机绝对路径泄露） |
| Playwright E2E 回归 | `pnpm exec playwright test tests/e2e/shell.spec.ts tests/e2e/workspace-layout.spec.ts --workers=1` | **PASS** | 51 passed (`1.7m`)，空库 `onboarding` 与多视口工作台布局全部通过 |

## 3. 验收标准核对

- [x] **AC-K02-1**：`pnpm protocol:check` 零漂移；空库首次引导 `onboarding` 及 `shell.spec.ts` / `workspace-layout.spec.ts` 51 项 E2E 测试全部通过。
- [x] **AC-K02-2**：Chrome Profile 全量/增量同步不影响 `local-skills`；所有浏览器写回/配对/标题编码入口均被拒绝且零凭据调用。
- [x] **AC-K02-3**：外部向同一临时 `markbridge.sqlite` 写入后，`Bridge` 无需重启自动收到新 `revision` 与新节点，`Bridge::shutdown()` 后临时目录立即完整删除。
- [x] **AC-K02-4**：连接设置页可一键启用并浏览 `Skills 书签库`，`local` 卡片隐藏重新连接/吊销配对，全工作区自动检查通过。
