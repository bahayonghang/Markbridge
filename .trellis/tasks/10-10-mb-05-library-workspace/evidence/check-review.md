# 05 独立检查

日期：2026-10-11。HEAD：`a3fcdcb379034f4d2f22565b82abbfc95daa6362`。工作树未提交。没有提交、推送或归档。没有修改父任务目录、其他任务目录、`.gitignore`、`AGENTS.md`、`.trellis/workspace` 或 `.trellis/spec`。

检查前的实现记录把 AC05-1、AC05-2 标为 PASS，AC05-3 与 V03 标为 UNVERIFIED，AC05-4 与 V06 标为 FAIL。本检查阅读了测试和 `evidence/measure.mjs` 后再给状态。FAIL 的原因与代码一致：文件镜像搜索等 `SEARCH_DEBOUNCE_MS`（200）后才过滤，计时从输入开始，暖态 p95 为 250 ms。

## 修复

已加载资料节点和文件镜像都在输入当次过滤。资料的 Rust `cache_search` 仍在 200 ms 后刷新可见行，但行本身不再等这次去抖。没有把计时起点改到去抖之后，没有改父级验证文件里的 200 ms。设计文档里「不把这 200 ms 算进输入到可交互结果的时间」已删除。

复测前用 `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` 重建 `target/release/markbridge-desktop.exe`。测量脚本仍从输入前的 `performance.now()` 计到结果节点出现。

## 命令

| 命令 | 退出码 | 状态 |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS。42 项通过 |
| `pnpm typecheck` | 0 | PASS |
| `pnpm protocol:check` | 0 | PASS |
| `rtk proxy pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx` | 0 | PASS。29 项通过。新增：已加载资料标题在输入当次可见，200 ms 之前不调用 `cache_search`。`searchSnapshot` n=10000、30 次，p95 2.30 ms，max 4.02 ms |
| `pnpm exec eslint apps/desktop/src/features/library/LibraryWorkspace.tsx apps/desktop/src/features/library/library.test.tsx --max-warnings 0` | 0 | PASS |
| `pnpm --filter @markbridge/desktop typecheck` | 0 | PASS |
| 第三次 `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS |
| 第三次 `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | 文件镜像 PASS。冷启动 601、650、684 ms。暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms |
| `pnpm exec eslint apps/desktop/src packages/protocol/src/bridge.ts scripts/protocol.mjs tests/e2e/foundation.spec.ts --max-warnings 0` | 0 | PASS |
| `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS |
| 第二次 `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | 文件镜像 PASS。冷启动 713、766、668 ms。暖态 p95 8.800000000745058 ms。当时资料路径仍等 200 ms |
| `pnpm lint` | 未运行 | NOT_RUN。不改 `.omp/extensions/trellis/index.ts` |
| `pnpm test` | 未运行 | NOT_RUN |
| `pnpm test:e2e` | 未运行 | NOT_RUN |
| `pnpm build` | 未运行 | NOT_RUN |
| `pnpm build:native` | 未运行 | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` | 未运行 | NOT_RUN |
| 在线 100 次 Chrome 变更 | 未运行 | UNVERIFIED |
| 150% DPI | 未运行 | UNVERIFIED |

测量后 `AppliedDPI` 仍为 120。没有残留 `markbridge-desktop` 进程。

## 验收

| 项 | 状态 | 证据 |
| --- | --- | --- |
| AC05-1 | PASS | vitest 29 项；workspace 测试含 B10K 文件解析；原生计数「下级文件夹 1003 · 下级书签 10000」；长标题行 `rowOverflows` false |
| AC05-2 | PASS | 同一 vitest。20 次切换和迟到响应在组件内完成，不是两份 Chrome |
| AC05-3 | UNVERIFIED | 见下方 V03 阻塞 |
| AC05-4 文件镜像 | PASS | 第三次冷启动 601、650、684 ms；暖态 p95 9.5 ms；ArrowDown 从 `library-row-folder:0` 到 `library-row-folder:1` |
| AC05-4 已加载资料原生 | NOT_RUN | 没有资料 B10K 原生计时。组件测试不等于这条原生门槛 |
| V03 | UNVERIFIED | 见下方阻塞 |
| V06 文件镜像 | PASS | 暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。只覆盖 `measure.mjs` 的文件镜像 |
| V06 已加载资料原生 | NOT_RUN | 不使用上面的镜像数字标 PASS |
| V06 整体 | 不标 PASS | 资料路径没有原生 p95 |
| 150% DPI | UNVERIFIED | 第三次测量后 `AppliedDPI` 仍为 120 |

第三次文件镜像原始值：第一次 8.399999998509884 ms；暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。冷启动 601、650、684 ms。这组数字不是已加载资料的原生结果。

## 合同核对

- 同步缓存走 `cache_tree`、`cache_list`、`cache_search`、`cache_get`、`cache_count`，前端再解析为 `LibraryNodes`、`LibraryPage`、`LibrarySearch`、`LibraryDetail`、`LibraryCount`。文件来源只调用 `get_mirror_tree`。协议节点仍是 `chromeId` / `parentId`。没有第二套节点身份，没有 Netscape HTML 导入或导出。
- 资料切换会清空上一资料的行，并丢弃旧请求。组件测试覆盖 20 次切换。
- 重复 URL 以不同 `chromeId` 各占一行。组件测试要求同一 URL 出现两次，且 option id 不重复。
- 中文和长标题使用单行省略。原生测量里长标题元素比自身可视宽度宽，所在行的 `scrollWidth` 不超过 `clientWidth`。
- 方向键会改焦点行。原生 ArrowDown 改变了 `library-row-*` id。展开后的行带 `is-active`。组件测试断言 `toHaveFocus`。`:focus-visible` 在 `styles.css`。
- 断线、重连中、空库有独立文案，见收据 AC05-2。重连按钮在资料区，文案是「重新连接」，不写入书签。
- 文件镜像显示「不能写入浏览器」。库页面没有移动、删除或应用按钮。「在浏览器中打开」只接受 http(s)，文件夹上为禁用。
- 新增命令不记录凭据、完整标题或书签树。`main.rs` 只在启动或关闭失败时 `eprintln` 固定句子。`open_http` 不打印 URL。

界面选择状态的变量名是 `bookmarkId`，存的是 `chromeId`。它没有进入协议或 SQLite，不是第二套持久身份。术语表里的 `bookmarkId` 仍指本地持久身份。本次没有改名。

## V03 阻塞

live 变化要经过扩展配对。`Bridge::open` 使用 `OsCredentialStore::new("Markbridge.Pairing")`，确认配对会写入这个命名空间。本次检查禁止写入该命名空间，禁止改日常书签。一次性 Profile 和 `MARKBRIDGE_APP_DATA` 可以启动文件镜像，不能代替 live 事件。因此 AC05-3 与 V03 保持 UNVERIFIED，不标 PASS。

## 150% DPI

没有修改系统 DPI。测量结束后 `AppliedDPI` 为 120。150% 保持 UNVERIFIED。
