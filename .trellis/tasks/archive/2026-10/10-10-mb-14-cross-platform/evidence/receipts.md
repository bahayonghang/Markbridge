# 14 当前实施与证据

日期：2026-10-13。可执行适配源码、独立检查及 Windows 必要原生回归已完成，macOS/Linux 目标编译与原生 V17 未执行。任务仍未完成，已清除活动指针继续独立 15。

随后15冻结后的当前Windows回归也已完成：[最终独立检查](../../10-10-mb-15-semantic-search/evidence/current-independent-check.md) 为192Rust/217Vitest/20Node/80E2E及完整gate PASS；当前4fc/284478包实际扫描一致，3ee4/eee73隔离安装11控制、schema8诊断、80command拒绝、P2/预览/重启/卸载保留通过。当前4fc/6c7e三冷/30暖普通搜索通过，原始来源见 [13当前矩阵](../../10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md)。AC14-4已勾选，AC14-1/2/3与V17不因Windows结果通过。

## 启动依据

13 当前 4f/269c 二进制安装 `722a2dd5/f6c5a5fc`、诊断和受影响自动检查通过，独立复核批准用户明确的启动例外。13 的真实模型 V12 仍 NOT_RUN、完整验收未完成。见 [13 当前矩阵](../../10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md)、[独立复核](../../10-10-mb-13-windows-acceptance/evidence/current-independent-check.md) 和 [门槛决定](../../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md)。

已执行 `python .trellis/scripts/task.py finish` 清除 13 指针、`task.py validate .trellis/tasks/10-10-mb-14-cross-platform`（implement/check 各 11 条通过）、`task.py start .trellis/tasks/10-10-mb-14-cross-platform`（planning→in_progress），均退出 0。没有启动父任务，没有新建重复任务。

## 原生环境阻塞

用户明确答复“暂时没有，记录未验证后继续其他工作”。没有 macOS 14+ arm64 或 Ubuntu 24.04 x64 完整原生桌面与 Chrome 验收环境。列出的 WSL 组件不补齐缺失工具，也不替代真实桌面安装、配对、权限或回滚观察；本轮没有安装系统依赖。

| 项目 | 执行状态 |
| --- | --- |
| macOS / Linux 目标类型检查、链接和构建 | NOT_RUN |
| 两平台 V02 / V04 普通恢复 / V08 / V11 / V15 | NOT_RUN |
| Keychain / Secret Service 实际保存、锁定和失败 | NOT_RUN |
| 主窗口/预览/各资料隔离、持久化和清理 | NOT_RUN |
| 两平台实际包、安装运行和卸载保留 | NOT_RUN |
| 托管跨平台 CI | NOT_RUN，配置不等于执行 |
| 真实 OS 睡眠 | WAIVED；实际 NOT_RUN，历史 V04 UNVERIFIED |

Windows 编译不检查 cfg 排除的原生平台分支。源码/API 核查、确定性测试和 Windows 必要回归分别记录；只有实际执行并保留日志的项写 PASS。当前任务保持未完成；可执行工作及独立检查已完成后清除指针，当前 15 已实施并进行最终 Windows 集成。

平台前提和原生验证清单见 [原生平台指南](../../../../docs/native-platforms.md)。

## 冻结源码与 Windows 检查

实际执行的 lint/typecheck/test/build、Rust fmt/clippy/workspace tests、protocol:check 均退出 0。188 Vitest、20 Node、167 Rust（119 core + 34 desktop + 14 protocol）通过；3 个既有原生/模型 ignore 不计通过。完整日志、源码 hash、首次 pnpm.cmd 错误版本启动失败与修正重测见 [独立报告](current-independent-check.md)。macOS 参数、Ready 超时、Linux 先迁移再建 context 和共享平台断言等源码发现均已修正；Windows 检查仍不能证明被 cfg 排除的原生分支。

`pnpm build:native` 实际退出 0，日志 [Windows build](current-windows-native-build.log)：明确 host target 下的 PE 程序为 24,214,016 bytes，SHA256 `2c31f83c9124aa61a2b9651320663a423bba5b52b9a173aa238d7e73e587068c`，格式/架构及 UTF-8/UTF-16 路径/已知密钥模式扫描通过。

实际新程序复制到新临时根后运行生产 66 字符资料与 legacy-roundtrip probe，退出 0，[原始 f81cc8f7 收据](../../10-10-mb-13-windows-acceptance/evidence/current-preview-persistence-f81cc8f7-36f8-4120-83fd-f4c3fe4c450a-receipt.json) PASS、errors 空。main OS 目录精确命中新根的 main-webview；5 次打开/关闭、6 个 page 身份绑定的观察证明立即重开、A/B/A 和旧目录迁移后恢复 cookie/localStorage，main canary 均为空。main PID153068 正常 exit0/no signal，6 个原 WebView PID+UTC 身份 absent，最终所属进程/监听为空。独立复核已读取原始值、重新扫描/hash 程序并批准继续 15。

这个 probe 没有安装、Chrome 配对或模型。Windows 最终 package 与安装闭环将在 15 源码后的集成执行；14 原生及目标包/CI 均仍 NOT_RUN。没有关闭、提交或归档任务。

## 安全存储错误提示（浏览器 fixture）

现有 ConnectionSettings 把 STORAGE_ERROR 仅解释成缓存读取失败，AiSettings 保存密钥失败只有泛化提示。沿用现有蓝色/白色工作台、字体、边框、导航和按钮，补充缓存权限与已解锁系统凭据服务的检查方向。只有固定 STORAGE_ERROR 映射到配对提示，未知异常不显示原文；密钥保存拒绝或返回未配置时不声称成功，输入仍清空、原配置保留，允许用户解决服务问题后重试。没有添加启动探测、明文存储或前端权限。

`tests/e2e/secure-storage.spec.ts` 在 mock Bridge 上记录 1440×900、1100×760、640×760、1100×480、640×480。首次 `current-ui-before.log` 因测试误用「AI 建议」标签超时，实际标签是「AI」，该运行已中断并保留 FAIL；修正后 `current-ui-before-fixed.log` 5 项通过、`current-ui-after.log` 6 项通过，退出码均 0。修改前后各 10 张截图在 [screenshots](screenshots/)；主会话实际查看前后最小 AI、正常连接及修改后最小连接截图，提示未溢出，键盘焦点可见。

断言覆盖输入清空、不显示原始异常/合成密钥、未伪报保存、没有模型生成/测试请求、操作可重试、配对拒绝不产生配对串且既有资料保留。此为渲染及固定错误路径证据；不证明 macOS Keychain 或 Linux Secret Service 的实际拒绝/锁定行为，相关原生项仍 NOT_RUN。
