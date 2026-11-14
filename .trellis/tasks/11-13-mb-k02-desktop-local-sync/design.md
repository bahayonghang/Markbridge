# K02 技术设计（桌面端本地书签库展示与数据库实时感知）

## 1. 协议与后端桥接（`crates/protocol` & `crates/core/src/bridge`）

- **`BridgeConnection::Local`**：仅在桌面端 IPC 模型 `crates/protocol/src/bridge.rs` 增加枚举分支 `Local`，通过 `scripts/protocol.mjs` 重新导出 schema、TS 类型与静态校验器。MV3 扩展只依赖 `wire.rs`，无协议破坏。
- **外部 SQLite 变更监听（`crates/core/src/bridge/local_watch.rs`）**：
  - 使用 `notify::recommended_watcher` 监听 `db_path.parent()`（`RecursiveMode::NonRecursive`），仅当事件路径文件名为 `markbridge.sqlite`、`markbridge.sqlite-wal` 或 `markbridge.sqlite-shm` 时向单容量 `mpsc::channel(1)` 发送唤醒信号。
  - 后台协程收到信号后 `tokio::time::sleep(Duration::from_millis(120))` 合并连续 WAL 帧，随后调用 `bridge.reload_local_space().await`。
  - `reload_local_space` 在不阻塞网络锁的前提下通过 `Storage` 读取 `local-skills` 当前状态（是否存在、`source_cursors.revision`、`last_synced_at`、当 `revision` 变化时才加载完整 `BookmarkNode` 列表），获取 `self.inner.lock().await` 后对比内存中的 `local-skills` 版本，仅在确实新增或 `revision` 增长时替换 `ActiveProfile.nodes` 并调用 `self.publish(&mut inner)`。
  - `Bridge::shutdown` 先通过 `watch::Sender<bool>` 停止监听协程并 `await` `JoinHandle`（drop `RecommendedWatcher`），再关闭 `Storage`，确保 Windows 下临时目录立即可删。

## 2. 前端适配（`apps/desktop/src/`）

- `backend.ts`：新增 `ensureLocalLibrary(): Promise<BridgeState>`，调用 `invoke('ensure_local_library')` 并经静态 validator 校验返回 `BridgeState`。
- `source-status.ts`：补齐 `connectionLabels.local` 与 `profileNextStep('local')` 分支，保证 TypeScript 穷举检查通过。
- `ConnectionSettings.tsx`：
  - 将 `isLocal = profile.connection === 'local'` 抽出：隐藏重新连接/吊销配对按钮；镜像关联下拉列表仅渲染 `!isLocal` 的已配对 Chrome 资料；
  - 当 `!state?.profiles.some((p) => p.connection === 'local')` 时，在资料区域或本地来源卡片提供“启用本地 Skills 书签库”按钮（不影响 `onboarding` 默认双入口，保持首次引导测试契约稳定）。
- `LibraryWorkspace.tsx`：
  - 当 `profile?.connection === 'local'` 时，`canEditBrowserTree = false`（禁用/隐藏新建文件夹、新建书签、编辑属性、批量移动删除等走 `chrome.bookmarks` 的入口），保留 `TagDesk`（标签与备注）、搜索、预览与导出。
