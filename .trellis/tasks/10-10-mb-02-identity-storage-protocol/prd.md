# 02 Profile 身份、存储与共享协议

## 目标

定义 Profile 隔离、节点身份、版本化协议、SQLite migration 与领域模型。提供测试可用的存储/DTO，03 及后续任务共享同一契约。

## 归属、状态与依赖

父任务：[Markbridge 工作台](../10-10-markbridge-workspace/prd.md)。需求：R02,R03。里程碑：M1。状态：planning，未开始产品实现。

前置：[01](../10-10-mb-01-foundation/prd.md)。依赖代表前置验收通过，不能仅凭目录存在或任务已创建启动。该任务属于 Windows 首版。

## 范围

该任务只承担上述交付；跨设备云服务、自动公共发布和无确认浏览器变更不在范围。拟修改路径与接口由 [设计](design.md) 说明。

## 验收标准

- [ ] AC02-1：P2 同 chromeId、重复 URL、根属性缺失/重复、managed 数据均能正确存储且不串侧车。
- [ ] AC02-2：Rust→JSON→TS 与 TS→JSON→Rust fixture 互通；未知版本/写命令、超界字段被拒绝。
- [ ] AC02-3：全量缓存替换保留本地 metadata；非法树（环、重复 ID、缺父节点）不会替换最后有效树。
- [ ] AC02-4：空库初始化、升级 fixture、事务中断和 migration 失败后数据库可恢复且不丢旧数据。

对应父级 [验证矩阵](../10-10-markbridge-workspace/verification.md)：V01、V02（存储/协议部分）。未运行环境明确保留 NOT_RUN，不能以源码检查代替原生证据。

## 完成条件

实现、相关检查和必要原生步骤均满足后才可标完成。检查命令和回退见 [执行计划](implement.md)。任务创建只授权规划，最终方案待用户批准后才进入实现。
