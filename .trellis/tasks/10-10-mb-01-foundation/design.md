# 01 工程基础与可运行桌面骨架：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

根 Cargo.toml、package.json、pnpm-workspace.yaml、lockfiles、apps/desktop、apps/extension、crates/core、crates/protocol、packages/protocol、README.md、.github/workflows

## 技术合同

采用父设计第 1–2 节的栈。桌面 package 名固定 @markbridge/desktop，扩展 @markbridge/extension，协议 @markbridge/protocol。扩展只展示未配对状态且不监听开放端口；主窗口显示无资料状态。创建单一可信 main capability，远程源默认没有权限。基础脚本覆盖 lint/typecheck/test/build/protocol:check/test:e2e；暂未实现的测试不能用恒真命令伪装。建立最小有效协议 fixture 使生成检查有真实输入。01 中不存在集成扩展功能的断言。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

Windows 原生打开/关闭两次；确认空态、窗口大小、错误展示和退出行为。扩展只检查构建 manifest，不宣称 Chrome 同步已工作。

## 故障与回退

只回退该任务创建的源码和配置；保留已有 Trellis/ref 文件。该阶段没有真实用户数据库迁移。
