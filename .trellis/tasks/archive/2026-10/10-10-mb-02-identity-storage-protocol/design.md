# 02 Profile 身份、存储与共享协议：设计

## 当前与边界

02 的协议与独立存储源码已实现，检查证据见 evidence/receipts.md。GUI 仍保持 01 的未配对空状态；02 不打开日常数据库或连接 Chrome。

crates/protocol、crates/core/src/storage（含 migrations）、packages/protocol、scripts/protocol.mjs、tests/fixtures/protocol

## 技术合同

按父设计第 3–6 节建模。Rust DTO 为 schema 来源，TS 生成类型加 Ajv 边界校验。数据库缓存和 source cursor 在同事务提交；侧车 bookmarkId 独立于 Chrome ID。操作/快照表预留父设计已明确的字段，不提前实现未需要的服务接口。profileId/sourceEpoch/chromeId 唯一，mirrorSourceId 独立。rusqlite 专用工作线程串行持有连接，WAL 和 foreign_keys 打开。凭据表只存引用。Chrome 时间与文件时间先归一为带来源的 UTC，不能混用 epoch。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

02 在 `crates/core/src/storage/` 持有数据库工作线程和编号 migration，供后续桌面适配器调用；02 不为 GUI 打开数据库。工作线程接收有限队列请求，异步调用方通过 oneshot 等待回复。

协议使用顶层 `type` 判别枚举和 `payload`。每个消息保留 `protocolVersion/profileId/sessionId/requestId/seq`；命令和应答的 requestId 必须有值，其他消息的 requestId 为 null；事件的 seq 必须有值，其他消息的 seq 为 null。两个字段不得省略。pair 的 profileId 是桌面创建的拟配对身份，自报字段不能建立认证。03 负责真实绑定。

v1 限额：帧为 16 MiB UTF-8；树最多 100,000 节点、256 层（根为第 1 层）；ID 为 1–128 ASCII 字符 `[A-Za-z0-9][A-Za-z0-9._:-]*`，schema 使用严格末尾断言拒绝尾部换行；title 为 0–4096 Unicode 标量；URL 为 1–16384 标量；displayName 为 1–128 标量；凭据为 32–1024 Unicode 标量；每个 operation 最多 1000 步；序号和 revision 为 0–9007199254740991，sourceEpoch 从 1 开始，position 为 0–100000。原始 URL 保留浏览器数据，导航权限由后续任务校验。

节点保存可空 folderType/unmodifiable 与带来源的 UTC unixMillis。Chrome API 时间已是 Unix 毫秒；文件时间为自 1601-01-01 起的微秒，显式转换后保存。树检查拒绝重复 ID、缺父节点、环、过深树、非文件夹父节点及重复兄弟位置，不要求固定根数量或固定 folderType 数量。

03 集成修正：folderType 的合法值为 bookmarks-bar、other、mobile、managed。02 历史实现遗漏 managed；03 同步补齐 Rust、schema、TypeScript 和双语言/存储回归样本。02 的旧收据仅证明当时源码，修正后的结果归 03 收据。

数据库 v1 建立身份、缓存、侧车及来源游标；v2 建立父设计要求的操作/快照和后续派生数据字段。已有版本升级前使用 SQLite backup API 生成不覆盖旧文件的一致性备份，全部待执行 migration 在一个事务中完成。高于当前版本的库直接拒绝。缓存替换使用同一个事务保存节点、tombstone 和 cursor，保留 bookmarkId 及侧车；新 sourceEpoch 分配新 bookmarkId。

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

此任务的核心验收是协议和临时 SQLite；实际 Chrome 身份在 03 的双 Profile 验收，记录为本任务尚未覆盖的运行边界。

## 故障与回退

迁移前复制一致性备份；回退版本不能读取较新 schema。禁止删除现有库来通过测试。

## 已实现的顺序与认证存储字段

OperationStep 的 expectedChildIds 在 reorder 时必须提供唯一、最多 100,000 项的旧同父序列，expectedBefore 必须为目标 folder；目标 childIds 必须为相同集合。其他 mutation 不携带 expectedChildIds。Receipt 的 beforeChildIds/afterChildIds 记录观察序列，存在时必须关联对应 folder before/after；不确定结果允许 after 缺失。02 仅定义和校验这些字段，执行与回执观测属于 06。

profiles 保存 paired_origin 与 credential_reference；PairedOrigin 只接受完整 `chrome-extension://` Origin 和 32 位 a–p 扩展 ID。Origin 必须由 03 从传输层取得，hello 自报字段不能建立认证。SQLite 不保存凭据值。

Rust 与 TypeScript 的帧入口都会执行结构和语义校验。TS 额外拒绝单独 UTF-16 surrogate。共享 acceptance corpus 对 47 个消息或边界样本实测两种语言的接受/拒绝一致，包括 `1.0`、`1e0` 的合法整数表示和空事件的额外字段拒绝。Rust fixture 由 wire-fixtures 的 typed DTO 现场序列化；TS typed fixture 现场序列化到临时文件后由 Rust 读取并重新编码。
