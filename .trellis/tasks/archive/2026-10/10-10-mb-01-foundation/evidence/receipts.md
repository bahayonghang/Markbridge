# 01 基础实现检查收据

日期：2026-10-10，America/New_York。检查区间约 23:21–23:32 -04:00。代码状态：main 工作树未提交；新建基础 workspace、桌面/扩展/协议、测试、CI 和 README。没有提交、归档、发布、日常安装或真实 Chrome 书签操作。

环境、批准记录、bootstrap 前置验收和原生 UI 工具失败见 [session-preflight.md](session-preflight.md)。原生进程启动及受控终止见 [native-process.md](native-process.md)。Node 26.7.0、pnpm 12.12.0、Rust/Cargo 1.99.0；Tauri 2.12.3、tauri-build 2.7.2。Chrome for Testing 156.0.8078.4，Playwright 1.64.0。浏览器使用 Playwright 的隔离临时上下文，没有使用日常 Chrome Profile。

原始命令输出及首次失败摘要保存在 [check-output.txt](check-output.txt)。完整临时运行输出在被忽略的 `runs/foundation/`，正式收据保留所需错误和重测结果。

独立 Trellis check 结果、原始 release 路径泄漏及修复后原生产物验证见 [check-review.md](check-review.md)。原检查区间之后补充的结果在该文件分别记录。

## 命令结果

| 检查 | 退出码 | 状态 | 证据 |
|---|---:|---|---|
| `python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-10-mb-01-foundation` | 0 | PASS | implement/check 清单引用有效；批准/start 由主会话记录 |
| `pnpm install` | 0 | PASS | 4 个 workspace、214 个包；生成 pnpm-lock.yaml |
| `cargo generate-lockfile` | 0 | PASS | 408 个 Rust 包；保持 Tauri 2，未采用搜索结果中的 3.0 alpha |
| `pnpm protocol:generate` | 0 | PASS | Rust serde/schemars 生成 draft 2020-12 schema，再生成 TS |
| `pnpm lint` 首次 / 重测 | 1 / 0 | PASS | 首次误扫 `.omp` harness；入口改为产品/测试/配置路径 |
| `pnpm typecheck` 首次 / 重测 | 1 / 0 | PASS | 首次缺失 jest-dom Vitest 类型；桌面 tsconfig 加载该类型 |
| `pnpm test` 首次 / 重测 | 1 / 0 | PASS | 首次 Ajv 拒绝未知 uint8 format；显式注册整数 0–255 校验，未关闭 strict |
| `pnpm test` 最终行为结果 | 0 | PASS | Vitest 12 项；Node 4 项，含原生扫描反例；无跳过项 |
| `pnpm build` | 0 | PASS | 桌面和 MV3 扩展生产构建、协议消费者类型检查、产物扫描 |
| `pnpm protocol:check` | 0 | PASS | 已跟踪生成结果无漂移 |
| `cargo fmt --all -- --check` | 0 | PASS | Rust 格式检查 |
| `cargo clippy --workspace --all-targets -- -D warnings` 首次 / 重测 | 101 / 0 | PASS | 首次缺少 icon.ico；添加所需 PNG/ICO 资源后通过 |
| `cargo test --workspace --locked` | 0 | PASS | 2 项 Rust 行为测试；其余测试目标为 0，未虚构原生测试 |
| `pnpm install --frozen-lockfile` | 0 | PASS | 根目录锁文件安装通过 |
| `pnpm --dir runs/foundation/clean-install install --frozen-lockfile` | 0 | PASS | 隔离目录首次没有 node_modules，仅复制根/3 包 manifests、workspace 配置和锁文件；从 store 重建 214 包 |
| `pnpm exec playwright install chromium` | 0 | PASS | 下载专用测试浏览器；不代表 Chrome 扩展已安装 |
| `pnpm test:e2e` | 0 | PASS | 2 项浏览器测试；1100×760 和 640×480；空态、只读、无动作按钮、键盘焦点、无水平溢出 |
| 托管 Windows CI | — | NOT_RUN | workflow 已创建，尚未提交或触发远程执行 |
| 原生打开/关闭两次、空态/尺寸/错误/退出交互 | 0 | PASS | 2026-10-10 当时 UNVERIFIED。2026-10-11 首次错误展示 FAIL；同日重测四项 PASS，见文末「2026-10-11 原生窗口重测」 |
| 原生开发进程启动 | 受控终止 -1 | PASS | 编译后创建有标题窗口且 Responding；未验证页面和正常关闭，详见 native-process.md |
| `pnpm build:native` | 0 | PASS | release EXE 构建及 UTF-8/UTF-16 路径/秘密模式扫描；首次泄漏及修复见 check-review.md；不生成安装包 |
| Chrome 原生扩展加载/同步、外部同步、macOS/Linux | — | NOT_RUN | 不属于 01 的产物检查结论 |

首次 E2E 退出 0，但 `NO_COLOR` 和 Playwright 的 `FORCE_COLOR` 同时存在，Node 发出颜色环境提示。只在重测 shell 移除 `NO_COLOR`，重测退出 0 且无该提示；没有修改应用颜色策略或全局环境。

## Fixture 和反例

唯一 IPC fixture 为 `tests/fixtures/protocol/startup-state.json`：`{"protocolVersion":1,"state":"unpaired"}`，2 个字段，不包含身份、凭据、书签或路径。Rust 测试检查 fixture 往返及额外字段拒绝。Ajv 测试覆盖正常输入、null、缺字段、版本不兼容、未知状态、未知字段、字符串版本、负数、小数和超过 uint8 的版本。

`scripts/protocol.test.mjs` 在 OS 临时目录写入实际生成结果，先确认一致，再分别修改 TypeScript 和 schema。两种修改都触发与 CLI 相同的 `checkProtocol` 漂移检查并拒绝。测试 finally 清理自己创建的临时目录，未改写已跟踪生成文件。

桌面组件测试覆盖真实加载分支的成功和失败状态。失败状态显示固定提示，测试确认原始后台错误未呈现。该组件测试不代表原生 IPC 错误已人工验收。

MV3 manifest 和 main capability 测试检查权限边界。扩展没有 permissions、host_permissions、background、content_scripts 或 externally_connectable。主窗口 capability 仅匹配 main，无 remote 字段。生产产物扫描拒绝 source map、绝对 Windows 用户/文档路径、私钥头和常见密钥模式。模式扫描未证明任意形式的秘密均不存在；基础源码没有读取密钥或 `.env`。

## 浏览器截图

- [1100×760 空态](browser-empty-1100x760.png)
- [640×480 空态](browser-empty-640x480.png)

两张截图均经读取查看。文字可读，空态没有伪造资料或尚未实现的操作按钮；最小高度可通过滚动访问底部说明。截图来自 Chromium 浏览器，不能用作 Tauri/WebView2 原生截图。

## 验收映射

| 标准 | 状态 | 范围 |
|---|---|---|
| AC01-1 | PASS | 依赖锁文件、隔离 JS 重建、build 和 Rust gates；非全新 Windows 机器验收 |
| AC01-2 | PASS | 合法 MV3 生产产物通过。2026-10-11 首次错误展示 FAIL；同日重测四项 PASS，见文末「2026-10-11 原生窗口重测」 |
| AC01-3 | PASS | README 记录实际版本、Windows 前置条件、命令与证据边界 |
| AC01-4 | PASS | 生成漂移反例、Web 资产扫描及修复后的原生 release EXE 扫描通过；模式扫描边界见独立检查 |
| V01 本地自动检查 | PASS | 上表命令退出 0；首次失败及修复路径均保留 |
| 01 完成门槛 | PASS | 独立 check 已执行；2026-10-11 重测四项原生 PASS。任务未归档，status 仍为 in_progress |

## 回退与后续

按当前 diff 只回退 01 新建的产品源码/配置和相应 `.gitignore` 增量；保留既有 Trellis、ref 和用户改动。没有真实数据库、凭据、浏览器写入或安装状态需要回滚。独立 Trellis check 已审核和修复已证实的产物问题，主会话记录原生进程与 UI 验收边界。

## 2026-10-11 原生窗口

可执行文件：`D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe`，14296576 字节，2026-10-11 10:40。未安装到日常环境。`MARKBRIDGE_APP_DATA` 使用 `%TEMP%` 下的临时绝对目录，路径不含 `com.markbridge.desktop`。凭据命名空间为 `Markbridge.Task05.mb01-native`。正常关闭是 `PostMessage` `WM_CLOSE`（0x0010）。空态与尺寸位图来自 `PrintWindow` flag 2；采集进程先调用 `SetProcessDpiAwarenessContext(-4)`。四张主文件名空态图在同一次采集后由对应 `.print.png` 覆盖。`native-empty-*-scroll.png` 与 `native-close-2.png` 来自更早的 DPI 无关采集，不计入下面四项。

### 1. 空态 PASS

命令：

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\capture-empty.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-foundation-observe7 -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Port 9337
```

PID 61208。脚本退出码 0。应用在 `WM_CLOSE_POSTED=True` 后退出码 0。临时库为当次新建，未配对。

- [native-empty-1100x760.png](native-empty-1100x760.png) 与 [native-empty-640x480.png](native-empty-640x480.png) 顶部可读「未连接 · 只读」。
- [native-empty-1100x760-source.png](native-empty-1100x760-source.png) 与 [native-empty-640x480-source.png](native-empty-640x480-source.png) 可读「尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。」以及「0 个资料」。
- 两张资料区位图没有资料卡片，没有配对码。「生成配对串」为灰色禁用。

### 2. 尺寸 PASS

同一命令、同一 PID 61208。客户区由 DPI 感知的 `SetWindowPos` 设成目标尺寸。脚本退出码 0，应用退出码 0。

| 客户区 | 外框 | 位图像素 |
|---|---|---|
| 1100×760 | 1118×807 | 1118×807 |
| 640×480 | 658×527 | 658×527 |

记录行：`SET_1100x760 CLIENT=1100x760 OUTER=1118x807`，`SET_640x480 CLIENT=640x480 OUTER=658x527`。当时 CSS `innerWidth` 分别为 880 与 512，`devicePixelRatio` 为 1.25。

### 3. 错误展示 FAIL

临时库执行 `PRAGMA user_version=999` 后启动同一 release 可执行文件。生产监听器没有测试开关。

命令：

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\probe-startup-error.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-foundation-error-frames -OutPng .trellis\tasks\10-10-mb-01-foundation\evidence\native-startup-error.png -Mode newer-schema
```

PID 53852。脚本退出码 0。应用退出码 101。

[native-startup-error-0.png](native-startup-error-0.png) 为 1393×997。标题栏是「Markbridge · 签桥」，客户区为空白。窗口里没有「无法读取启动状态」。stderr 为 `Failed to setup app: error encountered during setup hook: STORAGE_NEWER_SCHEMA`，这段文字不在窗口位图里。

另外两条已有失败路径同样没有画出该句：

| 模式 | 数据目录 | PID | 脚本退出码 | 应用退出码 | stderr |
|---|---|---:|---:|---:|---|
| not-database | `%TEMP%\mb01-foundation-error-not-database` | 60952 | 0 | 101 | `STORAGE_ERROR` |
| exclusive-lock | `%TEMP%\mb01-foundation-error-exclusive-lock` | 32804 | 0 | 101 | `STORAGE_ERROR` |

### 4. 两次正常关闭 PASS

两次独立启动。每次向窗口发送 `WM_CLOSE`，进程退出码都是 0。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-foundation-empty-a -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode sizes
```

PID 45800。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-foundation-empty-b -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode close
```

PID 60472。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。

空态采集的 PID 61208 也在 `WM_CLOSE` 后以应用退出码 0、脚本退出码 0 结束。

### 日常书签与凭据

启动前、全部运行后，以及写入本节前，四份 Bookmarks 的长度和 SHA256 相同。未打印书签正文。

| 路径 | 长度 | SHA256 |
|---|---:|---|
| `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` | 849515 | `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `...\Snapshots\136.0.7103.114\Default\Bookmarks` | 779083 | `A1C5F8B2649B36A2FFE91F6E364319EC9345D8763CBD41DFCE3DB4D4ECCA1E1C` |
| `...\Snapshots\137.0.7151.120\Default\Bookmarks` | 782259 | `337959835367255FC191B76737E9886245C53C0FE71CB3AC97E7C198E1B037CF` |
| `...\Snapshots\138.0.7204.184\Default\Bookmarks` | 800477 | `A03B31B8F0ACED1C766EF1050126CD09E4F0EF4AC28468CDF186B5AAE8B7A7AE` |

`cmdkey` 里 Markbridge 目标计数为 1。目标行 SHA256 前后都是 `230EF2BA93307BCAC60E2C53E6807B643FD00AFFBA680131DFAACFA0DCC27F5E`。`Markbridge.Pairing` 不存在。`Markbridge.Model` 不存在。

`C:\Users\lyh\AppData\Roaming\com.markbridge.desktop` 仍在。`markbridge.sqlite` 143360 字节，`markbridge.sqlite-shm` 32768 字节，`markbridge.sqlite-wal` 0 字节。没有残留 `markbridge-desktop` 进程。

### AC01-2

空态 PASS，尺寸 PASS，错误展示 FAIL，两次关闭 PASS。四项未全部 PASS，AC01-2 保持 UNVERIFIED。`prd.md` 的 AC01-2 勾选未改。任务保持 in_progress。未提交。

## 2026-10-11 原生窗口重测

证据二进制来自 `pnpm build:native`（`tauri build --no-bundle -- --locked`，启用 `custom-protocol`）。`target\release\markbridge-desktop.exe` 为 21068800 字节，SHA256 `e94533c5ac133c1629c7ad120baea74b6fe412af078ce2d2839ca7f2ef28dd23`，写入时间 2026-10-11 19:13。未安装到日常环境。

同一次未加 `custom-protocol` 的 `cargo build --release` 会让窗口连接 `127.0.0.1:1420`。那个二进制不计入下面四项。

`MARKBRIDGE_APP_DATA` 使用 `%TEMP%` 下的临时绝对目录，路径不含 `com.markbridge.desktop`。凭据命名空间为 `Markbridge.Task05.mb01-native`。关闭是 `PostMessage` `WM_CLOSE`（0x0010）。位图来自 `PrintWindow` flag 2；采集进程先调用 `SetProcessDpiAwarenessContext(-4)`。没有点击「生成配对串」或「确认此扩展」。

`cargo test -p markbridge-desktop --bin markbridge-desktop storage_open_failure_does_not_return_the_open_error` 退出码 0，1 项通过。

### 1. 空态 PASS

命令：

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\capture-empty.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r2-empty -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Port 9338 -ShotStem native-r2-empty
```

PID 60456。脚本退出码 0。应用退出码 0。`WM_CLOSE_POSTED=True`。临时库为当次新建。

- [native-r2-empty-1100x760.png](native-r2-empty-1100x760.png) 与 [native-r2-empty-640x480.png](native-r2-empty-640x480.png) 可读「未连接 · 只读」。
- [native-r2-empty-1100x760-source.png](native-r2-empty-1100x760-source.png) 与 [native-r2-empty-640x480-source.png](native-r2-empty-640x480-source.png) 可读「尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。」以及「0 个资料」。
- 没有资料卡片，没有配对码。「生成配对串」为灰色禁用。

### 2. 尺寸 PASS

同一命令、同一 PID 60456。脚本退出码 0。应用退出码 0。

| 客户区 | 外框 | 位图像素 |
|---|---|---|
| 1100×760 | 1118×807 | 1118×807 |
| 640×480 | 658×527 | 658×527 |

记录行：`SET_1100x760 CLIENT=1100x760 OUTER=1118x807`，`SET_640x480 CLIENT=640x480 OUTER=658x527`。当时 CSS `innerWidth` 分别为 880 与 512，`devicePixelRatio` 为 1.25。

### 3. 错误展示 PASS

临时库执行 `PRAGMA user_version=999` 后启动同一 release 可执行文件。没有为这条提示新增环境变量、命令或监听开关。

命令：

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\probe-startup-error.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r2-error-schema2 -OutPng .trellis\tasks\10-10-mb-01-foundation\evidence\native-r2-startup-error.png -Mode newer-schema
```

PID 55504。脚本退出码 0。应用退出码 0。stderr 为空。`WM_CLOSE_POSTED=True`，发送发生在截取之后。

[native-r2-startup-error.png](native-r2-startup-error.png) 为 1118×807，客户区 1100×760。标题栏是「Markbridge · 签桥」。页内有「启动失败」和「无法读取启动状态」，以及「请关闭窗口后重新打开应用。」窗口里没有 `STORAGE_NEWER_SCHEMA`、`STORAGE_ERROR`、sqlite 文本、文件路径或打开错误原文。

### 4. 两次正常关闭 PASS

两次独立的新建库。每次向窗口发送 `WM_CLOSE`，进程退出码都是 0。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r2-close-a -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode close -Namespace Markbridge.Task05.mb01-native -ShotStem native-r2-close-a
```

PID 60212。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。[native-r2-close-a.png](native-r2-close-a.png) 为 1118×807，客户区 1100×760，状态为「未连接 · 只读」。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r2-close-b -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode close -Namespace Markbridge.Task05.mb01-native -ShotStem native-r2-close-b
```

PID 57468。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。[native-r2-close-b.png](native-r2-close-b.png) 为 1118×807。

空态采集的 PID 60456 也在 `WM_CLOSE` 后以应用退出码 0、脚本退出码 0 结束。

### 日常书签与凭据

本轮启动前和全部运行后，四份 Bookmarks 的长度和 SHA256 相同。未打印书签正文。`AppliedDPI` 前后都是 120，没有修改系统 DPI。

| 路径 | 长度 | SHA256 |
|---|---:|---|
| `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` | 849515 | `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82` |
| `...\Snapshots\136.0.7103.114\Default\Bookmarks` | 779083 | `A1C5F8B2649B36A2FFE91F6E364319EC9345D8763CBD41DFCE3DB4D4ECCA1E1C` |
| `...\Snapshots\137.0.7151.120\Default\Bookmarks` | 782259 | `337959835367255FC191B76737E9886245C53C0FE71CB3AC97E7C198E1B037CF` |
| `...\Snapshots\138.0.7204.184\Default\Bookmarks` | 800477 | `A03B31B8F0ACED1C766EF1050126CD09E4F0EF4AC28468CDF186B5AAE8B7A7AE` |

`cmdkey` 里 Markbridge 目标计数为 1。本轮按那些行的 UTF-8 文本计算的 SHA256 前后都是 `4D4588C487A165AE5424878A861D6D9CE80093C8DBAD9B08AAA59EE0C0AF7D6D`。没有打印目标行。`Markbridge.Pairing` 不存在。`Markbridge.Model` 不存在。

`C:\Users\lyh\AppData\Roaming\com.markbridge.desktop` 仍在。`markbridge.sqlite` 143360 字节，`markbridge.sqlite-shm` 32768 字节，`markbridge.sqlite-wal` 0 字节。没有残留 `markbridge-desktop` 进程。

### AC01-2

空态 PASS，尺寸 PASS，错误展示 PASS，两次关闭 PASS。`prd.md` 的 AC01-2 已勾选。任务未归档，status 仍为 in_progress。未提交。

## 2026-10-11 原生窗口复查

复查使用既有 `target\release\markbridge-desktop.exe`。复查前和全部运行后，长度都是 21068800，SHA256 都是 `e94533c5ac133c1629c7ad120baea74b6fe412af078ce2d2839ca7f2ef28dd23`。没有重新构建。完成时间 2026-10-11 19:21 -04:00。

`MARKBRIDGE_APP_DATA` 使用 `%TEMP%` 下的新建绝对目录，路径不含 `com.markbridge.desktop`。凭据命名空间为 `Markbridge.Task05.mb01-native`。关闭是脚本内的 `PostMessage` `WM_CLOSE`（0x0010）。没有点击「生成配对串」或「确认此扩展」。位图判断来自本次读图，不沿用上一节文字。先前的 [native-r2-startup-error.png](native-r2-startup-error.png) 也显示同一句固定提示；下面的结论以新位图为准。上文「错误展示 FAIL」未删除。

### 1. 空态 PASS

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\capture-empty.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r3-empty -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Port 9341 -ShotStem native-r3-empty
```

PID 33228。脚本退出码 0。应用退出码 0。`WM_CLOSE_POSTED=True`。

- [native-r3-empty-1100x760.png](native-r3-empty-1100x760.png) 与 [native-r3-empty-640x480.png](native-r3-empty-640x480.png) 可见「未连接 · 只读」。
- [native-r3-empty-1100x760-source.png](native-r3-empty-1100x760-source.png) 与 [native-r3-empty-640x480-source.png](native-r3-empty-640x480-source.png) 可见「尚未连接书签来源。完成配对后，可在此查看同步状态和节点计数。」以及「0 个资料」。
- 四张图都没有资料卡片，也没有配对码。1100 来源图里「生成配对串」为灰色禁用。

### 2. 尺寸 PASS

同一命令、同一 PID 33228。脚本退出码 0。应用退出码 0。客户区来自该脚本在 DPI 感知进程中的 `GetClientRect`。

| 客户区 | 外框 | 位图像素 |
|---|---|---|
| 1100×760 | 1118×807 | 1118×807 |
| 640×480 | 658×527 | 658×527 |

记录行：`SET_1100x760 CLIENT=1100x760 OUTER=1118x807`，`SET_640x480 CLIENT=640x480 OUTER=658x527`。当时 CSS `innerWidth` 分别为 880 与 512，`devicePixelRatio` 为 1.25。

### 3. 错误展示 PASS

临时库执行 `PRAGMA user_version=999` 后启动同一 release 可执行文件。没有新增环境变量、命令或监听开关。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\probe-startup-error.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r3-error -OutPng .trellis\tasks\10-10-mb-01-foundation\evidence\native-r3-startup-error.png -Mode newer-schema
```

PID 59976。脚本退出码 0。应用退出码 0。输出没有 `STDERR` 行。`WM_CLOSE_POSTED=True`，发送发生在截取之后。

[native-r3-startup-error-0.png](native-r3-startup-error-0.png) 至 `native-r3-startup-error-12.png` 共 13 张。每张都是 1118×807，客户区 1100×760，SHA256 都是 `9eed4cd1064d6b231a70297b765dc166a60ca177a406b7cd35699106cdba05eb`。已读第 0、6、12 张，画面相同。标题栏是「Markbridge · 签桥」。页内有「启动失败」「无法读取启动状态」和「请关闭窗口后重新打开应用。」窗口里没有 `STORAGE_NEWER_SCHEMA`、`STORAGE_ERROR`、sqlite 文本、文件路径或打开错误原文。界面不依赖 stderr。

### 4. 两次正常关闭 PASS

两次独立的新建库。每次由脚本发送 `WM_CLOSE`，进程退出码都是 0。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r3-close-a -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode close -Namespace Markbridge.Task05.mb01-native -ShotStem native-r3-close-a
```

PID 60896。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。[native-r3-close-a.png](native-r3-close-a.png) 为 1118×807，客户区 1100×760，可见「未连接 · 只读」。

```text
pwsh -NoProfile -File .trellis\tasks\10-10-mb-01-foundation\evidence\native-session.ps1 -Exe D:\Documents\Code\Tauri\Markbridge\target\release\markbridge-desktop.exe -AppData $env:TEMP\mb01-r3-close-b -OutDir .trellis\tasks\10-10-mb-01-foundation\evidence -Mode close -Namespace Markbridge.Task05.mb01-native -ShotStem native-r3-close-b
```

PID 44840。`WM_CLOSE_POSTED=True`。脚本退出码 0。应用退出码 0。[native-r3-close-b.png](native-r3-close-b.png) 为 1118×807，客户区 1100×760，可见「未连接 · 只读」。没有残留 `markbridge-desktop` 进程。

### 单元测试

指定命令把 `--exact` 放在 `--` 之后。libtest 的精确名是 `tests::storage_open_failure_does_not_return_the_open_error`，短过滤器对不上。

```text
cargo test -p markbridge-desktop --bin markbridge-desktop storage_open_failure_does_not_return_the_open_error -- --exact
```

退出码 0。结果是 0 passed、12 filtered。这次没有执行断言。

```text
cargo test -p markbridge-desktop --bin markbridge-desktop tests::storage_open_failure_does_not_return_the_open_error -- --exact
```

退出码 0。1 passed。该测试只检查静态字符串 `STARTUP_UNAVAILABLE`，不代替上面的原生探针。

### 日常书签与凭据

复查前和全部运行后，Default Bookmarks 的长度都是 849515，SHA256 都是 `DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82`。三份 Snapshot Bookmarks 的长度和 SHA256 也与上一节相同。未打印书签正文。`AppliedDPI` 前后都是 120。

`cmdkey` 里 Markbridge 目标计数前后都是 1。那些行的 UTF-8 SHA256 前后都是 `4D4588C487A165AE5424878A861D6D9CE80093C8DBAD9B08AAA59EE0C0AF7D6D`。没有打印目标行。`Markbridge.Pairing` 不存在。`Markbridge.Model` 不存在。

`C:\Users\lyh\AppData\Roaming\com.markbridge.desktop` 仍在。`markbridge.sqlite` 143360 字节，`markbridge.sqlite-shm` 32768 字节，`markbridge.sqlite-wal` 0 字节。

### AC01-2

空态 PASS，尺寸 PASS，错误展示 PASS，两次关闭 PASS。`prd.md` 的 AC01-2 保持勾选。任务未归档，status 仍为 in_progress。未提交。
