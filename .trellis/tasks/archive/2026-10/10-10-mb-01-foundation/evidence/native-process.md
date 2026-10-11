# 原生进程启动检查

日期：2026-10-10。工作树包含子任务 01 未提交源码。原生 UI 工具的失败记录见 [会话前置检查](session-preflight.md)。

## 启动

在仓库根目录执行：

```powershell
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path (Get-Location) 'runs/native-01/webview'
pnpm --filter @markbridge/desktop tauri dev --no-watch
```

环境变量仅作用于该命令进程及其子进程。WebView 数据位于忽略的 runs/native-01/webview，不使用日常 Chrome Profile。应用当前不含数据库或配置写入功能。

命令输出：

```text
VITE v8.3.4 ready in 176 ms
Local: http://127.0.0.1:1420/
Finished `dev` profile [unoptimized + debuginfo] target(s) in 8.18s
Running `target/debug/markbridge-desktop.exe`
```

仅查询路径等于本仓库 target/debug/markbridge-desktop.exe 的进程，观察到：

```text
Id: 62700
MainWindowTitle: Markbridge · 签桥
MainWindowHandle: 6231266
Responding: true
```

结果：PASS，仅限原生二进制启动、创建有标题的窗口及进程响应。未观察原生页面、IPC 返回或错误界面。

## 退出和检查缺口

原生 UI 工具无法连接 native pipe，没有发送正常关闭输入。使用经过绝对路径筛选的 Stop-Process 结束唯一的本仓库进程。Tauri 随后报告：

```text
process didn't exit successfully: markbridge-desktop.exe (exit code: 0xffffffff)
Command failed with exit code -1.
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL
```

该非零退出由进程终止操作导致，不能记录为正常关闭通过，也不能据此判断应用自行崩溃。

尝试读取监听端口时，当前 PowerShell 无 Get-NetTCPConnection 命令。该端口检查为 NOT_RUN；未把无输出解释为零 listener。

AC01-2 原生空态、窗口尺寸、错误展示和两次正常打开/关闭：UNVERIFIED。原生截图：NOT_RUN。01 保持 in_progress；02 的前置验收未通过，保持 planning。

浏览器截图已在主会话查看，1100×760 和 640×480 均显示未配对空态，没有水平截断。浏览器结果不替代原生画面和交互证据。

## 后续依赖调整

2026-10-10 用户明确批准先实施 02。该批准仅调整 01→02 启动门槛，不改变上述原生验收结论。01 仍为 UNVERIFIED，Windows 交付前须补齐。02 当前启动记录见 [02 前置记录](../../10-10-mb-02-identity-storage-protocol/evidence/session-preflight.md)。
