# R03 设计

## 方法与边界

扩展本地cache查询DTO的分页/revision及组合条件，由Rust参数化查询，不在UI拼SQL或只过滤第一页。source/folder/filter变化递增请求代次，晚到响应丢弃。selection与active item区分，选择ID绑定profile/sourceEpoch。窗口尺寸驱动VirtualRows高度；键盘可滚动到末项。默认源顺序，筛选不写Chrome排序。

## 本地查询合同（实施收敛）

新增 `cache_query({ profileId, request })`，不增加 Chrome wire 命令。Rust `LibraryQuery` 与 `LibraryQueryPage` 生成 schema/TypeScript/静态校验器。

- 请求：`folderId`（可空）、`folderScope`（children/subtree/all）、`query`、`tagIds`、`includeSummary`、`includeNote`、`offset`、`limit`、`expectedRevision`（可空）、`expectedSourceEpoch`（可空）。
- `limit` 为 1–200；`offset` 不超过 100000。后续页必须提供首屏所见 revision 和 sourceEpoch；标签 ID 不重复，最多64个。children/subtree 必须给有效目录 ID。
- 响应：`items`、`total`、`revision`、`sourceEpoch`、`offset`、`nextOffset`（末页为空）。结果按 Chrome 路径顺序及 chromeId 稳定排序；标题/URL 保持现有子串语义。
- Rust 在串行 SQLite worker 中查询游标、数量和页，范围、文本、标签取交集；标签/备注/摘要只查当前 Profile/epoch。默认不搜备注/摘要。镜像无侧车，以同一交互分页语义在已有镜像树上查询。
- 版本或世代不符返回 CONFLICT，UI 丢弃旧页并重新读取。本地元数据改变且影响当前筛选时也须重置分页，不能因 Chrome revision 未变沿用旧命中。
- 单条标签/AI保存使用成功回调；撤销和去重合并可能在Chrome事件之后、receipt处理中恢复侧车，此时Profile树revision已不再变化。现有全局BridgeState.revision作为侧车依赖查询的额外失效依据，标题/URL普通查询不受其影响。这是保守重取：其他资料的发布也可能使当前侧车筛选重新取页，不意味着跨资料数据混用；不通过刷新详情表单覆盖未保存草稿。
- `#library-search` 保持输入入口，`#library-scope` 提供全部/当前目录及后代；可显式加载下一页，Ctrl+End 可到未加载末页。多选标明已加载范围；保护节点不伪装可编辑目标。

以上是已批准父设计的具体参数约定，不改变树硬上限或写入授权。原生性能沿用 research/performance-baseline.md 的输入到结果计时，不能扣除请求/渲染等待。

## 变更责任

- apps/desktop/src/features/library/LibraryWorkspace.tsx
- apps/desktop/src/features/library/VirtualRows.tsx
- apps/desktop/src/features/library/model.ts
- apps/desktop/src/backend.ts
- crates/core/src/storage
- crates/protocol
- packages/protocol

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
