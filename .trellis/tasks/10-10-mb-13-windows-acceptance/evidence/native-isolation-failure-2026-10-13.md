# 当前安装版原生隔离失败

实际 setup `b281dd16306b34c8a827fb4c5c798dc5bd918fde58d4df97641ac22903debcd8`，包内/安装/release exe `4ec9bdfedb7fa1d402011717a8f8ca89d9673e061a764c5cba9e4a4c47986784`。此安装版的完整验收未通过，不可据此启动 14/15。

## 原始失败

- 第一次 e83a7a57/de773d3a：脚本遗漏实际来源切换确认，停在预览隔离；随后 Chrome 关闭超时。原始 FAIL 保留。f0299d32 的后续正常卸载/数据 hash/注册恢复完成仅证明失败试验清理，不把原运行改为 PASS。
- 第二次 b9e7a249/48f99d32：`PROFILE_A_PREVIEW_SESSION_NOT_RESTORED`，随后两个 Chrome 关闭超时、应用关闭超时及剩余试验进程。预览 probe 未绑定每次新加载的页面，其共享轮询可能由旧 B 页消费 A 页 read；先修正证据关联，再判断实际会话行为。
- 应用关窗助手只选择同 PID 的第一个可见窗口；存在预览时可能仅关闭预览，留下主窗口。应修复当前助手，不改已冻结的归档脚本。

## 实际主 WebView 路径

第一次清理报告的 `mainWebviewPresent=false`。第二次运行通过只读 OS 进程检查：临时安装 exe 的精确进程 PID113572，其直接 WebView2 子进程 PID127724 的实际 `--user-data-dir` 经过引号、斜杠和 Windows 长路径前缀规范化后，分类为 `default-app-store`，位于默认 `LocalApplicationData/com.markbridge.desktop`，不在已批准临时根的 `app-data/main-webview`。

这是真实运行反例，源码设置 `context.config_mut().app.windows[].data_directory` 与二进制包含 `main-webview` 字符串都不足以证明隔离。主会话对精确临时 exe/PID使用既有 WM_CLOSE 正常关闭可见窗口，PID113572 已不存在。没有读取、删除或清理默认应用目录的文件，不能声称此前试验完全未影响默认 WebView 数据；其实际影响未验证。日常 Chrome Profile 未作为试验对象。

## 下一门槛

已确认源码根因：Tauri2.12.3 自动创建走 `WebviewWindowBuilder::from_config`，runtime2.12.1 的 `WindowConfig -> WebviewAttributes` 转换遗漏目录，manager 填入默认应用目录。修复仅显式临时 override 的 main 启动：先禁止自动创建，在服务初始化后保留原窗口配置并显式调用 builder `data_directory`。无 override 行为和 preview 的显式目录未改。新增回归在原实现实际 FAIL，修复后 desktop21 / 全 Rust153 PASS（3项专项仍 ignored）。源码修复不代表实际隔离通过，必须继续新包 OS 路径检查。

停止使用该未隔离启动路径。先从实际锁定 Tauri/Wry 源码定位配置未到达运行时的原因，补不会启动不安全窗口的回归，再修启动并重新构建/扫描/提取新包。新的原生助手必须在任何配对/编辑前核对 OS 实际主 WebView 数据目录和目录存在；拒绝全局 `WEBVIEW2_USER_DATA_FOLDER`，保留 preview 的独立目录。完成新包的真实干净闭环后才能按已批准启动例外继续 14/15。模型/平台缺失项依旧未完成。

## 新版启动探针与助手修正

修复后 exe `7ecf1580…e01f1c` 的 0313 初次探针在临时根内发现实际路径但精确匹配失败；WebView2 在 host 指定目录后追加 `EBWebView`，当前助手只接受已知 main/Profile 目录或该精确子目录，不放宽到任意临时路径。829 后续探针实际观察 `app-data/main-webview/EBWebView` 且目录存在，主会话隔离为局部 PASS，整体仍因正常退出失败而 FAIL。

临时固定阶段诊断 exe `1a93d343…15895d` 的 4eab 探针到达 RUN_READY、RUN_EXIT_REQUESTED，但没有到达 RUN_EXIT 或数据库 shutdown。首次助手向 main 与另一空标题可见内部窗口共发送两次 WM_CLOSE。锁定 Tao 源码显示内部事件目标虽 visually empty，仍设置 WS_VISIBLE；不能把所有 IsWindowVisible 窗口当应用窗口关闭。

同一诊断 exe 的 3ee19ba4 重测，仅向标题精确匹配的 main 发送一次 WM_CLOSE，内部窗口只观察：实际退出 0、完整阶段至 BRIDGE_SHUTDOWN_END、主 WebView2 与所有临时根进程/端口消失，探针 PASS。该控制变量证据支持过宽助手关闭规则为此次挂起原因，不需要更改产品 shutdown 或添加猜测性超时。诊断版安装为 NOT_RUN；移除临时标记并重建正式包后仍须安装闭环。

0313、829、4eab 的三个复制启动失败进程已在核对各自收据中的精确 PID/可执行文件/hash、无可见窗口及无子进程后强制清理；单独保留 `current-startup-owned-cleanup-1645dca6-a52e-4307-adf6-40661e44219c.json`，原运行仍 FAIL、正常退出 UNVERIFIED，没有删除数据或注册项。根会话清理命令使用的 Get-NetTCPConnection 在 PowerShell7 不可用，故该原记录的 listenersBefore 不能当有效测量；`current-startup-cleanup-audit.json` 使用原生 netstat/CIM 独立确认六个已知 app/WebView PID 均消失且无监听，明确纠正该证据缺口。该清理不升级任何安装或正常退出验收。
