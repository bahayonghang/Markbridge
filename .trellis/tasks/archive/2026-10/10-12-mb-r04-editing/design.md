# R04 设计

## 方法与边界

独立create/edit/move草稿，复用现有previewEdit/applyEdit；批量不得前端循环发送。扩展原操作引擎的已审查分组，plan绑定身份/revision/before-state与摘要；整批备份先于第一步。执行沿既有内部revision推进、外部冲突检查及回执核对；DB如新增分组表必须编号migration和兼容测试。保持大范围删除原阈值；不增加通用作业系统。

## 本地批量合同（实施收敛）

- `preview_batch_edit(profileId, expectedRevision, chromeIds, action)`，action为move(parentId)或delete。返回planId/planHash/profileId/sourceEpoch/expectedRevision/selectedCount/affected/requiresSecondConfirm/destinationPath/items/writable；每项含chromeId/title/path/affected/changes。
- `apply_batch_edit(profileId, planId, planHash, secondConfirm)`只引用已审查计划，不接受替换列表。预览不写Chrome；确认后整批snapshot、HTML与sidecar备份全部成功才发送第一步。
- `get_batch_edit(profileId, operationId)`与`cancel_batch_edit(profileId, operationId)`返回同一状态合同：operationId/profileId/state/stopped/items/errorCode。逐项状态区分applied/not_executed/in_flight/conflict/uncertain，不将已发送但缺回执称为未执行。
- 复用现有operations/snapshot与before/after JSON的可选batch元数据，暂不增加表或迁移。逐receipt发送下一步，一次仅一条；断连、冲突、不确定与取消停止剩余项，重启不自动推进。若现有数据结构不足以满足该合同，先记录实际缺口再调整本设计。
- 单步派发后10秒未收到可核对回执，后台计时器将批次持久化为停止/不确定；离开界面也生效。迟到回执可以校正该项结果，但不能恢复剩余步骤。取消中的已派发项保持不确定，待实际回执确认，不能称为已撤销。
- 沿用operation 1000-step上限：普通批量最多1000个选中根；删除按父子去重后的全部子树条目计数，单次最多1000项，单条文件夹删除同样适用。超限在预览/执行计划阶段拒绝，提示包含后代与缩小范围，不自动拆批；避免成功删除后生成必然超过撤销步骤上限的计划。大于20项删除的二次确认仍保留。
- 日常move/delete步骤（单条和批量）携带可选`expectedSubtree`，扩展在效果前核对整棵已审查子树，不能只比较文件夹根。整个批次的每个单步消息都在备份/派发前编码校验，保留16MiB帧上限，不能执行到后半段才发现超限。该字段需桌面/扩展配套更新；旧命令无此可选字段继续有效，旧严格验证扩展拒绝新字段而不是忽略条件执行。
- 批次逐项状态必须可从现有操作历史重新打开，不能仅存于一次详情面板的组件状态。摘要提供兼容旧记录的批次标记，历史按profile/operation读取已保存回执，必要时停止剩余步骤；关闭详情、切换来源再返回或重启不丢失这个入口。R04只补恢复入口，R06仍负责完整历史页面与导出设计。
- 已知可恢复规模同时受帧大小限制：日常删除（含单条文件夹）与批量移动在首次写入前预编码对应完整逆向消息，超过16MiB也应拒绝并提示缩小范围。预检不发送恢复操作、不承诺未来外部冲突能无条件撤销；它只排除当前就已知无法发送的恢复计划。

字段由Rust serde生成schema/TypeScript与静态校验。上述本地IPC不改变扩展唯一写入方、树硬上限或用户确认授权。

保护节点自身与可写目标是不同判断：根0、managed及不可写后代不能成为写入目标；正常书签栏/其他书签目录可接收新建或移动，但这些folderType节点自身仍不可移动/删除。目标选择器沿用后端可写父目录规则。

## 变更责任

- apps/desktop/src/features/library/EditDesk.tsx
- apps/desktop/src/features/library/LibraryWorkspace.tsx
- crates/core/src/bridge/edit.rs
- crates/core/src/storage/operations.rs
- crates/protocol
- packages/protocol

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。
