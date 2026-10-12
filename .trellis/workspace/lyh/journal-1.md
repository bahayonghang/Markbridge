# Journal - lyh (Part 1)

> AI development session journal
> Started: 2026-10-10

---



## Session 1: 01 工程基础实施与原生验收缺口
<!-- trellis-session: v=2 fp=44f7f860c76dc415 -->

**Date**: 2026-10-10
**Task**: 01 工程基础实施与原生验收缺口
**Branch**: `main`

### Summary

已按批准规划实施 01，自动检查和独立复核通过；原生 UI pipe 不可用，AC01-2 未验证，后续任务未启动。

### Main Changes

- 创建 Tauri/React/MV3 基础 workspace、启动 DTO 生成校验、测试及 Windows CI。
- 修复 release 本机路径泄漏和相对 CARGO_TARGET_DIR 的构建/扫描目录不一致；同步父子规划与 specs。

### Git Commits

(No commits - planning session)

### Testing

- [OK] PASS：lint/typecheck/Web build/protocol/Rust gates；Vitest12、Node4、Rust2、浏览器E2E2；冻结锁重建；native release构建和模式扫描。
- [OK] UNVERIFIED：原生空态、IPC、尺寸、错误展示、两次正常打开关闭；NOT_RUN：托管CI。

### Status

[OK] **Completed**

### Next Steps

- 恢复原生UI工具后补齐01验收，前置通过后再启动02；当前批准继续有效。


## Session 2: 02 协议存储恢复与本地验收
<!-- trellis-session: v=2 fp=6afc49cc5409ea34 -->

**Date**: 2026-10-11
**Task**: 02 协议存储恢复与本地验收
**Branch**: `main`

### Summary

02 实现与 AC02-1～4 本地验收 PASS；独立复核和最终 Windows release 扫描通过。01 原生交互保持 UNVERIFIED，真实 Chrome 留给 03。未提交或归档。

### Main Changes

- 恢复全 NUL 的 wire.rs，原因未查明；保留损坏副本和首次失败。修正空变体额外字段拒绝、整数表示兼容及 TS 现场序列化验证，生成合同无漂移。
- 协议 corpus 增至 47，补充未编号数据库保留测试；更新父子任务、README、spec 和验收证据。

### Git Commits

(No commits - implementation session; commit and archive were not authorized.)

### Testing

- [OK] PASS：冻结锁文件安装、lint/typecheck/test/build/protocol:check、Rust fmt/workspace clippy/test；Vitest20、Node4、Rust20。
- [OK] PASS：Windows release 8848896 bytes；SHA256 23ae31e88e4b98f432db2d180d1b2cd3d1470da6f42fc5c10bd5a5c9ace364f0；独立复核后 22 个文件哈希未变。
- UNVERIFIED：01 原生交互；NOT_RUN：03 真实 Chrome、托管 CI、安装包、外部同步和跨平台。

### Status

[OK] **Completed**

### Next Steps

- 读取 03 规划与上下文，核对 02 PASS 收据后推进；在 Windows 交付前补齐 01 原生交互。现有实施批准继续有效。02 的生命周期状态保留 in_progress，验收状态为 PASS。
