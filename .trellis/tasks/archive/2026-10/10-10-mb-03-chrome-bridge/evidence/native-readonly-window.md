# 原生只读窗口

日期：2026-10-11。UI Automation 一次没有读到状态文案，见下文「错误」。随后的 PrintWindow 读到了页眉状态，见文末。

## 启动前

Tauri 2.12.3 的 `app_data_dir` 在 Windows 上解析为 `{FOLDERID_RoamingAppData}\com.markbridge.desktop`。

路径：`C:\Users\lyh\AppData\Roaming\com.markbridge.desktop`。

该目录当时不存在。`markbridge.sqlite` 不存在。因此执行了启动。

## 命令

工作目录为仓库根。

命令：`pnpm --filter @markbridge/desktop tauri dev`

进程：`D:\Documents\Code\Tauri\Markbridge\target\debug\markbridge-desktop.exe`，PID 65388，HWND 7736350。

UI Automation 读到的窗口标题：`Markbridge · 签桥`。类名：`Tauri Window`。

读窗口文字的命令：`powershell.exe -NoProfile -STA -File %TEMP%\markbridge-uia-once.ps1`

该命令退出码：0。

## 错误

UI Automation 对主窗口后代遍历一次。`COUNT=16`。有名称的节点只有：

- `Markbridge · 签桥`（窗口，类 `Tauri Window`）
- `Markbridge · 签桥`（`Chrome_WidgetWin_1`）
- `Markbridge · 签桥 - Web content`（`BrowserRootView`）

没有状态文案。遍历结果里没有 `未配对 · 只读`，也没有 `未连接 · 只读`。WebView 正文没有暴露给这次 UI Automation。同一工具没有再运行。

## 进程结果

观察后终止了上述 `pnpm --filter @markbridge/desktop tauri dev`。任务状态：cancelled。持续时间 113.58s。进程没有自行退出，没有退出码。终止后 `markbridge-desktop` 不在，端口 1420 已关闭。

没有点击配对，没有调用 `begin_pairing`。`cmdkey /list` 没有包含 `Markbridge` 的目标行。

## 启动写出的文件

| 文件 | 字节 |
|---|---:|
| `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop\markbridge.sqlite` | 143360 |
| `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop\markbridge.sqlite-shm` | 32768 |
| `C:\Users\lyh\AppData\Roaming\com.markbridge.desktop\markbridge.sqlite-wal` | 0 |

## 验收

AC03-4 保持 UNVERIFIED。这次没有读到未配对标签。未配对标签也不是断开过渡。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。

## PrintWindow

日期：2026-10-11。

工作目录为仓库根。

命令：`pnpm --filter @markbridge/desktop tauri dev`

进程：`D:\Documents\Code\Tauri\Markbridge\target\debug\markbridge-desktop.exe`，PID 54708。窗口标题匹配 `Markbridge · 签桥`。类名：`Tauri Window`。HWND 42402238。矩形 168,160，1377×989。

截图命令：`pwsh -NoProfile -File C:\Users\lyh\AppData\Local\Temp\markbridge-printwindow.ps1`

该命令退出码：0。方法：`PrintWindow`，标志 `PW_RENDERFULLCONTENT`。`PRINT_OK=True`。位图：`evidence/native-readonly-window.png`。

页眉状态文案：`未连接 · 只读`。同屏还有 `监听尚未启动` 和 `0 个资料`。没有配对串。

没有点击配对，没有调用 `begin_pairing`。`cmdkey /list` 没有包含 `Markbridge` 的目标行。

画面上没有已配对资料。断开后的只读过渡没有出现在这张位图里。AC03-4 保持 UNVERIFIED。V03 保持 NOT_RUN。V04 保持 UNVERIFIED。

## 进程结果（PrintWindow 之后）

观察后终止了上述 `pnpm --filter @markbridge/desktop tauri dev`。任务状态：cancelled。持续时间 310.93s。进程没有自行退出，没有退出码。终止后 `markbridge-desktop` 不在，端口 1420 已关闭。

`C:\Users\lyh\AppData\Roaming\com.markbridge.desktop` 没有删除。
