# 15 可选本地向量检索：执行计划

## 启动门槛

2026-10-13 用户明确批准父 [启动例外](../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md)：13 当前安装、诊断导出及自动检查通过即可启动本任务；13 缺真实模型的完整验收仍未完成。15 不依赖 14。用户确认目前没有本地 embedding 模型，仍实施并做确定性检查；真实 V18/AC15-3 必须保持 NOT_RUN，任务不完成。

- [x] 用户已批准最新父规划和该任务范围。
- [x] 12 已完成；13 当前安装/诊断/自动检查满足批准的启动例外，13 完整 V12 仍未完成；不依赖 14。
- [x] 阅读当前 git status/diff、该任务三份规划文件及两个上下文清单。
- [x] 启动时上下文 10/10 条通过；补入当前语义合同后 implement/check 各 11 条通过，核对实际文件和工具版本。
- [x] 清除 14 指针并启动既有 15，planning→in_progress。父任务不代替子任务启动。

## 实施顺序

- [x] 建立固定中文/英文 B10K 候选 fixture 与人工标签门槛/全路径评测方法；候选不冒充人工审查。
- [x] 实现本地 embedding、持久索引元信息及可取消增量构建、默认关闭和范围审查。
- [x] 实现有界精确向量查询和独立开关/删除 UI，保留词法搜索；取消先于登记也有效。
- [x] 记录合成模型 digest/维度/向量字节、当前原生功能和评测方法；实际模型耗时/空间/质量 V18 为 NOT_RUN，待真实环境补齐。

## 检查命令

当前独立自动检查已经通过：192 Rust（3 项既有 ignored）、217 Vitest、20 Node、3 指标测试及 lint/typecheck/build/fmt/clippy/protocol 漂移。浏览器最终 13 项（8 语义+5既有工作台）与五尺寸前后截图通过；首次失败保留。当前 Windows 原生功能与最终包见最新 evidence；实际模型 V18 未运行。命令变更同步父计划和受影响任务。

```text
cargo test --workspace --all-targets --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm protocol:check
pnpm build:native
pnpm build:package
node --test .trellis/tasks/10-10-mb-15-semantic-search/evidence/semantic-metrics.test.mjs
node .trellis/tasks/10-10-mb-15-semantic-search/evidence/current-semantic-native.mjs
```

为 AC15-* 添加行为测试，不写仅复述实现的测试。涉及安全/写入/恢复时保留故障注入与反例。完整检查和原生步骤按父级 V18 执行。

## 原生或专项验收

在已授权本地 embedding 模型和 B10K 数据上执行相关性/时延检查；仅模拟模型时质量门槛为 NOT_RUN。

## 证据与交付

- [x] evidence/receipts.md 保存自动、浏览器、当前4fc原生合成模型、最终安装11控制和6c7e普通搜索性能原始收据/截图，首次失败保留。
- [x] AC15-1/2/4 功能通过，AC15-3/V18 缺实际模型与人工标签 NOT_RUN；任务不完成。
- [x] Trellis check子代理独立验证最终源码/自动检查及4fc原生73edf、3ee4安装/卸载、6c7e性能全部原始收据，最终批准。
- [x] 新源码/测试真实引用及取消/失效/存储/评测合同补入 `.trellis/spec/backend/semantic-search.md` 和索引，上下文各 11 条通过。
- [x] 保持 task.json in_progress、completedAt=null；缺实际验收不提交完成、不归档，未执行发布。

## 回退

停止 embedding 作业并删除派生向量表/索引内容；不得删除原书签、标签、摘要或 provider 的其他配置。
