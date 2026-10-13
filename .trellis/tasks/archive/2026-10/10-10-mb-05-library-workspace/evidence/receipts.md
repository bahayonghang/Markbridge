# 05 验收记录

日期：2026-10-11。HEAD：`7efbca317bcce0d2c2e178c6c5b27dc32c2bc8c3`。改动未提交。

机器：Windows 11 10.0.26300，Intel Core Ultra 9 275HX，物理内存 68143853568 字节。检查结束时注册表 `HKCU\Control Panel\Desktop\WindowMetrics\AppliedDPI` = 120，即 125%。测量没有修改系统 DPI。WebView2 `devicePixelRatio` = 1.25。Node v26.7.0。rustc 1.99.0。

B10K 使用固定 seed `20261010`。文件镜像测量和已加载资料搜索使用一次性目录。在线测量使用一次性 Chrome 用户数据目录、临时 `MARKBRIDGE_APP_DATA` 和 `Markbridge.Task05.{uuid}`。这些命令前后 `Markbridge.Pairing` 都是 0 条。没有使用日常 Chrome 配置。应用数据目录在测量结束后删除。

百分位由 `evidence/measure.mjs` 计算：排序后取 `sorted[ceil(n * ratio) - 1]`。原始数值在 `evidence/native-summary.json`。

## 第一次测量（修复前）

`node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/measure.mjs`，退出码 0。冷启动 622 ms、852 ms、701 ms。搜索 `MB05MARK` 30 次，第一次 249.6 ms，后 29 次暖态 p50 248.2 ms，p95 250 ms，max 250.4 ms。计时从输入开始，包含 200 ms 去抖。暖态 p95 未达到 200 ms。该次 V06 / AC05-4 为 FAIL。

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

状态：PASS

- `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/profile-live.mjs`，进程退出码 0，报告 `status` 为 PASS。100 条样本：25 创建、25 修改、25 移动、25 删除。p50 62 ms，p95 245 ms，max 246 ms。每条都 ≤ 3 s，`timedOut` 都是 false。
- 可见行按 `.library-title` 或 `.library-url` 的全文相等判断。`https://example.com/item/6` 不会把 `https://example.com/item/61` 当成命中。当前 B10K 没有 `item/60` 这个网址，索引 60 用的是重复网址。
- 分类：创建 p50 218 ms，p95 246 ms，max 246 ms。修改 p50 243 ms，p95 245 ms，max 245 ms。移动 p50 31 ms，p95 60 ms，max 61 ms。删除 p50 30 ms，p95 62 ms，max 62 ms。
- 结束后 `cache_tree` 深度 0 与 `chrome.bookmarks.getTree()` 相等。两边都是 11004 个节点，`mismatchCount` 为 0。
- 凭据命名空间 `Markbridge.Task05.cf9c03cf-e252-439c-b524-bdd281d42c52`。运行前 `Markbridge.Pairing` 0 条、`Markbridge.Task05` 1 条，运行后仍是 0 和 1。`AppliedDPI` 前后都是 120。Chrome/155.0.8059.39。监听端口 3186。脚本在结束前吊销配对，界面回到未配对。`revoked` 为 true。
- 子串谓词的前一次 JSON `503a3fe1-527e-4e17-9de1-6ee3fecb681d` 不再作为本项证据。更早一次 FAIL 的 p95 是 8026 ms：短网址命中了另一行，25 次移动和 25 次删除都在 8 s 上限超时。样本选择仍取 75 个互不为子串的网址，范围是 `https://example.com/item/1001` 到 `https://example.com/item/1083`。

## AC05-4

状态：PASS。文件镜像和已加载资料的原生搜索都达到暖态 p95 ≤ 200 ms。

- 已加载资料在输入当次过滤内存中的节点。Rust `cache_search` 仍在 200 ms 后刷新这些行。可见行不再等这次去抖。计时仍从输入开始。父级 200 ms 门槛没有改。
- 组件测试 `shows a loaded profile title on the input turn before cache search`：已加载标题在推进 200 ms 之前可见，此时尚未调用 `cache_search`。`rtk proxy pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx`，退出码 0，29 项通过。这不是原生 p95。
- 第二次文件镜像测量（资料路径仍会等去抖）：冷启动 713 ms、766 ms、668 ms。暖态 p50 5.5 ms，p95 8.800000000745058 ms，max 10.699999999254942 ms。该数字只属于文件镜像。
- 第三次测量前执行 `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked`，退出码 0。然后 `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/measure.mjs`，退出码 0。脚本仍接入一次性 B10K 文件镜像，不是已配对资料。
- 第三次冷启动：601 ms、650 ms、684 ms。p50 650 ms，p95 684 ms，max 684 ms。三次都小于 3 s。
- 第三次搜索 `MB05MARK` 30 次。第一次 8.399999998509884 ms。后 29 次暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。这是文件镜像数字。暖态 p95 ≤ 200 ms。
- 键盘：ArrowDown 前 `library-row-folder:0`。ArrowDown 后 `library-row-folder:1`，`moved` 为 true。ArrowRight 后 `aria-expanded` 为 `true`，`className` 为 `library-row is-active`。
- 已加载资料：`node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/profile-search.mjs`，退出码 0。缓存 11004 个节点。冷启动 659 ms、646 ms、675 ms，都小于 3 s。搜索 `MB05MARK` 30 次。第一次 10.899999999906868 ms。后 29 次暖态 p50 4.2000000001862645 ms，p95 5.2000000001862645 ms，max 5.7000000001862645 ms。计时从输入开始，直到 `[role=option]` 出现 `MB05MARK`。命中来自已同步缓存，包含当前文件夹页以外的节点。Rust `cache_search` 仍在 200 ms 后刷新。父级 200 ms 门槛没有改。`AppliedDPI` 前后都是 120。`devicePixelRatio` 1.25。`Markbridge.Pairing` 前后都是 0 条。

## V03

状态：PASS

- 命令、退出码、100 条样本、p50 62 ms、p95 245 ms、max 246 ms、最终树相等，与 AC05-3 相同。接受证据是精确相等谓词的运行 `cf9c03cf-e252-439c-b524-bdd281d42c52`。
- 子串谓词的 `503a3fe1-527e-4e17-9de1-6ee3fecb681d` 不计入。更早的前缀网址 FAIL 也记在 AC05-3。缓存读取耗时没有当作这次 V03。

## V06

状态：PASS。文件镜像和已加载资料都有原生计时。150% DPI 仍是 UNVERIFIED。

- 父级门槛是从输入到可交互结果的暖态 p95 ≤ 200 ms，以及 3 次冷启动各自 ≤ 3 s。它不限于文件镜像。
- 文件镜像第三次测量与 AC05-4 相同，退出码 0。冷启动 601 ms、650 ms、684 ms。暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。
- 已加载资料与 AC05-4 的 `profile-search.mjs` 相同，退出码 0。冷启动 659 ms、646 ms、675 ms。暖态 p50 4.2000000001862645 ms，p95 5.2000000001862645 ms，max 5.7000000001862645 ms。
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
| 第三次 `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | 文件镜像 PASS。不是资料路径 |
| `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS。vite 提示桌面主包超过 500 kB，命令仍退出 0 |
| `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/measure.mjs` | 0 | PASS。见 AC05-4 |
| `pnpm lint` | 未在本次检查运行 | NOT_RUN。此前一次退出码 1，仅 gitignore 中的 `.omp/extensions/trellis/index.ts`。该文件未改 |
| `pnpm test` | 未在本次检查运行 | NOT_RUN |
| `pnpm test:e2e` | 未在本次检查运行 | NOT_RUN |
| `pnpm build` | 未在本次检查运行 | NOT_RUN。桌面 `pnpm build` 已作为 tauri `beforeBuildCommand` 运行 |
| `pnpm build:native` | 未运行 | NOT_RUN |
| `pnpm --filter @markbridge/desktop tauri dev` | 未运行 | NOT_RUN |
| `python ./.trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace` | 未在本次检查运行 | NOT_RUN |
| `pnpm --dir apps/desktop exec tauri build --no-bundle -- --locked` | 0 | PASS。去掉移动/删除冲突诊断输出后重编，28.00 s。vite 仍提示桌面主包超过 500 kB |
| `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/profile-search.mjs` | 0 | PASS。已加载资料，见 AC05-4 / V06 |
| `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/profile-live.mjs` | 0 | 精确相等谓词复跑 PASS。运行 `cf9c03cf-e252-439c-b524-bdd281d42c52`。见 AC05-3 / V03 |
