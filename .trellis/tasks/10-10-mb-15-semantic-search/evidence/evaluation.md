# 语义评测与原生功能工具

当前没有实际 embedding 模型，也没有人工审查标签。AC15-3/V18 为 NOT_RUN。开发者候选集、确定性向量和 HTTP mock 只验证实现，不能升级为相关性或真实模型性能证据。

## 固定数据与指标

`semantic-fixture.mjs` 复用既有 B10K 生成器，seed 20261010，10,000 书签、1,000 文件夹、20 层；前 100 条构成 20 个主题，每个主题 5 个候选相关书签，保留背景条目与原树结构。完整 fixture SHA256 为 `bca64cce81391d3f1fea52c3d63119e8dd405b3d89e2dfecf59e50f9f05427eb`。

[候选标签](relevance-candidates.json) 明确 `DEVELOPER_CANDIDATE_NOT_HUMAN_REVIEWED`。人工审查必须检查真实问题与书签内容，调整 gold 集，再记录 `annotationStatus=HUMAN_REVIEWED`、`humanReview.reviewed=true`、真实 reviewer 和 reviewedAt；复制或自动改字段不构成人工审查。

`semantic-metrics.mjs` 拒绝重复或缺失 query、重复 top5 身份、fixture 不一致与不足 30 个暖态样本。Recall@5 按命中 gold 数量除以 gold 数量，取 20 条平均；p95 使用 nearest-rank，保留全部原始时延、最大值和低于门槛结果。门槛为平均 Recall@5 >=0.8 且暖态 p95 <=1,000 ms。

## 隔离原生功能检查

先构建当前二进制及种子工具，再运行：

```powershell
cargo build -p markbridge-core --example semantic_fixture_seed --locked
pnpm build:native
node .trellis/tasks/10-10-mb-15-semantic-search/evidence/current-semantic-native.mjs
```

工具只创建系统 temp 下新的 `markbridge-task13-native-*`，使用生产 Storage worker 写入两个合成 Profile、同 chromeId 的书签及摘要/备注/标签 canary。复制当前 release，不做安装。原生 main OS 目录守卫通过后才允许 UI/IPC；本机临时 HTTP 服务提供确定性 Ollama 元数据与向量。检查默认零请求、显式模型检查不发文本、远程模型拒绝、范围审查、暂停/迟到响应/恢复、资料隔离、模型变更持久过期、删除取消、词法数据保留及正常退出。保留原始收据与临时数据。

## 未来真实模型 V18

取得实际本机模型与人工审查标签后，显式执行以下命令才授权本次 10,000 条输入及 50 次查询。占位参数不能直接执行：

```powershell
node .trellis/tasks/10-10-mb-15-semantic-search/evidence/evaluate-real-model.mjs --run-real-model http://127.0.0.1:11434 MODEL_NAME ABSOLUTE_HUMAN_REVIEWED_LABELS_PATH
```

工具在创建 fixture/启动原生应用之前检查标签；不调用 pull、不装模型、不接受远程模型或代理端点。使用新的隔离根和生产 Storage worker，显式审查整个 B10K 后构建，核对实际模型 digest/维度及 10,000 个 ready 向量。模型元数据可能省略维度，此时以已完成索引的实际向量维度为准，不把 nullable 元数据误判为缺模型。50 次查询均走真实输入控件、提交按钮、HTTP、Rust 排序、协议解析和 UI 呈现。页面时钟从填入输入之前计时，到对应结果已经呈现后两个 animation frame；包含自动化观测开销，不减去任何时间。

保留 20 条查询的实际结果与 30 条暖态原始时延，开始/结束核对 indexId/generation/digest。故障、低相关性、超门槛与退出失败均保留为 FAIL，不丢样本。当前未执行这条真实模型命令；无参数运行仅输出 NOT_RUN。
