# 15 可选本地向量检索：设计

## 当前与边界

该子任务已于 2026-10-13 按批准的启动例外实施。以下为已批准合同与当前实现范围；验收以 evidence 原始收据为准，真实模型 V18 未运行。

crates/core semantic search、apps/desktop/src-tauri local embedding adapter/SQLite vectors、搜索设置 UI、relevance fixtures

## 技术合同

复用 10 provider 配置的本地模型通路，只允许用户选择本地 embedding endpoint。存 model/version/dimension/content fingerprint，模型变化重建而不混用。10,000 条规模先用 SQLite 保存向量加 Rust 有界精确 cosine 检索，避免独立向量服务；无性能证据不引入 ANN/向量扩展。仅索引用户授权范围，不后台抓取全库；暂停/继续/删除均可见。词法搜索保持独立。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在已授权本地 embedding 模型和 B10K 数据上执行相关性/时延检查；仅模拟模型时质量门槛为 NOT_RUN。

## 故障与回退

停止 embedding 作业并删除派生向量表/索引内容；不得删除原书签、标签、摘要或 provider 的其他配置。

## 2026-10-13 实施细化（启动前）

以下细化落实既有本地 embedding/SQLite/精确 cosine 合同，不新增任务或服务。研究依据为 [当前源码与官方 API 核查](../10-10-mb-13-windows-acceptance/research/semantic-preflight.md)。产品实施仍须满足已批准的 13 启动例外；此节不是运行证据。

- embedding 设置与聊天 AI 开关、模型和密钥独立，默认关闭。读取设置、启动、重启、未启用的保存和 UI 渲染均不访问模型。复用 10 的配置/取消原则，不能直接复用允许远程 HTTPS 的聊天端点验证器。
- 首版使用 Ollama `/api/tags`、`/api/show`、`/api/embed`；只接受 loopback 字面地址或钉住 loopback 的 localhost，无代理、重定向、userinfo、query、fragment、任意路径或聊天凭据。拒绝元数据宣告的 remote model/host；不调用 pull，不安装模型。缺失模型给出明确不可用状态。
- 输入仅为已授权书签的标题与已保存摘要，不含 URL、备注、标签、预览全文，也不抓取页面。标注字段的版本化输入限制为 8,192 Unicode 字符且 32 KiB UTF-8；在启用审查中披露裁剪。指纹使用身份、配方及完整标题/摘要的无歧义序列化 SHA256，不以树 revision 代替内容指纹。
- 先由 Rust 对当前 Profile/sourceEpoch/expectedRevision 解析非空选中书签范围，或明确选择的文件夹子树，展示计数与空间估算再确认。冻结 1–10,000 个 bookmarkId；超限拒绝，不截断。新增后代不自动加入范围，撤销删除产生的新身份不继承范围或向量。
- SQLite migration 008 为每个 Profile/epoch 保留一个当前派生索引，以及冻结成员、pending/ready 状态、模型名/实际 digest、dimension、配方、generation、进度。模型/端点变化使原 generation 不可用并要求显式重建；不是自动发请求的授权。向量存小端 f32 BLOB，每条维度 1–4,096，有限、非零并规范化；读取也验证长度和数值。
- 构建跨 Profile 全局串行，每次一个输入，无自动重试；可取消的等待不持有 Bridge 或 SQLite 锁，显式查询不占构建 permit。运行前/后核对模型 digest；提交须在 SQLite 单次作业内验证 index/generation、running、Profile/epoch、活跃身份、模型/维度及当前完整内容指纹。暂停、禁用、删除或替换配置先推进持久 generation，再取消，晚到响应不能恢复旧索引或覆盖新内容。重启把 running 变为 paused，必须显式继续。
- 标题与摘要修改使已授权成员 pending；笔记、标签、移动和 unchanged 全量 snapshot 不使向量失效。全量树替换须在最终状态判断真正删除，不能对中间 tombstone 清空全库向量。覆盖摘要的所有写路径及元数据恢复。删除或 epoch 重置立即排除旧向量，不能通过相同 chromeId/URL 跨身份复用。
- 查询为显式提交，1–4,096 字符且 16 KiB；与当前索引模型/digest/dimension 一致。HTTP 5 秒连接、15 秒总时限、1 MiB 响应上限。Rust SQLite 作业有界扫描最多 10,000 个当前 ready 行，一条一条解码、检查取消并保留 topK（1–50，V18 为 5），不把全量向量送 React。平分按稳定 bookmarkId 排序。
- UI 保留独立词法搜索；语义面板使用现有白色/蓝色简洁样式，明确模型、范围、估算（count × dimension × 4 字节，加 SQLite 开销；未确认维度时显示上界）、状态、暂停/继续、禁用/删除。返回命中只含已校验导航信息和分数；Profile/epoch/visit/index generation/query request 防止旧状态或结果串源。
- 删除索引只删除派生范围/向量/进度/模型元信息，保留书签、标签、笔记、摘要、FTS、预览与聊天配置。SQLite 文件不必立刻变小，不承诺物理抹除。关闭应用先取消/等待有界语义工作，网络等待不能持有 Bridge 锁或 SQLite shared handle。

实际模型与人工标注目前不可用。可建立评测工具、开发者候选中英查询与确定性向量/HTTP fixture，明确不是人工标注或真实模型验收。V18 使用经人工审查的固定 20 条标签、真实模型 digest/维度，记录至少 30 次暖态全路径查询原始时延与 p95 及平均 Recall@5；未具备这些证据时 AC15-3/V18 为 NOT_RUN，任务不完成。
