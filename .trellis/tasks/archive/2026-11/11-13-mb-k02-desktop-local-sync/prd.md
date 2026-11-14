# K02 桌面端本地书签库展示与数据库实时感知

## 目标与前置条件

交付父任务 [11-13-mb-skill-bookmark-db](../11-13-mb-skill-bookmark-db/prd.md) 的 R3（桥接与前端部分）与 R4：在可信桌面协议引入 `BridgeConnection::Local`，使 `Bridge` 支持加载/按需创建 `local-skills`、硬拦截任何发往浏览器的写命令与配对操作，并通过 `notify` 监听 `markbridge.sqlite` 变更及窗口 `Resumed` 重扫实现外部 CLI 写入后的桌面端免重启实时刷新。

- **启动前置条件**：[K01](../11-13-mb-k01-local-skill-cli/prd.md) 全部自动检查与阶段收据 PASS。

## 需求范围

1. **K02-R1（可信桌面协议扩展）**：
   - 在 `crates/protocol/src/bridge.rs` 的 `BridgeConnection` 新增 `Local`（`"local"`），执行 `pnpm protocol:generate` 同步更新 Schema、TS 类型与静态校验器，`pnpm protocol:check` 通过。
2. **K02-R2（`Bridge` 本地空间加载、保护与实时监听）**：
   - `Bridge::open_with_ai` 将已存在的 `ProfileOrigin::LocalSkills` 加载为 `BridgeConnection::Local`；空库未初始化时不自动创建，保持 `profiles: []`。
   - 新增 `Bridge::ensure_local_library()` 及主窗口 Tauri 命令 `ensure_local_library`。
   - 对 `local-skills` 硬拦截：`revoke_pairing`、`reconnect_profile`、`associate_file_mirror`、`apply_edit`、`apply_batch_edit`、`preview_title_encoding`、`apply_title_encoding`、`propose_organization`、`apply_organization`、`confirm_cleanup`、`TagCommand::SetEncoding` 均返回 `ErrorCode::ReadOnly` 或 `WrongProfile`；`preview_edit` / `preview_batch_edit` 返回 `writable: false`。
   - 本地只读与侧车能力正常开放：`tree`、`list`、`query_library`、`search`、`get`、`count`、`tag_state`、`tag_command`（标签增删改查合并与备注写入）、`search_text`、`content_preview`、`open_web_preview`、`export_html`、`export_sidecar`。
   - `Bridge` 在数据库父目录挂载非递归 `notify` 监听（过滤 `markbridge.sqlite*` 文件事件，120ms 防抖）并在 `RunEvent::Resumed` 调用 `reload_local_space()`：当 `local-skills` 新出现或 `source_cursors.revision` 变化时自动热更新 `ActiveProfile` 并广播 `bridge-state`；`Bridge::shutdown()` 干净释放 watcher 句柄。
3. **K02-R3（桌面端 UI 适配与首次引导保持）**：
   - 适配 `source-status.ts`、`App.tsx`、`LibraryWorkspace.tsx`、`ConnectionSettings.tsx` 与 `backend.ts`：
     - 清晰展示 `本地书签库` 状态文案；
     - `ConnectionSettings` 对 `local` 来源隐藏“重新连接”与“吊销配对”，从镜像关联下拉框过滤掉 `local` 来源，并在未启用本地库时提供“启用本地 Skills 书签库”按钮；
     - `LibraryWorkspace` 在 `local` 来源下隐藏针对 Chrome 的结构写入口（新建/编辑/批量移动删除），完整保留浏览、搜索、标签过滤、标签/备注编辑、内容/网页预览与导出。

## 验收标准

- [x] **AC-K02-1**：`pnpm protocol:check` 零漂移；未初始化 `local-skills` 的全新空库仍正常进入首次连接引导页，既有 `shell.spec.ts` / `workspace-layout.spec.ts` 通过。
- [x] **AC-K02-2**：模拟已配对 Chrome Profile 执行 `TreeFull` 与增量同步不影响同库内的 `local-skills`；对 `local-skills` 调用任何浏览器写回/配对管理/标题编码命令均被拒绝且不访问系统凭据。
- [x] **AC-K02-3**：`Bridge` 开启期间，外部执行 `markbridge-skill` 向同一临时 `markbridge.sqlite` 初始化或新增/修改书签后，`Bridge` 订阅通道在无需重启的情况下自动收到新 `revision` 与更新后的书签树，且 `Bridge::shutdown()` 后临时目录可立即完整删除。
- [x] **AC-K02-4**：连接设置页可一键启用并跳转浏览 `Skills 书签库`，`local` 卡片不显示“重新连接/吊销配对”；`cargo test --workspace`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过。

## 不在范围

- `.agents/skills/qiaomu-markbridge-bookmarks/` Skill 包编写与评估门禁（归属 K03）。
