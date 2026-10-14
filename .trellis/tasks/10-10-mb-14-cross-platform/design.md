# 14 macOS 与 Linux 原生适配：设计

## 当前与边界

2026-10-13 已按批准的启动例外实施原生凭据、窗口存储、保存对话框、导航与构建分支，可执行源码和Windows回归已独立批准；随后15最终4fc包/安装也通过Windows回归。双平台实际编译、桌面、Chrome、安装和恢复仍NOT_RUN，正式任务未完成，见 evidence/receipts.md。

OS profile paths、secret storage、preview session isolation、Tauri bundle、跨平台 CI/文档和原生 evidence

## 技术合同

建议验收 macOS 14+ arm64 与 Ubuntu 24.04 x64 桌面。OS 凭据使用 Keychain/Secret Service，缺少安全存储时禁用保存凭据并明确提示，不退回明文。macOS 使用 WebKit 独立 dataStoreIdentifier；Linux 使用平台支持的独立 data directory，逐项验证，不套用 Windows 路径。完成 Chrome 文件读取、notify 事件、预览会话隔离、DPI、权限和退出。建议 macOS .app/.dmg、Linux .deb/AppImage 本地构建；签名/公证/公共发布另行授权。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

macOS、Linux 各自真实桌面完成 V02/V04/V08/V11/V15，并记录原生截图与安装产物。Windows 结果不能替代。

## 故障与回退

平台适配分支可回退但保留数据；凭据迁移前保留引用，不把 macOS/Linux 私有路径写入共享配置。安装测试只操作授权目录。

## 2026-10-13 实施细化（启动前）

本节落实既有原生适配合同；依据 [平台源码核查](../10-10-mb-13-windows-acceptance/research/platform-preflight.md)。13 当前安装/诊断/自动检查启动门槛已实际满足，并由独立复核确认后启动。用户已确认没有双平台原生环境；只做可执行源码和 Windows 检查，未执行的目标编译、桌面、Chrome、安装/回滚仍 NOT_RUN。

- keyring 固定 3.6.1，Windows 现有目标编码不改；macOS 目标启用 apple-native，Linux 启用 sync-secret-service/crypto-rust，使用 service/account，不把 Windows target 字符串当 macOS Keychain domain。原生存储不存在/锁定/拒绝时返回稳定错误，不能降级内存 mock 或明文。Linux 的 D-Bus 与 Secret Service 环境列入原生前提。
- Profile 继续由用户明确提供绝对 Chrome user-data 根，复用只读 reader/notify，不在启动或试验中扫描日常库。文档提示默认根、Linux XDG/Chrome 覆盖及从 chrome://version 取 Profile Path 上级的方法。
- 外部打开只使用固定原生可执行程序与参数数组，沿用 URL 校验/main 权限，不拼 shell。macOS /usr/bin/open，Linux xdg-open；进程启动与页面实际载入分别记录。
- 保存选择器运行在原生 UI 线程，归属可信主窗口；Linux GTK FileChooserNative、macOS NSSavePanel，明确 accepted/cancelled/failed。继续使用既有 SaveGuard 和原子 writer，不向前端增加路径、文件或 dialog 权限。
- main、preview、各 Profile、各临时根必须使用不同持久会话。macOS 14+ 使用由角色/应用数据根/Profile 域分隔散列产生的稳定 128-bit data_store_identifier；运行时与 bundle 最低版本均检查 14.0，旧版本不能悄悄落回默认 store。Windows/Linux 使用明确目录，并经 builder 显式传入，不能依赖自动 WindowConfig 目录转换。
- 清理 preview 会话只作用所选 Profile。先关闭其窗口；macOS 等待 remove_data_store 的原生结果，Linux 对对应保留 WebContext 的 WebsiteDataManager 等待 clear 完成。超时/失败不能返回 SessionCleared，其他 Profile 数据不删除。仅 rm 目录或异步清理方法的启动成功都不够。
- 平台原生导航/history 读取与回调保留 generation/profile/request 守卫；GTK load-failed 后的 Finished 不能覆盖失败。macOS 不替换 Wry delegate；使用原生状态更新及有界失败超时，缺乏成功回调时不能推断 Ready。远程网页仍无 IPC、弹窗/下载与危险 scheme 权限。
- native build/scanner 按运行平台选择 PE/ELF/Mach-O，保留 Windows 原检查及实路径 remap，补实际 POSIX 源/缓存路径泄漏反例；本地打包按 nsis、app/dmg、deb/AppImage 分支选择。验证实际包中程序，不能只扫描压缩容器；未在目标系统运行的构建/提取一律 NOT_RUN。CI 配置不等于 CI 已执行或桌面验收。

平台源分支在 Windows 被 cfg 排除，Windows 编译不能证明其类型、链接或运行正确。当前主机只有不具备 Chrome/Rust/Node 完整验收工具的 WSL 环境，不能把它描述成 V17 双平台环境。普通断连/重启仍待目标原生验收；V04 实际 OS 睡眠子项沿用 WAIVED/NOT_RUN，不恢复该要求。

13当前集成将preview私有目录改为 `v1-`+域分隔全SHA256；[13设计](../10-10-mb-13-windows-acceptance/design.md)是最新路径合同，研究中的旧完整hex为历史源码。14实施时补Linux/macOS原子不覆盖旧目录迁移（已有新/旧冲突或链接保留原内容并失败），不能沿用Windows专用MoveFileW或假装非Windows迁移已实现；macOS原生store生命周期与文件目录迁移仍分别处理。
