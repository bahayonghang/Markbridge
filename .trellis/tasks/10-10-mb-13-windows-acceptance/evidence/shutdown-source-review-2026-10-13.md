# 13 关闭失败：只读源码审查与临时诊断

本记录不构建安装包、不运行 GUI、不修改任务状态。真实进程、关闭消息、hash 和退出结果由主会话及当前 harness 留证。

## 已核对的源码

- 手动 main 与 Tauri 自动创建都调用 `WebviewWindowBuilder::from_config(...).build()`。`WindowConfig.create=false` 只抑制 SDK `app::setup` 自动创建循环；Wry 的退出依据实际 `WindowsStore`，没有按该字段改变退出行为。
- 产品没有 `prevent_exit` 或 main `CloseRequested` 拦截。`main::on_run_event` 仅在 `RunEvent::Exit` 同步等待 `Bridge::shutdown`，没有在 `ExitRequested` 阻止退出。
- `Bridge::shutdown` 等待顺序：lifecycle 锁、三个取消 gate、停止 watcher、断开 Profile/停止 listener、取出 Storage 并 `close`。`Storage::close` 丢弃自身 sender 后等 worker 的 finished oneshot；worker 只有全部 sender 释放且队列排空后退出。若仍有共享 sender，这里可能等待，但不能仅据此判定本次就是该问题。
- 全新空库的 open 路径没有 listener、watcher 或持续持有的共享 Storage sender。设置页初始状态订阅只保留 Bridge watch receiver 与 AppHandle。Tauri 异步运行时是静态 OnceLock；不能把后台线程数量或全局 runtime 自动 Drop 当成已证实原因。
- SDK `tauri-runtime-wry 2.12.1 src/lib.rs:4256` 在最后 Window destroyed 后发 ExitRequested；`tauri 2.12.3 src/app.rs:1449` 先执行用户 Exit callback，再 cleanup。因此已收到 Exit 时，产品关闭等待与 SDK cleanup 可以分开定位。

## 已丢弃的假设

初始“仅早期 guard 失败时的 WM_CLOSE 打断 WebView 构建”有 SDK 的 `wait_with_pump` 源码依据：Wry 0.57 环境/控制器创建同步泵消息，构建完成前还没有注册完整 WindowWrapper。`webview2-com 0.39.1 src/lib.rs:60` 仅在收到回调或 WM_QUIT 后返回，无内部超时。

但主会话随后记录了 `current-startup-829cc45a-8c9d-4fc7-a53c-52fc14451277-receipt.json`：OS 临时目录正确且 launchInstalled 已等 DOM 书签 heading，仍发生正常关闭失败。该证据否定“只发生于早期 guard”的判断，已明确丢弃，未基于它更改产品退出行为。DOM heading 本身仍不是 Tauri RunEvent::Ready 的证明，需要阶段标记核对。

## 临时标记合同

主会话授权仅在 `main.rs` 添加临时诊断：同时要求 `MARKBRIDGE_NATIVE_PROBE=1` 与绝对 `MARKBRIDGE_APP_DATA`，后者必须是系统 temp 的直接子目录 `markbridge-task13-native-<ASCII suffix>/app-data`。只输出 stderr 固定 `TASK13_NATIVE_STAGE:<CODE>`；无路径、身份、标题、正文、密钥或动态错误。默认不输出。

阶段：ENTRY、CONFIG_ACCEPTED、TAURI_BUILD_RETURNED、SETUP_ENTER、SERVICES_READY、MAIN_BUILD_BEGIN、MAIN_BUILD_RETURNED、SETUP_COMPLETED、RUN_READY、RUN_EXIT_REQUESTED、RUN_EXIT、BRIDGE_SHUTDOWN_BEGIN、BRIDGE_SHUTDOWN_END。

调用顺序与关闭结果保持原样，未加入超时、强制退出或新的 IPC。根会话按正式 remap/扫描入口构建测试 exe，harness 排空 stderr 并只保留上述固定码，等待 RUN_READY 后再正常关闭。若未发 RUN_EXIT，检查 SDK 窗口关闭/销毁事件；若停在 BRIDGE_SHUTDOWN_BEGIN，再为明确的 core 等待点采集证据，不能先猜测修改。

采集结束须移除临时标记、guard 与诊断测试，再构建正式最终产物；诊断 exe 的结果不能冒充最终 hash 的重测。

## 本地检查

新增纯 guard 测试的首次 compile 失败为未在测试 module 中限定 `PathBuf`，已修正为 `std::path::PathBuf`。修正后 `cargo test -p markbridge-desktop --locked` 22 PASS、退出 0；`cargo clippy -p markbridge-desktop --all-targets --locked -- -D warnings`、`cargo fmt --all -- --check` 与 `git diff --check` 均退出 0。没有原生 GUI 测试结果。

## 实际阶段进一步收窄

`current-startup-4eab32c3-e67e-4187-8c1a-167bd94c91b3-receipt.json` 实际包含完整 setup/MAIN_BUILD_RETURNED/RUN_READY，随后 RUN_EXIT_REQUESTED，**没有 RUN_EXIT 或 BRIDGE_SHUTDOWN_BEGIN**。因此该运行没有进入 Bridge/Storage 关闭，禁止据此增加 Storage 超时或强制退出。主会话与独立 checker 均核对了同一结果。

主会话发现首次 helper 对 main 和 role=other 的两个 owned 窗口发了 WM_CLOSE。现有 helper 的 `visible || role != other` 条件并不等于用户窗口：实际安装的 Tao 0.37.1 `src/platform_impl/windows/event_loop.rs:629` 创建无标题、零尺寸、layered/tool 的 `Tao Thread Event Target` 顶层窗口，在约 683–689 行显式设 `WS_VISIBLE | WS_POPUP`，注释说明它必须可见才能收 WM_PAINT，却不会呈现给用户。

同 SDK `run_return:271` 只有 ControlFlow::Exit 且 `!runner.handling_events()` 才退出；内部 target 的 WM_PAINT handler 调用 redraw_events_cleared 来结束该状态。关闭这个内部 target 可以留下 ExitRequested 而没有 LoopDestroyed/Exit。源码已支持 helper 误关框架窗口这一具体候选；本次 other 窗口还需 className 观察和 exact-main/preview-only 对照运行证明，暂不声明实际根因已最终确认。修正 helper 由 harness 负责，产品退出逻辑不改。

## 同一二进制的对照结果与诊断移除

诊断 exe SHA256 为 `1a93d343c2736c059c396e4f5807a7eaf7428b4d0591f2d6bdf3696d0515895d`。失败运行 `current-startup-4eab32c3-e67e-4187-8c1a-167bd94c91b3-receipt.json` 首次发两个 WM_CLOSE（main 与 visible other），停在 RUN_EXIT_REQUESTED；失败记录保留。

相同 exe 的 `current-startup-3ee19ba4-383d-48e9-ad1c-43785ed4e360-receipt.json` 改为只关闭已知 main/preview，实际仅发一个 main WM_CLOSE，空标题的 visible other 保留。结果 PASS：13 个阶段全部出现，包括 RUN_EXIT、BRIDGE_SHUTDOWN_BEGIN/END；进程退出码 0、signal null、已观察 WebView PID 消失，最终 fixture 进程及监听均为空。OS 实际目录仍在临时 `app-data/main-webview/EBWebView`。因此关闭失败归因于过宽的验收关闭目标，不修改产品 shutdown、Storage 或退出超时。other 的输出 class 仍为 UNREPORTED_CLASS；SDK 源码说明为何它不能按可见性关闭，对照运行直接证明修正关闭选择即可恢复退出。

对照证据是诊断二进制的实际运行，不能冒充最终移除标记后的安装产物验收。采集后已从 `main.rs` 完整删除 `native_probe_stage`、目录 guard、环境变量引用、所有阶段码与临时测试，`on_run_event` 恢复原始 shutdown 条件；保留显式 main 目录修复、诊断导出和 SDK 回归测试。最终 `cargo test -p markbridge-desktop --locked` 21 PASS，fmt/clippy/diff-check 退出 0。生产源码 grep 无 MARKBRIDGE_NATIVE_PROBE/TASK13_NATIVE_STAGE/native_probe。主会话再构建正式包并执行当前隔离安装闭环。
