# 02 Profile 身份、存储与共享协议

2026-10-10 用户批准仅调整 01→02 启动门槛：01 自动检查通过，原生验收保留 UNVERIFIED，Windows 交付前补齐。其他依赖门槛不变。

## 目标

定义 Profile 隔离、节点身份、版本化协议、SQLite migration 与领域模型。提供测试可用的存储/DTO，03 及后续任务共享同一契约。

## 归属、状态与依赖

父任务：[Markbridge 工作台](../10-10-markbridge-workspace/prd.md)。需求：R02,R03。里程碑：M1。状态：in_progress，已按用户批准的 01→02 门槛例外启动。

前置：[01](../10-10-mb-01-foundation/prd.md)。依赖代表前置验收通过，不能仅凭目录存在或任务已创建启动。该任务属于 Windows 首版。

## 范围

该任务只承担上述交付；跨设备云服务、自动公共发布和无确认浏览器变更不在范围。拟修改路径与接口由 [设计](design.md) 说明。

## 验收标准

- [x] AC02-1：P2 同 chromeId、重复 URL、根属性缺失/重复、managed 数据均能正确存储且不串侧车。
- [x] AC02-2：Rust→JSON→TS 与 TS→JSON→Rust fixture 互通；未知版本/写命令、超界字段被拒绝。
- [x] AC02-3：全量缓存替换保留本地 metadata；非法树（环、重复 ID、缺父节点）不会替换最后有效树。
- [x] AC02-4：空库初始化、升级 fixture、事务中断和 migration 失败后数据库可恢复且不丢旧数据。

2026-10-11：以上验收在合成 fixture 和临时 SQLite 范围内 PASS，完整本地检查和最终 Windows release 扫描通过。证据见 [收据](evidence/receipts.md) 与 [独立复核](evidence/check-review.md)。真实 Chrome 身份与配对属于 03，仍为 NOT_RUN；01 原生交互保持 UNVERIFIED。未提交或归档，task.json 生命周期状态保留 in_progress。

对应父级 [验证矩阵](../10-10-markbridge-workspace/verification.md)：V01、V02（存储/协议部分）。未运行环境明确保留 NOT_RUN，不能以源码检查代替原生证据。

## 完成条件

实现、相关检查和必要原生步骤均满足后才可标完成。检查命令和回退见 [执行计划](implement.md)。当前规划已获实施批准；前置验收通过后才可启动该子任务。提交、归档、发布和日常安装仍需单独授权。
