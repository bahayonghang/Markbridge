# 原生平台与验收

2026-10-13：Windows 已有原生与隔离安装证据，也是当前默认交付平台。用户明确其他平台先不管。macOS/Linux 可执行源码适配及 Windows 回归已经独立检查通过，但没有对应原生验收环境，V17 为 NOT_RUN，不能宣称已支持。构建成功、CI 配置和源码检查各自记录，不能代替桌面、Chrome、安装与恢复验收。

| 平台 | 目标环境 | 当前证据边界 |
| --- | --- | --- |
| Windows | Windows 11 x64，Chrome 134+，WebView2 | 当前4fc/284478/3ee4安装、schema8诊断、重启/卸载保留与6c7e B10K通过；V12缺真实模型，13/M4未完成 |
| macOS | macOS 14+ arm64，Chrome 134+，系统 WebKit | 14 源码适配完成；目标编译、原生交互与安装/恢复 NOT_RUN |
| Linux | Ubuntu 24.04 x64 桌面，Chrome 134+，GTK 3 / WebKitGTK 4.1 | 14 源码适配完成；目标编译、原生交互与安装/恢复 NOT_RUN |

当前 Windows 收据见 [13 集成矩阵](../.trellis/tasks/10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md)。该二进制 hash 的结果不能冒充后续平台或语义检索改动后的重新验收。跨平台合同和未测项见 [14 执行计划](../.trellis/tasks/10-10-mb-14-cross-platform/implement.md)。

## Chrome 用户数据目录

文件镜像入口要求用户明确填写本机绝对路径，然后点击「枚举资料」。不会在启动时自动扫描日常 Chrome。该目录是包含 `Local State` 和各 Profile 子目录的用户数据根，不能填写 `Bookmarks` 文件或单个 `Default` 目录。

| Chrome 稳定版 | 默认用户数据根 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data` |
| macOS | `~/Library/Application Support/Google/Chrome` |
| Linux | `~/.config/google-chrome` |

表中的环境变量和 `~` 是路径说明，填写时使用展开后的绝对路径。Chrome 渠道、Chromium 与自定义目录可能不同。最可靠的方式是在目标 Chrome 中打开 `chrome://version`，找到「Profile Path」，复制该路径的上一级目录。Linux 的 `CHROME_CONFIG_HOME`、`XDG_CONFIG_HOME`、`CHROME_USER_DATA_DIR` 或启动参数可能改变默认路径；`--user-data-dir` 优先于完整根的环境变量。参见 [Chromium 原始路径文档](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md)。

文件镜像只读取 Chrome 书签，不授予浏览器写入权限。实时写入始终需要配对扩展、live 状态和用户确认。每个平台都要分别验证原子替换、不可读路径、断连缓存和重启恢复；Windows 结果不能证明 FSEvents 或 inotify 行为。

## 构建与运行前提

三种平台使用仓库固定的 Node、pnpm、Rust 和锁文件。系统依赖由环境所有者安装，项目构建脚本不安装系统组件。实际目标版本、架构、工具和程序 hash 应写入对应收据。

Windows 需要 MSVC C++ 工具链、Windows SDK 和已有 WebView2 Runtime。macOS 需要 Xcode 或桌面开发所需的 Command Line Tools；本项目预览隔离合同额外要求 macOS 14+，开发启动也不能绕过该最低版本。Ubuntu 需要 GTK 3、WebKitGTK 4.1、C/C++ 构建工具、SSL、xdo、Ayatana appindicator、librsvg 开发依赖，以及 Secret Service 后端所需的 D-Bus 开发依赖。具体发行版包名和安装说明见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。

macOS 凭据使用 Keychain。Linux 运行需要本用户的桌面 D-Bus 会话及可用、已解锁的 Secret Service；仅有库文件或 `DISPLAY` 不代表安全存储可用。服务缺失、锁定或拒绝访问时，凭据保存必须失败并保留既有引用，不能写入明文配置或改用内存 mock。协议背景见 [Secret Service 规范](https://specifications.freedesktop.org/secret-service/latest/)。

目前连接的是 Windows。已列出的 WSL Ubuntu 环境缺少完整的 Chrome、Rust、Node 工具和对应验收条件，用户确认暂时没有双平台原生主机；本轮没有为此安装环境依赖，也没有将 WSL 列为 V17 通过证据。

跨平台 CI 源码使用 Ubuntu 24.04 x64 与 macOS 15 arm64，并在任务内检查实际架构。GitHub 已宣布 macOS 14 runner 于 2026-11-02 退役、10 月有中断时段，因此构建 runner 选用仍可用的 macOS 15；产品最低系统仍是 macOS 14，最低版本原生验收仍 NOT_RUN。参见 [GitHub 退役公告](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/)。CI 未在本轮运行，不作为平台支持证据。

## 待补原生证据

macOS 和 Linux 各自使用新建临时 Chrome Profile、独立应用数据根和凭据命名空间。安装实验需要对应授权，不使用日常库。每个平台分别完成：

1. 记录系统/架构、Chrome、WebKit 或 GTK/WebKitGTK、工具版本与程序/包 hash；构建和扫描实际程序，核对包内资产。
2. P2 配对、错误认证拒绝、实时更新、只读降级、本地标签备注持久化及凭据失败边界。
3. main、preview、两个 Profile、两个应用数据根互相隔离；持久化重开和只清所选 Profile；远程网页逐条 IPC 拒绝。
4. 原生导航/history、加载失败、危险 scheme、弹窗/下载约束，保存成功/取消/失败和外部浏览器交接。
5. 中断、不确定回执、冲突与条件回滚；普通断连、重连、正常退出和重启不重放。
6. 经授权的隔离安装、正常卸载、完整数据保留，以及所属进程、监听和安装注册清理。

实际 OS 睡眠验收沿用用户明确豁免：WAIVED、实际 NOT_RUN，历史 V04 UNVERIFIED；不重新要求睡眠操作。用户已把其他平台移出当前范围，所以上述 V17 项现在不阻塞 Windows 交付；一旦重新验收，仍须实际证据，不能把本次延期写成通过。签名、公证、发布、日常安装均未获本轮授权。
