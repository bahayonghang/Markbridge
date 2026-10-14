# 15 当前实施与分层证据

日期：2026-10-13。既有任务已实施，实际模型 V18/AC15-3 尚未运行，因此任务与原父任务不完成。没有新建任务、模型安装、提交、归档、发布或日常安装。

## 当前源码与自动检查

独立默认关闭配置、本机 Ollama tags/show/embed、冻结范围审查、migration 008、持久 generation/digest/dimension、全局串行构建、暂停/恢复/重启暂停、取消先于登记、摘要/标题失效、模型变更持续 Stale、最多 10,000 行流式精确 topK 和独立 UI 已实现。11 个新命令仅授予可信 main；远程预览不可调用。

[独立复核](current-independent-check.md) 通过 192 Rust（3 个既有 ignored）、217 Vitest、20 Node、3 指标测试，以及 lint/typecheck/build/fmt/clippy/protocol 漂移检查。全量浏览器 E2E 80 PASS，包含既有工作台与 13/14/15 功能。Rust 的正向 10,000 行排序反例不是真实模型性能。

前后五尺寸 UI 收据：[修改前](before-6b977e34-be79-4006-9707-ad2e2e0d71b5/receipt.json)、[修改后 13 PASS](after-e72b4faa-6137-4803-9da3-dd1ce7c2aa9f/receipt.json)、[最小窗确认按钮完整入视 1 PASS](confirmation-frame-1934634d-1f44-45c4-8710-43c56c5ac749/receipt.json)。保持已有蓝白布局。首次缺 ARIA role 的 7 FAIL/1 PASS、错误标签断言的 1 FAIL/7 PASS 均保留，没有改写为通过。

## 当前最终二进制与原生合成功能

正式 Windows build:native 的 3a 程序 25,301,504 bytes，经 [构建扫描](current-windows-native-build.log) 与 [首次原生合成功能](current-semantic-native-11449493-eca1-402a-995d-5938aaacefa3-receipt.json) 9 项通过。打包过程重建产生新的 hash，3a 收据只对应 3a。原工具 75dbe7 源码保存在 [首次工具快照](current-semantic-native-11449493-source.mjs)，原始收据不改。

[最终包检查](current-windows-package.log) 中 post-bundle release 与实际 NSIS 包内 exe 均为 25,301,504 bytes，SHA256 `4fcf7fcd506ad60eac1798c2a4c0ed9f80888648f7a5050ec41e6d47c67ff707`，格式/架构、路径及已知秘密模式扫描通过。安装包 SHA256 `2844783f1660d3708412b1bcbd602f8a2bc1c85369623cdf996d52368932b183`，未签名、未发布。

最终程序 [73edf605 原生收据](current-semantic-native-73edf605-908d-4a3a-9aa8-c7ae6bcf0942-receipt.json) 状态 PASS、9 控制点、errors=[]。它核对实际复制后的 exe 与 4fc release 相等、种子/源码/守卫脚本 hash、main/EBWebView 真实 OS 目录。默认关闭及禁用读取零请求；显式模型检查只读元数据、拒绝 remote model；冻结 3 条范围；暂停迟到请求不提交，恢复完成 3 条、4 维、48 bytes。查询隔离同 chromeId 的两个 Profile，实际输入 Enter 后才发一个 embedding，模型变更持久过期，返回旧 digest 仍零请求直至显式重建。删除取消在途查询，不复活索引；实际 SQLite 标签、备注、摘要 FTS 与词法结果完整保持。

该收据包含两次正常应用 exit0、精确 PID/UTC 创建身份的 WebView 消失、最终根内 processes/listeners=[]。正常重启保留 paused/3 条向量且零模型请求，必须显式继续。所有数据位于新建临时根，未安装或打开 Chrome。

实际原生 [查询截图](native-73edf605-908d-4a3a-9aa8-c7ae6bcf0942-ready.png) 与 [640×480 完整命中截图](native-73edf605-908d-4a3a-9aa8-c7ae6bcf0942-minimum.png) 已查看。此为合成模型功能证据，`actualModelV18=NOT_RUN`。

最终 Windows 3ee4f8c0/eee73eda 安装闭环实际 PASS：11 控制/0错误、schema8、默认语义关闭、80 command远程拒绝、P2/普通管理/重启零重放/精确吊销/卸载数据保留与2f88注册恢复通过。[最终安装日志](current-final-installed-integration.log) 和 [13 当前矩阵](../../10-10-mb-13-windows-acceptance/evidence/current-integration-2026-10-13.md) 保留原始来源及完整630文件/SQLite前后hash。

当前4fc普通搜索 B10K [原始性能收据](../../10-10-mb-13-windows-acceptance/evidence/current-performance-6c7edb60-a8b9-42fa-ac40-0144aba261f8-receipt.json) PASS：cold3次788.3896/633.5898/728.6094ms，warm30次p95 106.6/max110ms、4次正常退出。它只验证词法工作台，不能升级语义 V18。

## 固定评测与未运行边界

[评测说明](evaluation.md) 与 [候选标签](relevance-candidates.json) 保留固定 B10K 10,000/1,000/20 层和 20 个中英问题。候选未人工审查，严格 HUMAN_REVIEWED 门槛不会被 mock 或复制字段满足；全部结果与 30 次暖态 UI 到呈现的时延保留，nearest-rank p95，不丢低于门槛样本。未来 runner 无参数只输出 V18 NOT_RUN。

| 验收 | 当前结论 |
| --- | --- |
| AC15-1 默认零 embedding、启用说明与范围审查 | PASS，确定性/浏览器及当前原生 HTTP/SQLite/UI 功能证据 |
| AC15-2 暂停/恢复、内容失效、模型/维度隔离 | PASS，同上；实际模型仍缺 |
| AC15-3 人工 20 查询 Recall@5 >=0.8、B10K p95 <=1s | NOT_RUN，暂无实际 embedding 模型与人工标签 |
| AC15-4 禁用/删除保留原数据，缺模型明确不可用 | PASS，解析/失败 UI、零请求及当前 SQLite 保留证据 |
| V18 实际模型质量与性能 | NOT_RUN，不以合成向量升级 |
| macOS/Linux / V17、真实 AI / V12 | NOT_RUN，未获环境 |
| 真实 OS 睡眠 | WAIVED，实际 NOT_RUN，历史 V04 UNVERIFIED |

根工具首次 lint 报旧 sevenZip probe 的空 catch；加固定探测说明后 [最终 lint](current-root-tools-lint-final.json) exit0。首次日志保留。独立检查的首次行尾方法错误与后续正确 diff 检查分别记录，不改产品行尾。

回退停用工作并保留 schema 一致性备份；旧版本不得直接打开 schema8。删除索引只删派生内容，不能删数据库或浏览器数据绕过验收。最后 task.json 仍 in_progress，completedAt=null。
