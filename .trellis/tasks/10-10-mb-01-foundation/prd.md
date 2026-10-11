# 01 工程基础与可运行桌面骨架

## 目标

建立可启动的 Tauri 2 桌面壳、React/TypeScript 前端、MV3 扩展最小构建、Rust workspace、共享协议包位置和统一验证入口。该任务没有浏览器写入或 AI 调用。

## 归属、状态与依赖

父任务：[Markbridge 工作台](../10-10-markbridge-workspace/prd.md)。需求：R01。里程碑：M1。状态：in_progress。2026-10-10 用户已批准当前父子规划实施；基础源码和自动检查已建立，原生交互验收仍未完成。

前置：已完成的 00-bootstrap-guidelines。依赖代表前置验收通过，不能仅凭目录存在或任务已创建启动。该任务属于 Windows 首版。

## 范围

该任务只承担上述交付；跨设备云服务、自动公共发布和无确认浏览器变更不在范围。拟修改路径与接口由 [设计](design.md) 说明。

## 验收标准

- [x] AC01-1：锁文件和 README 能在具备 Tauri 前置工具的 Windows 环境重建；pnpm build 与 Rust 检查退出 0。
- [ ] AC01-2：原生 tauri dev 显示桌面空态，扩展生产产物具有合法 MV3 manifest；应用启动不修改书签。
- [x] AC01-3：README 明确实际依赖版本、MSVC/WebView2 前置条件、各脚本作用及浏览器/原生证据边界。
- [x] AC01-4：生成协议检查能检测故意造成的类型漂移；应用/扩展产物不包含密钥或本机路径。源码检查和产物模式扫描的范围见独立检查收据。

对应父级 [验证矩阵](../10-10-markbridge-workspace/verification.md)：V01。未运行环境明确保留 NOT_RUN，不能以源码检查代替原生证据。

## 完成条件

实现、相关检查和必要原生步骤均满足后才可标完成。检查命令和回退见 [执行计划](implement.md)，当前证据见 [检查收据](evidence/receipts.md)。实施批准已经授予；提交、归档、发布和日常安装仍需单独授权。
