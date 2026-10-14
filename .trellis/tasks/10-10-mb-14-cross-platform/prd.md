# 14 macOS 与 Linux 原生适配

## 目标

Windows 首版之后适配并原生验收 macOS 与 Linux；不通过交叉编译推断支持。该任务不阻塞 Windows 首版。

## 归属、状态与依赖

父任务：[Markbridge 工作台](../10-10-markbridge-workspace/prd.md)。需求：R15。里程碑：M5。状态：2026-10-13 可执行源码适配、独立检查及 Windows 回归完成。同日用户明确目前默认 Windows、其他平台先不管，本任务离开活动队列。AC14-1/2/3 与 V17 仍为 NOT_RUN，不是原生验收通过。

前置：[13](../10-10-mb-13-windows-acceptance/prd.md)。依赖代表前置验收通过，不能仅凭目录存在或任务已创建启动。该任务为后续范围，不阻塞 Windows 首版。

本次按用户批准的 [启动例外](../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md) 启动：13 当前 Windows 安装、诊断及自动检查已通过且独立复核确认。13 的真实模型 V12 与完整验收仍未完成。用户确认暂时没有 macOS/Linux 原生环境，V17 保持 NOT_RUN；完成可执行适配和检查后继续不依赖本任务的 15。

## 范围

该任务只承担上述交付；跨设备云服务、自动公共发布和无确认浏览器变更不在范围。拟修改路径与接口由 [设计](design.md) 说明。

## 验收标准

- [ ] AC14-1：两系统分别完成 profile 路径、配对、实时更新、只读降级和本地标签持久化。
- [ ] AC14-2：原生 secret store 不向明文配置降级；preview/main/Profile 会话和 IPC 边界分别验证。
- [ ] AC14-3：两系统的中断/回滚与本地安装运行通过，记录系统、WebKit/GTK、Chrome 和构建版本。
- [x] AC14-4：Windows 必要回归不受平台分支改动影响；无原生环境则任务保持未完成并报告 NOT_RUN。

AC14-4 依据为 [当前收据](evidence/receipts.md) 中 Windows 2c/f81c 及随后 15 集成的当前回归；它不使 AC14-1/2/3 或 V17 通过。

对应父级 [验证矩阵](../10-10-markbridge-workspace/verification.md)：V17。未运行环境明确保留 NOT_RUN，不能以源码检查代替原生证据。

## 完成条件

实现、相关检查和必要原生步骤均满足后才可把 V17 标为通过。检查命令和回退见 [执行计划](implement.md)。2026-10-13 晚用户授权提交，并把本任务按 Windows 默认范围移出活动队列；这不勾选 AC14-1/2/3，也不声明平台支持。发布和日常安装仍需单独授权。
