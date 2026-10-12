# 14 macOS 与 Linux 原生适配

## 目标

Windows 首版之后适配并原生验收 macOS 与 Linux；不通过交叉编译推断支持。该任务不阻塞 Windows 首版。

## 归属、状态与依赖

父任务：[Markbridge 工作台](../10-10-markbridge-workspace/prd.md)。需求：R15。里程碑：M5。状态：planning，未开始产品实现。

前置：[13](../10-10-mb-13-windows-acceptance/prd.md)。依赖代表前置验收通过，不能仅凭目录存在或任务已创建启动。该任务为后续范围，不阻塞 Windows 首版。

## 范围

该任务只承担上述交付；跨设备云服务、自动公共发布和无确认浏览器变更不在范围。拟修改路径与接口由 [设计](design.md) 说明。

## 验收标准

- [ ] AC14-1：两系统分别完成 profile 路径、配对、实时更新、只读降级和本地标签持久化。
- [ ] AC14-2：原生 secret store 不向明文配置降级；preview/main/Profile 会话和 IPC 边界分别验证。
- [ ] AC14-3：两系统的中断/回滚与本地安装运行通过，记录系统、WebKit/GTK、Chrome 和构建版本。
- [ ] AC14-4：Windows 必要回归不受平台分支改动影响；无原生环境则任务保持未完成并报告 NOT_RUN。

对应父级 [验证矩阵](../10-10-markbridge-workspace/verification.md)：V17。未运行环境明确保留 NOT_RUN，不能以源码检查代替原生证据。

## 完成条件

实现、相关检查和必要原生步骤均满足后才可标完成。检查命令和回退见 [执行计划](implement.md)。当前规划已获实施批准；前置验收通过后才可启动该子任务。提交、归档、发布和日常安装仍需单独授权。
