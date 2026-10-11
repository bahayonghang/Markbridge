# 14 macOS 与 Linux 原生适配：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

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
