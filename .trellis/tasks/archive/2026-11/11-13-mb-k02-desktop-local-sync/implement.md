# K02 执行计划

## 实施清单

- [x] 1. 确认 K01 阶段收据已 PASS，阅读 `trellis-before-dev` 及 `implement.jsonl` 中全部规范。
- [x] 2. 修改 `crates/protocol/src/bridge.rs` 增加 `BridgeConnection::Local`，运行 `pnpm protocol:generate` 与 `pnpm protocol:check`。
- [x] 3. 在 `crates/core/src/bridge/` 实现 `local-skills` 加载、`ensure_local_library`、全量浏览器写回/配对拦截与 `local_watch.rs` 外部 SQLite 变更热重载。
- [x] 4. 在 `apps/desktop/src-tauri/src/main.rs` 注册 `ensure_local_library`（含 `trusted(&window)?` 守卫）并在 `RunEvent::Resumed` 触发 `reload_local_space`。
- [x] 5. 更新 `apps/desktop/src/`（`backend.ts`、`source-status.ts`、`App.tsx`、`ConnectionSettings.tsx`、`LibraryWorkspace.tsx`）并补充 Vitest 与 Playwright 测试。
- [x] 6. 运行全套验证命令并通过 `trellis-check`，将阶段收据写入 `evidence/check-report.md`。

## 验证命令

```powershell
pnpm protocol:check
cargo test --workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/shell.spec.ts tests/e2e/workspace-layout.spec.ts --workers=1
```

## 风险与回滚点

- 修改 `ConnectionSettings.tsx` 与 `App.tsx` 时，严禁破坏空库首次启动 `onboarding` 标题与按钮可访问名称；用 `shell.spec.ts` 即时回归验证。
