# 13 Windows 验收收据

日期：2026-10-11 23:05 至 2026-10-12 03:18（-04:00）。平台记录来自注册表：`Windows 10 Pro`，DisplayVersion `26H2`，build `26300`。`OSVersion` 为 `10.0.26300.0`。本收据不把该字符串改写成 Windows 11。

HEAD `1f101ead77e832cec2e52893168bfb148d02cb85`。工作树在本任务开始前已有未提交改动。本任务没有提交。

工具：Node `v26.7.0`，pnpm `12.12.0`，cargo `1.99.0 (5f94df478 2026-08-27)`，rustc `1.99.0 (b940084d7 2026-09-28)`，WebView2 `154.0.4258.62`，Chrome 文件版本 `155.0.8059.39`。没有启动日常 Chrome，没有加载已安装扩展，没有挂起主机，没有设置 `HOME`、`CARGO_HOME` 或 `RUSTUP_HOME`。

## 本任务命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | PASS。锁文件已是最新 |
| `pnpm lint` | 0 | PASS |
| `pnpm typecheck` | 0 | PASS |
| `pnpm test` | 1 | FAIL。Vitest 99 通过。Node 测试 4 通过、1 失败：`scripts/foundation.test.mjs` 期望权限只有 `bookmarks`、`storage`、`alarms`，manifest 实际还有 `scripting`、`activeTab` |
| `pnpm protocol:check` | 0 | PASS。生成结果与已跟踪输出一致 |
| `pnpm test:e2e` | 1 | FAIL。6 项里 2 项通过，4 项失败。失败点是找不到「已连接 Chrome」和「无法读取启动状态」 |
| `pnpm build` | 1 | FAIL。前端与扩展构建完成。`scripts/check-artifacts.mjs` 用同一组旧权限断言失败 |
| `cargo fmt --all -- --check` | 0 | PASS。2026-10-12 trellis-check 重跑，退出码 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS。2026-10-12 trellis-check 重跑，退出码 0。源码没有 `#[allow(clippy::too_many_arguments)]` |
| `cargo test --workspace --locked` | 0 | PASS。112 passed，2 ignored。忽略项是一次性 Chrome 与 loopback 模型测试 |
| `pnpm build:native` | 0 | PASS。23007744 字节，SHA256 `0889fa3059eb2ec69ddbf66aed03b78454847d99c6018018422ef304cd0f134a`。扫描通过。不生成安装包 |
| `pnpm build:package` | 0 | PASS。先再跑无安装包构建和扫描，再用 `--no-sign`、`--no-binary-patching` 生成 NSIS。见 AC13-4 |
| `pnpm --filter @markbridge/desktop tauri build` | 无 | NOT_RUN。该命令不走路径重映射，未执行 |
| `pwsh evidence/isolated-run.ps1` | 0 | 安装、启动、重启、卸载的进程退出码都是 0。V15 仍是 FAIL，见下节 |

第一次 `pnpm build:native` 的标准输出已经写下扫描 PASS，SHA256 `7b0fbfdcc5e86510cbd6584d37f1c00e1b92ef874e0845b1848a37728a37b134`。包装脚本的 `Start-Process -Wait` 没有返回，该次退出码没有记录。上面的退出码 0 来自随后单独重跑的 `pnpm build:native`。两次通过扫描的 release 可执行文件大小同为 23007744 字节，SHA256 不同。

日志在 `evidence/command-log.txt` 和同目录的 `*.stdout.log`、`*.stderr.log`。

## AC13

| 项 | 判定 | 依据 |
|---|---|---|
| AC13-1 | UNVERIFIED | 01–12 的收据已按 V01–V14 引用。V04 仍是 UNVERIFIED。没有把缺跑项写成 PASS。完成条件要求 V01–V15 都是 PASS 或明确 FAIL，这一条没有满足 |
| AC13-2 | FAIL | 隔离目录完成了安装、启动、退出、重启和卸载。配对、同步、双预览、编辑、AI 和恢复没有跑。WebView2 写入了既有的 `%LOCALAPPDATA%\com.markbridge.desktop\EBWebView` |
| AC13-3 | NOT_RUN | 本任务没有跑 seed `20261010` 的 B10K 同步、搜索或冷启动。没有 p50、p95、max。不引用 05 的旧计时充当本次实测 |
| AC13-4 | NOT_RUN | 安装包 hash、已安装 exe hash 和版本 `0.1.0` 已记录。7-Zip 不存在，包内文件清单没有列出。缺清单，不把本项标成 PASS |
| AC13-5 | UNVERIFIED | 没有 Floccus 环境，没有第二设备或第二客户端。侧车数据没有被写成已同步 |

## V01–V16

V01 使用本任务上表。退出码不全是 0，判定 FAIL。

| 门槛 | 判定 | 记录命令与退出码 | 说明 |
|---|---|---|---|
| V01 | FAIL | 上表 | lint、typecheck、protocol、cargo test、`pnpm build:native`、fmt、clippy 为 0。test、e2e、build 非 0 |
| V02 | PASS | 03 收据中的 `cargo test --workspace --locked` 与 `pnpm test` 退出码 0；原生 JSON `42e65e09` 的进程退出码由 03 按脚本推断为 0 | 错误令牌、错误 Origin、两个临时 Profile 的缓存计数 11003 与 4。本任务未重跑该 harness |
| V03 | PASS | 05 `node .trellis/tasks/10-10-mb-05-library-workspace/evidence/profile-live.mjs`，退出码 0 | 100 条：p50 62 ms，p95 245 ms，max 246 ms。运行 `cf9c03cf-e252-439c-b524-bdd281d42c52`。本任务未重跑 |
| V04 | UNVERIFIED | 03、04 收据写明没有导入命令，也没有休眠命令 | 本任务不挂起主机。不把 worker 重启或文件镜像测试写成整行 PASS |
| V05 | PASS | 04 `cargo test --workspace --locked`，退出码 0 | 原子替换、半写 JSON、删除和目录改名后保留最后有效树。Chrome 书签文件的字节与 mtime 在该次测试中未变 |
| V06 | PASS | 05 `measure.mjs` 与 `profile-search.mjs`，退出码都是 0 | 文件镜像冷启动 601 ms、650 ms、684 ms；暖态 p50 5.300000000745058 ms，p95 9.5 ms，max 9.5 ms。已加载资料冷启动 659 ms、646 ms、675 ms；暖态 p50 4.2000000001862645 ms，p95 5.2000000001862645 ms，max 5.7000000001862645 ms。150% DPI 在 05 收据中仍是 UNVERIFIED。本任务未重跑 |
| V07 | PASS | 06 `node .trellis/tasks/10-10-mb-06-safe-editing/evidence/chrome-edit-harness.mjs`，退出码 0 | 运行 `1f4ba946-621b-47a1-b214-821a791037ce`。创建、更新、排序、移动、受保护节点和外部冲突为 PASS |
| V08 | PASS | 同上 06 harness，退出码 0 | `delete_recovery`、`concurrent_rollback`、`crash_after_apply`、`lost_ack` 在该次报告中为 PASS |
| V09 | PASS | 07 `node .trellis/tasks/10-10-mb-07-local-tags/evidence/chrome-tag-harness.mjs`，退出码 0 | 运行 `7d423b1d-da25-4dbb-87dc-b2bff7181433` |
| V10 | PASS | 08 `cargo test --workspace --locked`，退出码 0 | HTTP fixture 覆盖 20 次切换、10 秒超时、受禁目标和图片路径。本任务未重跑 |
| V11 | PASS | 09 `node .trellis/tasks/10-10-mb-09-webpage-preview/evidence/native-preview.mjs`，退出码 0 | 独立预览窗口、资料隔离、37 条拒绝。本任务未重跑 |
| V12 | PASS | 10 `cargo test -p markbridge-core --lib reqwest_ten_public_pages --locked --offline -- --ignored --nocapture --test-threads=1`，退出码 0 | 检查重跑 1 passed。夹具覆盖坏 schema、超长值、注入、取消和 429。本任务未重跑 |
| V13 | PASS | 11 `cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture --test-threads=1`，退出码 0 | 检查重跑 1 passed，3.39 秒。`b100-run.json` 为 100 条书签的合成树，不是 B10K。本任务未重跑 |
| V14 | PASS | 12 库维护测试，`cargo test --workspace --locked` 退出码 0；检查过滤重跑退出码 0 | 404/410、403/429、超时，以及 query 或 fragment 不合并。12 的 `pnpm test` 退出码 1，失败点不在库维护入口。本任务的 `pnpm test` 同样退出码 1 |
| V15 | FAIL | `isolated-run.ps1` 退出码 0；其中安装、启动、重启、卸载进程退出码都是 0 | 配对 NOT_RUN。包内清单 NOT_RUN。WebView2 写入了日常 Local 目录。见下一节 |
| V16 | UNVERIFIED | 无 | 没有 Floccus 测试库，没有第二设备。侧车数据不记为已同步 |

03 的 V03 仍是 NOT_RUN，因为当时没有树界面计时。上表 V03 采用 05 的退出码 0 和原始毫秒数。V06 同样只引用 05，不把本任务没有跑的计时补上。

## 隔离安装与 V15

安装包：`target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe`。5589020 字节。SHA256 `42ffa6b292ed9ccd341005e368c2bbcd82709d257c07482930c55472979094b1`。未签名。未发布。不是已发布版本。

`pnpm build:package` 对打包前的 release exe 扫描通过：23007744 字节，SHA256 `8b66e44de2a09d7fd728404f0c75fc78c5fbf5247e8bf39fafe559fe70be4d8f`。日志有 `Skipping binary patching`。7-Zip 不在 `C:\Program Files\7-Zip\7z.exe`，包内文件清单为 NOT_RUN。没有从安装包里抽出 exe 再扫描。

安装命令使用 `UseShellExecute=false`，参数 `/S /D=C:\Users\lyh\AppData\Local\Temp\mb13-install`。安装进程退出码 0。没有弹出提权。`%LOCALAPPDATA%\Markbridge` 安装前后都是 ABSENT。

已安装文件：`C:\Users\lyh\AppData\Local\Temp\mb13-install\markbridge-desktop.exe`。23007744 字节。SHA256 `8B66E44DE2A09D7FD728404F0C75FC78C5FBF5247E8BF39FAFE559FE70BE4D8F`，与这次打包的 release exe 相同。`ProductVersion` 与 `FileVersion` 都是 `0.1.0`。

两次启动都设置了绝对路径 `MARKBRIDGE_APP_DATA=C:\Users\lyh\AppData\Local\Temp\mb13-data`、`MARKBRIDGE_CREDENTIAL_NAMESPACE=Markbridge.Task05.mb13-accept`，并把该进程的 `APPDATA`、`LOCALAPPDATA` 指到 `mb13-roaming` 与 `mb13-local`。第一次 PID 69796，第二次 PID 62568。两次都找到标题含 Markbridge 的窗口，`WM_CLOSE` 已发送，进程退出码都是 0。`mb13-data\markbridge.sqlite` 为 204800 字节，SHA256 `19AFDFC11AFDE59E3561DFAAEFC6EAA0AF015B5D71B0A5178614F57BB80DA106`。`mb13-local` 与 `mb13-roaming` 在运行后仍是 0 个文件。

卸载进程退出码 0，路径 `C:\Users\lyh\AppData\Local\Temp\mb13-install\uninstall.exe`。退出当时目录仍有 2 个文件。稍后复查该目录已不存在。卸载没有删除上述临时 sqlite。这只说明这次临时目录里的 sqlite 还在，不是完整的用户数据策略。

日常路径：

| 路径 | 运行前 | 运行后 |
|---|---|---|
| `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` | 849515 字节，mtime `2026-10-11T09:22:27.9570134Z`，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` | 相同 |
| `%APPDATA%\com.markbridge.desktop` | 3 个文件，最新 `2026-10-11T09:20:16.3460420Z` | 相同 |
| `%LOCALAPPDATA%\com.markbridge.desktop` | 457 个文件，最新 `2026-10-11T21:32:20.1215263Z` | 461 个文件，最新 `2026-10-12T03:17:48.5775353Z` |

Local 目录下 `EBWebView` 的多个文件在 2026-10-12 03:17 写入，包括 `Default\History` 和 `Default\Preferences`。进程环境里的 `LOCALAPPDATA` 没有接住这些文件。日常 Local 数据目录被用到了。这些文件没有回滚。

`cmdkey` 里 `Markbridge.Pairing` 与 `Markbridge.Model` 前后都是 0。没有点击配对。配对、同步、双预览、编辑、AI 和恢复为 NOT_RUN。结束后 `markbridge-desktop` 进程数为 0。没有另做端口监听清单，listener 检查为 NOT_RUN。

卸载后 `HKCU\Software\markbridge\Markbridge` 的默认值仍是 `C:\Users\lyh\AppData\Local\Temp\mb13-install`。确认只有这一条临时路径后，删除了 `HKCU\Software\markbridge`。复查该键不存在。没有写 `HKCU\Software\Policies` 或 `HKLM`。临时目录 `mb13-data`、`mb13-local`、`mb13-roaming` 在记录 hash 之后删除。

## 打包入口

`pnpm build:native` 仍是 `--no-bundle` 加扫描，不生成安装包。`pnpm build:package` 调用前者，再执行 `tauri bundle --bundles nsis --no-sign --no-binary-patching`。`tauri.conf.json` 的 `bundle.active` 仍是 false。

## 回退

没有发布，没有签名，没有安装到日常目录 `%APPDATA%\com.markbridge.desktop`。测试安装目录后来已不存在。`HKCU\Software\markbridge` 已删除。WebView2 写过的日常 Local `EBWebView` 文件仍在。产品源码里的 fmt 和 clippy 差异没有在本任务里改写。

## 2026-10-11 trellis-check

本检查没有执行安装程序，没有配对，没有改产品源码，没有写回 `cargo fmt`，没有删除 `%LOCALAPPDATA%\com.markbridge.desktop`。

`command-log.txt` 第 17–26 行是门禁脚本记下的命令和退出码，对应 `01`–`10` 的 stdout/stderr 日志。这 10 行保留。`pnpm test`、`pnpm test:e2e`、`pnpm build` 的日志分别是权限断言失败、4 失败 / 2 通过、同一权限断言失败。`cargo test` 日志是 88 + 12 + 12 通过、2 忽略。clippy 日志以编译失败结束，另有 `chunks_exact` 和 `manual_is_multiple_of`；退出码 101 保留，没有重跑。

`11-build-native.stdout.log` 停在扫描 PASS，SHA256 `7b0fbfdcc5e86510cbd6584d37f1c00e1b92ef874e0845b1848a37728a37b134`，没有进程退出码。命令日志里的重跑 SHA256 `0889fa3059eb2ec69ddbf66aed03b78454847d99c6018018422ef304cd0f134a` 不在该日志中，这一行不保留。本检查重跑 `pnpm build:native`，退出码 0。产物 23007744 字节，SHA256 `be4c67f6de966af06156b9af464b0ac8666a2b4bbdb984889b84fd3ebc10f3b8`。

没有 `12-build-package` 日志，原退出码 0 不保留。重跑前磁盘上的安装包是 5589020 字节，SHA256 `42FFA6B292ED9CCD341005E368C2BBCD82709D257C07482930C55472979094B1`，与上节记录相同。本检查重跑 `pnpm build:package`，退出码 0。没有执行 setup。新的 release exe 为 23007744 字节，SHA256 `fdc98cb94ee67815f0bbc457787693c12160c17483506b62a927ed2170088a8b`。新的 `target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe` 为 5589087 字节，SHA256 `3757c2e9d31143b5d773c9cb3b5520d26425e4e927530af8e33a6705ceeb61b3`。输出写明未签名、未发布，以及 `NSIS content list: NOT_RUN; 7-Zip is absent.` 两个 7-Zip 路径都不存在。

`isolated-run.ps1` 会打印 `INSTALL code=`、`START_EXIT`、`RESTART_EXIT`、`UNINSTALL code=`。证据目录没有这份脚本输出。命令日志第 31 行的退出码 0 不保留。没有重跑该脚本。

`cargo fmt --all -- --check` 本检查退出码 1。没有格式化写回。

V03 引用的运行 `cf9c03cf-e252-439c-b524-bdd281d42c52` 在归档 `profile-live.json`。该文件记录 `createdBookmarks` 10000、`createdFolders` 1000，最终树 `chromeCount` 与 `uiCount` 都是 11004，`equal` true，`mismatchCount` 0。100 条是操作样本：`created`、`changed`、`moved`、`removed` 各 25，没有超时，没有超过 3000 ms。p50 62 ms，p95 245 ms，max 246 ms。这是该次 JSON 里的数字，本检查没有重跑，也没有另造 B10K 计时。当前 `buildB10k` 的 seed 是 `20261010`；这份 JSON 没有 seed 字段。

当前观察，不是一次新的配对安装：

| 路径 | 观察 |
|---|---|
| `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` | 849515 字节，mtime `2026-10-11T09:22:27.9570134Z`，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。与命令日志里的 BEFORE 相同 |
| `%APPDATA%\com.markbridge.desktop` | 3 个文件，最新 `2026-10-11T09:20:16.3460420Z`。与 BEFORE 相同 |
| `%LOCALAPPDATA%\com.markbridge.desktop\EBWebView` | 仍在。461 个文件，最新 `2026-10-12T03:17:48.5775353Z`。`Default\History`、`Default\Preferences`、`Local State` 都在。没有删除 |
| `%LOCALAPPDATA%\Markbridge` | ABSENT |

| 项 | 判定 |
|---|---|
| AC13-1 | UNVERIFIED |
| AC13-2 | FAIL。没有观察到隔离安装并且完成配对 |
| AC13-3 | NOT_RUN |
| AC13-4 | NOT_RUN。安装包路径、长度和 SHA256 已记录。包内文件清单仍缺，hash 不构成 PASS |
| AC13-5 | UNVERIFIED。没有 Floccus 环境 |
| V01 | FAIL |
| V03 | PASS。依据是上面的 10000 条书签和 100 次操作 JSON，不是 100 条书签库 |
| V15 | FAIL。没有本检查亲自观察到的隔离安装配对，脚本输出也不在日志里 |
| V16 | UNVERIFIED。没有 Floccus 环境 |

## 2026-10-12 fmt 与 clippy

`cargo fmt --all -- --check` 退出码 0。
`cargo clippy --workspace --all-targets -- -D warnings` 退出码 0。

V01 仍是 FAIL。没有重跑 `pnpm test` 和 `pnpm build`。这两条仍因 `scripts/foundation.test.mjs` 失败。

## 2026-10-12 去掉参数豁免

`cargo fmt --all -- --check` 退出码 0。
`cargo clippy --workspace --all-targets -- -D warnings` 退出码 0。

V01 仍是 FAIL。没有把 AC13-2 或 V15 标成 PASS。

## 2026-10-12 trellis-check fmt

`cargo fmt --all -- --check` 退出码 0。本次经 `rtk proxy` 重跑，593 ms，没有 diff。
`cargo clippy --workspace --all-targets -- -D warnings` 退出码 0。本次经 `rtk proxy` 重跑。cargo 输出 `Finished dev profile [unoptimized + debuginfo] target(s) in 0.56s`。

Rust 源码没有 `#[allow(clippy::too_many_arguments)]`。`evidence/09-clippy.stderr.log` 仍有旧的 clippy 帮助文字，那不是源码属性。fmt 与 clippy 两行记为 PASS。

V01 仍是 FAIL。AC13-2 仍是 FAIL。V15 仍是 FAIL。V16 仍是 UNVERIFIED。没有改产品源码。

## 2026-10-11 权限断言与 e2e mock

23:55–23:56（-04:00）。只改了权限断言和 e2e mock。没有改旧表里的 FAIL 行，没有勾 PRD。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm test` | 0 | Vitest 99 通过。Node 测试 5 通过、0 失败 |
| `pnpm build` | 0 | 构建完成后 `check-artifacts` 通过。权限为 `bookmarks`、`storage`、`alarms`、`scripting`、`activeTab` |
| `pnpm test:e2e` | 0 | 6 通过、0 失败 |

V01 仍是 FAIL。上表里 `pnpm test`、`pnpm test:e2e`、`pnpm build` 的退出码 1 保留。本次不把 V01 改成 PASS。AC13-2 仍是 FAIL。V15 仍是 FAIL。AC13-3 仍是 NOT_RUN。AC13-4 仍是 NOT_RUN。V16 仍是 UNVERIFIED。

## 2026-10-11 trellis-check 重跑

23:58–23:59（-04:00）。从仓库根重跑四条命令。没有改产品源码，没有勾 PRD。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | PASS。Vitest 99 通过。Node 测试 5 通过、0 失败 |
| `pnpm build` | 0 | PASS。`check-artifacts` 通过 |
| `pnpm test:e2e` | 0 | PASS。6 通过、0 失败 |

这四条是 PASS。历史 V01 FAIL 行保留。这次重跑的四条退出码都是 0，不把历史 V01 改成 PASS。AC13-2 仍是 FAIL。V15 仍是 FAIL。AC13-3 仍是 NOT_RUN。AC13-4 仍是 NOT_RUN。V16 仍是 UNVERIFIED。

## 2026-10-12 安装包文件清单

00:05（-04:00）。没有运行 `pnpm build:package`，没有运行 `tauri build`，没有执行安装程序。

`C:\Program Files\7-Zip\7z.exe` 与 `C:\Program Files (x86)\7-Zip\7z.exe` 都不存在。`where.exe 7z` 退出码 0，解析到 `C:\Users\lyh\scoop\shims\7z.exe`。`scripts/native-package.mjs` 先试这两个路径，都不能执行时再调用 PATH 上的 `7z`。脚本不包含该 scoop 路径。`7z i` 退出码 0。清单和解压使用的命令是 PATH 上的 `7z`。

`7z l` 退出码 0。`7z e` 退出码 0。临时解压目录已删除。

安装包：`target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe`。5589087 字节。SHA256 `3757c2e9d31143b5d773c9cb3b5520d26425e4e927530af8e33a6705ceeb61b3`。长度和 SHA256 与上文 2026-10-11 trellis-check 记录的安装包相同。该节写明未签名、未发布。没有重做签名检查。抽出的 `markbridge-desktop.exe` 在删除临时目录前读到 `FileVersion` 与 `ProductVersion` 都是 `0.1.0`。

`7z l` 输出：

```
7-Zip 26.04 (x64) : Copyright (c) 1999-2026 Igor Pavlov : 2026-10-05

Scanning the drive for archives:
1 file, 5589087 bytes (5459 KiB)

Listing archive: D:\Documents\Code\Tauri\Markbridge\target\release\bundle\nsis\Markbridge_0.1.0_x64-setup.exe

--
Path = D:\Documents\Code\Tauri\Markbridge\target\release\bundle\nsis\Markbridge_0.1.0_x64-setup.exe
Type = Nsis
Physical Size = 5589087
Method = LZMA:23
Solid = +
Headers Size = 73350
Embedded Stub Size = 52736
SubType = NSIS-3 Unicode

   Date      Time    Attr         Size   Compressed  Name
------------------- ----- ------------ ------------  ------------------------
                    .....        12288      5536347  $PLUGINSDIR\System.dll
2025-12-01 10:27:58 .....        26494               $PLUGINSDIR\modern-wizard.bmp
                    .....         9728               $PLUGINSDIR\nsDialogs.dll
                    .....        34304               $PLUGINSDIR\nsis_tauri_utils.dll
                    .....        13316               $PLUGINSDIR\StartMenu.dll
                    .....        15360               $PLUGINSDIR\NSISdl.dll
2026-10-11 23:27:54 .....     23007744               markbridge-desktop.exe
                    .....                            uninstall.exe
------------------- ----- ------------ ------------  ------------------------
2026-10-11 23:27:54           23119234      5536347  8 files
```

抽出的 `markbridge-desktop.exe`：23007744 字节。SHA256 `fdc98cb94ee67815f0bbc457787693c12160c17483506b62a927ed2170088a8b`。`target/release/markbridge-desktop.exe` 长度与 SHA256 相同，字节比较结果为 true。

文件清单缺口已关闭。README 里和升级、用户数据有关的原文是：「升级先生成一致性备份，失败保留旧库；旧版本拒绝读取更高 schema，不通过删除数据库恢复。」以及「源码回退应保留 Trellis、`ref/`、既有文件和用户数据。」原文没有写安装包卸载或升级如何保护用户数据。AC13-4 仍是 NOT_RUN。AC13-2 仍是 FAIL。V15 仍是 FAIL。V16 仍是 UNVERIFIED。没有勾 PRD。

## 2026-10-12 trellis-check 安装包清单

00:09–00:11（-04:00）。没有运行 `pnpm build:package`，没有运行 `tauri build`，没有执行安装程序。没有改 `scripts/native-package.mjs`。

`git diff --numstat -- scripts/native-build.mjs` 没有输出。`inspectNativeArtifact` 和 `--remap-path-prefix` 仍在 `scripts/native-build.mjs`。`scripts/native-package.mjs` 的未提交差异只改 7-Zip 查找。该文件仍调用 `inspectNativeArtifact` 两次，源码不含 `remap-path-prefix`，不含 `scoop`。

候选顺序：`C:\Program Files\7-Zip\7z.exe`，`C:\Program Files (x86)\7-Zip\7z.exe`，然后 PATH 上的 `7z`。这两个 Program Files 路径都不存在。`where.exe 7z` 退出码 0，结果是 `C:\Users\lyh\scoop\shims\7z.exe`。脚本没有写这条 scoop 路径。`7z i` 退出码 0。

从 `const sevenZipCandidates` 到列出安装包之前的源码做了桩调用。三个命令都不能执行时，日志是 `NSIS content list: NOT_RUN; 7-Zip is absent.`。`C:\Program Files\7-Zip\7z.exe` 能执行时，调用停在该路径，没有再试 x86 和 PATH。前两个路径不可访问且 PATH 上的 `7z` 能执行时，顺序是两次 access，然后 `7z` 参数 `i`。桩没有启动打包。

`7z l` 退出码 0。安装包 `target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe` 为 5589087 字节，SHA256 `3757c2e9d31143b5d773c9cb3b5520d26425e4e927530af8e33a6705ceeb61b3`。长度和 SHA256 与给出的值相同。

`7z l` 输出：

```
7-Zip 26.04 (x64) : Copyright (c) 1999-2026 Igor Pavlov : 2026-10-05

Scanning the drive for archives:
1 file, 5589087 bytes (5459 KiB)

Listing archive: D:\Documents\Code\Tauri\Markbridge\target\release\bundle\nsis\Markbridge_0.1.0_x64-setup.exe

--
Path = D:\Documents\Code\Tauri\Markbridge\target\release\bundle\nsis\Markbridge_0.1.0_x64-setup.exe
Type = Nsis
Physical Size = 5589087
Method = LZMA:23
Solid = +
Headers Size = 73350
Embedded Stub Size = 52736
SubType = NSIS-3 Unicode

   Date      Time    Attr         Size   Compressed  Name
------------------- ----- ------------ ------------  ------------------------
                    .....        12288      5536347  $PLUGINSDIR\System.dll
2025-12-01 10:27:58 .....        26494               $PLUGINSDIR\modern-wizard.bmp
                    .....         9728               $PLUGINSDIR\nsDialogs.dll
                    .....        34304               $PLUGINSDIR\nsis_tauri_utils.dll
                    .....        13316               $PLUGINSDIR\StartMenu.dll
                    .....        15360               $PLUGINSDIR\NSISdl.dll
2026-10-11 23:27:54 .....     23007744               markbridge-desktop.exe
                    .....                            uninstall.exe
------------------- ----- ------------ ------------  ------------------------
2026-10-11 23:27:54           23119234      5536347  8 files
```

`7z e` 退出码 0。临时目录 `C:\Users\lyh\AppData\Local\Temp\mb13-check-6dfeef1a9ead40bf838036930b903a6e`。抽出的 `markbridge-desktop.exe` 为 23007744 字节，SHA256 `fdc98cb94ee67815f0bbc457787693c12160c17483506b62a927ed2170088a8b`。`target/release/markbridge-desktop.exe` 长度与 SHA256 相同。字节 `SequenceEqual` 为 true。临时目录已删除，复查不存在。

README 写有：「升级先生成一致性备份，失败保留旧库；旧版本拒绝读取更高 schema，不通过删除数据库恢复。」以及「源码回退应保留 Trellis、`ref/`、既有文件和用户数据。」原文没有写安装包卸载或升级如何保护用户数据。AC13-4 仍是 NOT_RUN。AC13-2 仍是 FAIL。V15 仍是 FAIL。V16 仍是 UNVERIFIED。没有勾 PRD。

## 2026-10-12 V15 隔离运行

04:27–04:28（UTC）。命令 `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/v15-isolated.mjs`，退出码 0。没有重新构建，没有勾 PRD。日志在 `evidence/v15-run.log`，判断在 `evidence/v15-result.json`。

安装包仍是现有的 `target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe`。安装到 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-install`。`MARKBRIDGE_APP_DATA` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-data`，数据库文件名是 `markbridge.sqlite`。`MARKBRIDGE_CREDENTIAL_NAMESPACE` 为 `Markbridge.Task05.mb13-v15-20261012`。`WEBVIEW2_USER_DATA_FOLDER` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-install\webview2`。Chrome 使用 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-chrome`。扩展从 `apps/extension/dist` 经 CDP `Extensions.loadUnpacked` 加载，扩展身份长度为 32。没有使用日常 Chrome 资料，没有加载已安装扩展。

日常书签文件运行前和运行后都是 849515 字节，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。

| 观察 | 判定 | 记录 |
|---|---|---|
| 安装 | PASS | 进程退出码 0 |
| 启动并退出 | PASS | 进程退出码 0。`WM_CLOSE` 已发送 |
| 重启 | NOT_RUN | 没有第二次启动 |
| 卸载 | PASS | 进程退出码 0 |
| 配对到 live | FAIL | 点击了「启动连接」。脚本接着等待「实时同步」30 秒。这个文字要配对完成后才会出现。脚本没有点击「生成配对串」，没有把配对串交给扩展 |
| 一次同步 | NOT_RUN | 没有进入已配对状态 |
| 文本预览 | NOT_RUN | 没有选中书签 |
| 独立预览窗口 | NOT_RUN | 没有点击「打开应用内网页」 |
| 一次确认编辑和回执 | NOT_RUN | 没有确认变更 |
| 重启后不重放未回执写入 | NOT_RUN | 没有制造未回执写入 |
| `cmdkey` | PASS | `Markbridge.Pairing` 与 `Markbridge.Model` 前后都是 0。没有打印或删除既有凭据 |
| 日常 EBWebView | PASS | 运行开始 `2026-10-12T04:27:17.972Z`。结束后 461 个文件，比运行开始新的文件数是 0。最新仍是 `2026-10-12T03:17:48.5775353Z`。这些文件没有删除 |
| AI | NOT_RUN | `where.exe ollama` 退出码 1。没有调用模型 |
| AC13-3 | NOT_RUN | 没有生成 B10K |
| AC13-4 | NOT_RUN | 没有把本次安装写成安装包清单或卸载策略证据 |
| V16 | UNVERIFIED | 没有 Floccus 环境 |

临时 WebView2 目录有 162 个文件。日常 `%LOCALAPPDATA%\com.markbridge.desktop\EBWebView` 没有新文件。卸载后 `HKCU\Software\markbridge\Markbridge` 的默认值是本次临时安装路径，且没有其他值，随后删除了 `HKCU\Software\markbridge`。没有写 `HKLM` 或 `HKCU\Software\Policies`。结束后 `markbridge-desktop` 进程数为 0，命令行含 `mb13-v15-chrome` 的 Chrome 进程数为 0。

AC13-2 为 FAIL。V15 为 FAIL。配对、同步、双预览、编辑和恢复都没有完成。

## 2026-10-12 V15 证据复查

这次复查只读 `v15-isolated.mjs`、`v15-result.json` 和上面的收据。没有重装，没有启动应用或 Chrome。V15 仍是 FAIL。

日常书签前后都是 849515 字节，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`WEBVIEW2_USER_DATA_FOLDER` 设在临时安装目录内的 `webview2`。结果没有「生成配对串」点击。配对是 FAIL。同步、两个预览、编辑和恢复是 NOT_RUN。AC13-2 是 FAIL。AC13-3 与 AC13-4 是 NOT_RUN。V16 是 UNVERIFIED。`Markbridge.Pairing` 与 `Markbridge.Model` 前后都是 0。结果文件没有凭据秘密、令牌或书签标题列表。

## 2026-10-12 V15 启动后窗口文字

04:41（UTC）。命令 `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/v15-bridge-text.mjs`，退出码 0。没有重新构建。没有启动 Chrome，没有加载扩展。没有等待「实时同步」。判断在 `evidence/v15-bridge-result.json`。标准错误在 `evidence/v15-bridge-stderr.log`，0 字节。标准输出同样是 0 字节。

安装包仍是现有的 `target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe`，5589087 字节。安装到 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-bridge-install`，安装进程退出码 0。`MARKBRIDGE_APP_DATA` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-bridge-data`，数据库文件名是 `markbridge.sqlite`。`MARKBRIDGE_CREDENTIAL_NAMESPACE` 为 `Markbridge.Task05.mb13-bridge-text-20261012`。`WEBVIEW2_USER_DATA_FOLDER` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-bridge-install\webview2`。没有安装到 `%LOCALAPPDATA%\Markbridge` 或 `%APPDATA%\com.markbridge.desktop`。

应用 PID 29168。04:41:14.815 点击「启动连接」。04:41:16.364 读到页面文字。窗口标题是 `Markbridge · 签桥`。没有第二个顶层窗口，没有 alert。子窗口文字是 `Markbridge · 签桥` 和 `Chrome Legacy Window`。

状态：`未连接 · 只读`。

监听地址有显示：`127.0.0.1:49153`。

这次读取里「生成配对串」的 `disabled` 为 true。没有点击「生成配对串」。

点击后的 `document.body.innerText`：

```text
跳至内容
Markbridge签桥
未连接 · 只读
Chrome 连接
本机同步
AI 建议
默认关闭

模型只生成可编辑建议。确认前不写书签。密钥只进入系统凭据存储。

启用 AI
提供者
未选择
Ollama
兼容端点
端点
模型
保存配置

未保存密钥 · 尚未测试连接

模型密钥
保存密钥
清除凭据
测试连接
书签
尚未选择来源

在文件夹或书签列表中使用方向键移动。向右展开文件夹，Enter 打开 http 或 https 链接。

尚未接入书签来源。配对 Chrome 或接入只读文件后，可在此浏览。

本机连接
127.0.0.1:49153
端口
连接已启动

默认端口 49153。端口占用时，更换端口后重试。

配对 Chrome 扩展
需在两端确认
资料名称
生成配对串

复制配对串到扩展选项页，再核对下方的扩展身份。配对串有效期为 120 秒。

已配对资料
0 个资料

尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。

只读文件来源
0 个来源
用户数据目录
枚举资料
重新读取

只读取 Local State 的资料名称和所选资料的 Bookmarks 文件。文件来源不能写入 Chrome。

尚未接入只读文件来源。Chrome 关闭后，已接入的最后有效树仍可浏览。

书签保留在 Chrome；标签和备注保留在本机。
```

`WM_CLOSE` 已发送。进程退出码 0。应用标准错误在退出后仍是空的。卸载进程退出码 0。`markbridge-desktop.exe` 和 `uninstall.exe` 已不在临时安装目录。该目录还留着本次创建的 `webview2`。`mb13-v15-bridge-data` 还有 `markbridge.sqlite`，204800 字节。这两个临时目录没有再删。`%LOCALAPPDATA%\Markbridge` 不存在。

卸载后 `HKCU\Software\markbridge\Markbridge` 的默认值是本次临时安装路径，且没有其他值，随后删除了 `HKCU\Software\markbridge`。复查该键不存在。没有写 `HKLM` 或 `HKCU\Software\Policies`。

日常书签运行前和运行后都是 849515 字节，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。

日常 `%LOCALAPPDATA%\com.markbridge.desktop\EBWebView` 运行开始 `2026-10-12T04:41:11.962Z`。结束后 461 个文件，比运行开始新的文件数是 0。最新仍是 `2026-10-12T03:17:48.577Z`。这些文件没有删除。

`cmdkey` 里 `Markbridge.Pairing` 与 `Markbridge.Model` 前后都是 0。本次命名空间的目标数也是 0。没有打印或删除凭据。结束后 `markbridge-desktop` 进程数为 0。

AI 为 NOT_RUN。AC13-3 为 NOT_RUN。AC13-4 为 NOT_RUN。V16 为 UNVERIFIED。AC13-2 为 FAIL。V15 为 FAIL。配对、同步、双预览、编辑和恢复没有跑。

## 2026-10-12 V15 启动门与后续路径

没有重新构建。安装包仍是 `target/release/bundle/nsis/Markbridge_0.1.0_x64-setup.exe`，5589087 字节。没有改产品代码。启动门改为：页面出现 `127.0.0.1:` 加端口，并且「生成配对串」可点。监听文字出现后再等最多 5 秒。不把「实时同步」当作启动门。

04:50（UTC）。命令 `node .trellis/tasks/10-10-mb-13-windows-acceptance/evidence/v15-isolated.mjs`，退出码 0。安装目录 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-startgate-install`。`MARKBRIDGE_APP_DATA` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-startgate-data`，数据库文件名是 `markbridge.sqlite`。`WEBVIEW2_USER_DATA_FOLDER` 为该安装目录下的 `webview2`。`MARKBRIDGE_CREDENTIAL_NAMESPACE` 为 `Markbridge.Task05.mb13-v15-startgate-20261012`。Chrome 用户数据目录为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-chrome-startgate`。扩展从 `apps/extension/dist` 经 CDP `Extensions.loadUnpacked` 加载。原始日志已复制到 `evidence/v15-gate-run.log`，判断在 `evidence/v15-gate-result.json`。

04:50:16 点击「启动连接」。页面显示 `127.0.0.1:49153`，「生成配对串」当时已可点。启动门通过。随后读配对串的循环在按钮被 offer 禁用后继续等按钮，20 秒内没有读到文本框，抛出 `pairing code missing`。配对之后的步骤没有跑。这次的配对判定是 FAIL。同步、文本预览、独立预览窗口、确认编辑、重启不重放都是 NOT_RUN。

04:53–04:54（UTC）。同一脚本改成只点击一次「生成配对串」，然后读取 `#pairing-code`。再次执行，退出码 0。新安装目录 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-cont-install`。`MARKBRIDGE_APP_DATA` 为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-cont-data`。`WEBVIEW2_USER_DATA_FOLDER` 为该安装目录下的 `webview2`。命名空间为 `Markbridge.Task05.mb13-v15-cont-20261012`。Chrome 用户数据目录为 `C:\Users\lyh\AppData\Local\Temp\mb13-v15-chrome-cont`。日志在 `evidence/v15-run.log`，判断在 `evidence/v15-result.json`。没有设置 `Markbridge.Pairing`。没有打印或删除凭据。没有使用日常 Chrome 资料，没有写 `HKLM` 或 `HKCU\Software\Policies`，没有改 `C:\Program Files\Google\Chrome`。

04:53:57 点击「启动连接」。`127.0.0.1:49153` 出现，「生成配对串」可点。随后点击「生成配对串」，配对串长度为 221。点击「确认此扩展」。

| 观察 | 判定 | 记录 |
|---|---|---|
| 安装 | PASS | 进程退出码 0 |
| 启动并退出 | PASS | `WM_CLOSE` 已发送，进程退出码 0 |
| 重启 | NOT_RUN | 编辑回执未通过，脚本没有进入第二次启动 |
| 卸载 | PASS | 进程退出码 0 |
| 配对到 live | PASS | 点击了真实的「启动连接」和「生成配对串」，确认扩展后状态含「实时同步」 |
| 一次同步 | PASS | 选中 `mb13-v15-example`。指标含「缓存节点」4、「来源版本」1，最近同步不是「尚未同步」 |
| 文本预览 | PASS | 内容预览含 `Example Domain` |
| 独立预览窗口 | PASS | 点击「打开应用内网页」。窗口标题含「网页预览」 |
| 一次确认编辑和回执 | FAIL | 「预览修改」和「确认变更」都点到了。Chrome 有 1 条改后标题，网址仍是 `https://example.com/`。SQLite 一行 `applied` / `update`，回执列为 1。20 秒内页面没有「回执已确认」 |
| 重启后不重放未回执写入 | NOT_RUN | 没有制造未回执写入 |
| `cmdkey` | PASS | `Markbridge.Pairing` 与 `Markbridge.Model` 前后都是 0 |
| 日常 EBWebView | PASS | 运行开始 `2026-10-12T04:53:50.854Z`。结束后 461 个文件，比运行开始新的文件数是 0。最新仍是 `2026-10-12T03:17:48.5775353Z`。这些文件没有删除 |
| AI | NOT_RUN | `where.exe ollama` 退出码 1 |
| AC13-3 | NOT_RUN | 没有生成 B10K |
| AC13-4 | NOT_RUN | 没有把本次安装写成安装包清单或卸载策略 |
| V16 | UNVERIFIED | 没有 Floccus 环境 |

日常书签运行前和运行后都是 849515 字节，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。

AC13-2 为 FAIL。V15 为 FAIL。编辑回执的页面文字和重启不重放没有通过。

## 2026-10-12 trellis-check V15 结果

这次复查没有重装，没有启动安装程序、应用或 Chrome，没有删除 EBWebView，没有改 `v15-isolated.mjs`，没有勾 PRD。`git diff --name-only -- apps crates packages scripts` 没有输出。产品文件没有改动。

`waitBridgeStarted` 要求页面出现 `127.0.0.1:` 加端口，并且「生成配对串」可点。`driveHappy` 在读取配对串之前调用它。`v15-result.json` 先记下 `listener 127.0.0.1:49153` 和 `pair button enabled`，然后才是「生成配对串」点击。

日常书签前后都是 849515 字节，SHA256 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。`v15-result.json` 中配对、同步、文本预览、独立预览窗口是 PASS。编辑回执是 FAIL。重启是 NOT_RUN。AC13-2 是 FAIL。更早的 `v15-gate-result.json` 仍是配对 FAIL，其后步骤是 NOT_RUN。V15 仍是 FAIL。

`v15-result.json`、`v15-gate-result.json`、`v15-bridge-result.json` 和本收据没有配对串、凭据、令牌或带秘密的书签网址。配对串只记了字符数 221。

