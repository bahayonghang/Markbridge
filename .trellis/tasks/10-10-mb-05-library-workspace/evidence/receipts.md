# 05 验收记录

日期：2026-10-11。HEAD：`a3fcdcb379034f4d2f22565b82abbfc95daa6362`。改动未提交。

机器：Windows 11 10.0.26300，Intel Core Ultra 9 275HX，物理内存 68143853568 字节。检查结束时注册表 `HKCU\Control Panel\Desktop\WindowMetrics\AppliedDPI` = 120，即 125%。本次没有修改系统 DPI。WebView2 `devicePixelRatio` = 1.25。Node v26.7.0。rustc 1.99.0。

B10K 使用固定 seed `20261010` 的一次性 Chrome 用户数据目录和空的 `MARKBRIDGE_APP_DATA`。没有使用日常 Chrome 配置，没有点击配对、重新连接或吊销，没有写入 `Markbridge.Pairing`。应用数据目录在测量结束后删除。

百分位由 `evidence/measure.mjs` 计算：排序后取 `sorted[ceil(n * ratio) - 1]`。原始数值在 `evidence/native-summary.json`。

## 第一次测量（修复前）

`node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs`，退出码 0。冷启动 622 ms、852 ms、701 ms。搜索 `MB05MARK` 30 次，第一次 249.6 ms，后 29 次暖态 p50 248.2 ms，p95 250 ms，max 250.4 ms。计时从输入开始，包含 200 ms 去抖。暖态 p95 未达到 200 ms。该次 V06 / AC05-4 为 FAIL。

## AC05-1

状态：PASS

- `rtk proxy pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx`，退出码 0。29 项通过。B10K 镜像走 `get_mirror_tree`，树、列表和详情一致：下级文件夹 1003，下级书签 10000，最深解析深度 20，1000 个重复 URL 对应 1000 个不同 `chromeId`。长标题在 `.library-title` 上，竖线标题保持整句。
- `cargo test --workspace --locked`，退出码 0。42 项通过，包含 `b10k_file_uses_the_read_only_mirror_parser`。同一生成文件经 `parse_bookmarks`：11004 个节点，10000 条书签，1004 个文件夹。
- 原生窗口见 `native-1280x800.png`、`native-1920x1080.png`。根列表显示「下级文件夹 1003 · 下级书签 10000」，来源文案为「只读文件来源。此来源不能写入浏览器。」Chrome 文件根节点没有名称，界面显示「未命名」，浏览器节点为 `0`。
- 长标题布局在同一次原生会话里测量。搜索「长标题」后，`.library-title` 的 `clientWidth` 671、`scrollWidth` 3888，`white-space` 为 `nowrap`，`text-overflow` 为 `ellipsis`。所在 `.library-row` 的 `clientWidth` 与 `scrollWidth` 都是 750，`rowOverflows` 为 false。标题在行内被截断，行本身没有溢出。

## AC05-2

状态：PASS

- 同上 vitest，退出码 0。20 次资料切换后旧结果不在界面上；迟到的上一资料响应被丢弃；空库、缓存只读和版本缺口有对应文案。
- 这是组件里的两个资料。没有启动两份一次性 Chrome。
- 断线文案：「扩展未连接。显示本机缓存，当前只读。」重连中文案：「正在连接扩展。当前只读。」空库文案：「此资料还没有书签。」未接入来源：「尚未接入书签来源。」

## AC05-3

状态：UNVERIFIED

- 没有运行在线 100 次变更命令。退出码：无。
- V03 需要 live 期间从 Chrome 事件到界面可见，并与 Chrome 最终树比较。确认配对会写入操作系统凭据命名空间 `Markbridge.Pairing`（`apps/desktop/src-tauri/src/main.rs` 中 `OsCredentialStore::new("Markbridge.Pairing")`）。本次禁止写入该命名空间，也禁止使用日常 Chrome 配置。一次性用户数据目录不能单独把扩展书签事件送到界面。
- 缓存读取耗时不能当作 V03。没有 p50、p95、max，也没有最终树比较。

## AC05-4

状态：文件镜像原生达标。已加载资料没有原生 B10K 计时，该路径不标 PASS。

- 已加载资料在输入当次过滤内存中的节点。Rust `cache_search` 仍在 200 ms 后刷新这些行。可见行不再等这次去抖。计时仍从输入开始。父级 200 ms 门槛没有改。
- 组件测试 `shows a loaded profile title on the input turn before cache search`：已加载标题在推进 200 ms 之前可见，此时尚未调用 `cache_search`。`rtk proxy pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx`，退出码 0，29 项通过。这不是原生 p95。
- 第二次文件镜像测量（资料路径仍会等去抖）：冷启动 713 ms、766 ms、668 ms。暖态 p50 5.5 ms，p95 8.800000000745058 ms，max 10.699999999254942 ms。该数字只属于文件镜像。
- 第三次测量前执行 `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked`，退出码 0。然后 `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs`，退出码 0。脚本仍接入一次性 B10K 文件镜像，不是已配对资料。
- 第三次冷启动：601 ms、650 ms、684 ms。p50 650 ms，p95 684 ms，max 684 ms。三次都小于 3 s。
- 第三次搜索 `MB05MARK` 30 次。第一次 8.399999998509884 ms。后 29 次暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。这是文件镜像数字。暖态 p95 ≤ 200 ms。
- 键盘：ArrowDown 前 `library-row-folder:0`。ArrowDown 后 `library-row-folder:1`，`moved` 为 true。ArrowRight 后 `aria-expanded` 为 `true`，`className` 为 `library-row is-active`。
- 已加载资料的原生 B10K 搜索没有运行。退出码：无。状态 NOT_RUN。不用文件镜像的 p95 给这条路径标 PASS。

## V03

状态：UNVERIFIED

- 命令未运行。退出码：无。
- 原因与 AC05-3 相同。没有 p50、p95、max，也没有最终树比较。

## V06

状态：文件镜像原生 PASS。已加载资料的原生计时 NOT_RUN。整体不标 PASS。

- 父级门槛是从输入到可交互结果的暖态 p95 ≤ 200 ms，以及 3 次冷启动各自 ≤ 3 s。它不限于文件镜像。
- 文件镜像第三次测量与 AC05-4 相同，退出码 0。冷启动 601 ms、650 ms、684 ms。暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。
- 已加载资料没有原生 B10K 会话，没有资料路径的 p50、p95、max。组件测试只证明已加载标题在输入当次出现。
- 键盘和焦点证据见 AC05-4。
- 125% 是测量时的系统 DPI。第三次测量后注册表 `AppliedDPI` 仍为 120。没有修改 DPI。150% 未设置，状态 UNVERIFIED。
- `pnpm build:native` 未运行，状态 NOT_RUN。

## 其他命令

| 命令 | 退出码 | 状态 |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS。42 项通过 |
| `pnpm typecheck` | 0 | PASS |
| `pnpm protocol:check` | 0 | PASS |
| `pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx` | 0 | PASS。先 28 项，资料输入当次测试加入后 29 项 |
| `pnpm exec eslint apps/desktop/src packages/protocol/src/bridge.ts scripts/protocol.mjs tests/e2e/foundation.spec.ts --max-warnings 0` | 0 | PASS |
| `pnpm exec eslint apps/desktop/src/features/library/LibraryWorkspace.tsx apps/desktop/src/features/library/library.test.tsx --max-warnings 0` | 0 | PASS |
| `pnpm --filter @markbridge/desktop typecheck` | 0 | PASS |
| 第三次 `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS |
| 第三次 `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | 文件镜像 PASS。不是资料路径 |
| `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS。vite 提示桌面主包超过 500 kB，命令仍退出 0 |
| `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | PASS。见 AC05-4 |
| `pnpm lint` | 未在本次检查运行 | NOT_RUN。此前一次退出码 1，仅 gitignore 中的 `.omp/extensions/trellis/index.ts`。该文件未改 |
| `pnpm test` | 未在本次检查运行 | NOT_RUN |
| `pnpm test:e2e` | 未在本次检查运行 | NOT_RUN |
| `pnpm build` | 未在本次检查运行 | NOT_RUN。桌面 `pnpm build` 已作为 tauri `beforeBuildCommand` 运行 |
| `pnpm build:native` | 未运行 | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` | 未运行 | NOT_RUN |
| `python ./.trellis/scripts/task.py validate .trellis/tasks/10-10-mb-05-library-workspace` | 未在本次检查运行 | NOT_RUN |
