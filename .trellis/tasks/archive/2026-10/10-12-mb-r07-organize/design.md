# R07 设计

## 方法与边界

只重组现有MaintenanceDesk/OrganizationDesk/AiSuggest交互，不重新实现引擎。范围由R03稳定ID传入后端复核，任务状态与视图卸载分离，未确认方案仍受revision约束。删除/空目录清理继续各自确认。AI密钥不进入React受控状态/日志。

初次提出目录原先必须等模型返回才能拿到 jobId，因而无法及时取消。R07 的窄接口扩展为 `propose_organization(profileId, chromeIds, requestId?)`：前端提供唯一请求 ID，Rust 以此绑定持久 job 和既有 AI cancellation gate；`cancel_ai(requestId)` 可以在首轮响应前中止。旧省略参数的调用继续生成 ID，响应仍为既有 OrganizationPlan，不变更 wire/DTO 或执行引擎。已确认写入只能停止尚未执行步骤，不能声称取消撤回全部效果。

## 变更责任

- apps/desktop/src/features/ai/AiSettings.tsx
- apps/desktop/src/features/ai/AiSuggest.tsx
- apps/desktop/src/features/organization/OrganizationDesk.tsx
- apps/desktop/src/features/maintenance/MaintenanceDesk.tsx

同目录其他能力由对应子任务负责；一次只实施本项。协议变化同时改Rust源/schema/TypeScript及运行时校验，复用现有错误类型。所有跨Profile/异步场景以父设计身份规则处理。

## 兼容与回退

遵守[父设计](../10-12-mb-workspace-redesign/design.md)；不删除现有数据。新增迁移先备份；取消请求或回退代码不等于撤回已执行操作。界面在小窗/只读/错误态不隐藏唯一恢复入口。

初次请求使用唯一 gate 注册，重复运行中的 requestId 返回 Conflict，不覆盖原取消标识。准备失败或完成后按 flag 身份释放，旧任务不能删除新的注册。取消值在 watch 尚无订阅者时仍须保留，晚到有效模型结果也不能重新激活方案。
