# 03 实施接口与分工

既有父设计与 02 wire v1 合同保持有效。本文固定 03 内部接口，供分层实施和集成检查使用。只读取 Chrome；浏览器写操作仍属 06。

## 桌面 IPC

Rust 在 crates/protocol/src/bridge.rs 定义 serde/schemars DTO；packages/protocol/src/bridge.ts 使用生成 schema 和 Ajv 校验。生成器增加 bridge-state 和 pairing-offer 两组输出。startup 输出保持不变；wire 只补齐官方 folderType 的 managed 枚举值，并生成 MV3 可用的 Ajv standalone 校验器。导出 BridgeState、PairingOffer、parseBridgeState、parsePairingOffer。

BridgeState 字段：protocolVersion=1、revision（进程内单调递增安全整数）、port（可空）、errorCode（可空安全错误码）、profiles、pending。

profiles 每项：profileId、instanceId、displayName、connection、nodeCount、revision（来源 revision）、lastSyncedAt（可空 UTC 毫秒）、errorCode（可空）。connection 取 unpaired、connecting、reconciling、live、cached_read_only、error。

凭据吊销后及重启加载已吊销资料时，connection 为 unpaired，仍保留缓存节点计数。正常断线且凭据有效为 cached_read_only。unpaired 不显示可用重连或吊销入口。listener 已启动后端口固定，界面不提供尚未实现的 listener 重启或端口切换。

pending 每项：profileId、displayName、instanceId（可空）、origin（可空）、expiresAt（UTC 毫秒）。只展示已经通过一次性凭据检查的候选扩展身份。

PairingOffer 字段：profileId、pairingCode、expiresAt。pairingCode 是 JSON 文本，字段固定为 protocolVersion=1、port、profileId、credential、expiresAt。credential 至少 192 bit 随机，120 秒有效；不进入 URL、日志、截图或导出。

命令均验证调用窗口为 main：

- get_bridge_state() → BridgeState。
- start_bridge(port) → BridgeState；默认端口由界面填入 49153，端口占用返回可读安全错误并允许重试。
- begin_pairing(displayName) → PairingOffer。
- confirm_pairing(profileId, instanceId) → BridgeState；必须匹配已验证候选身份。
- cancel_pairing(profileId) → BridgeState。
- revoke_pairing(profileId) → BridgeState；立即关闭连接、删除凭据、保留只读缓存。
- reconnect_profile(profileId) → BridgeState；校验前保持 reconciling/只读，不排队浏览器变更。

原生 bridge-state 事件只发给 main，payload 为 BridgeState。前端先订阅再读取状态，以进程 revision 忽略旧响应，卸载时退订。启动 DTO 保留现有入口。

## 配对和同步

扩展为每次连接生成 sessionId，Rust 绑定传输的真实 Origin、应用创建的 profileId、instanceId 和凭据。所有后续消息核对已认证 profile/session；错误认证不得产生缓存或身份写入。长期凭据只在确认后生成，桌面存 OS 凭据库，SQLite 仅存引用，扩展存 chrome.storage.local 并限制内容脚本访问。

未认证连接必须在 5 秒内关闭。桌面人工确认可能超过 5 秒：首个有效 pair 记录内存候选后，可用 accepted=false/errorCode=UNPAIRED 告知待确认并关闭连接；扩展在配对串有效期内按退避重试。桌面确认只批准该候选的 instanceId 与真实 Origin。后续 pair 校验同一凭据与候选后完成一次性兑换，不在等待期间留下无限期未认证连接。

扩展先顶层注册所有书签事件，再取树。快照期间的变更使快照失效，最多连续尝试 3 次，仍忙则保持 reconciling 并延迟重试。完整树带 barrier seq；增量 seq 连续，重复忽略，断档/乱序/import 结束/worker 或浏览器重启触发完整核对。每 5 分钟全量核对。SQLite 提交树与 cursor 后才发状态事件；丢失连接立即只读，只有成功核对后才 live。

SQLite source revision 由 Rust 根据已持久化 cursor 分配下一值，扩展快照的本地 revision 在重启后可以归零。扩展主动核对须先发 resync_required，由 Rust 发 get_tree；tree_full 必须应答当前 requestId。不能使用新的随机 requestId 提交未请求快照。

20 秒应用心跳；1/2/4/8/16/30 秒带抖动退避，alarms 至少 0.5 分钟/onStartup/显式重连负责持久恢复。扩展拒绝 apply_operation 等浏览器写命令。desktop 和 extension 均不调用书签写 API。

## 本机读取

`Bridge::tree`、`list`、`search`、`get`、`count` 只读该 Profile 已缓存的扁平节点。扩展继续用 `chrome.bookmarks` 把变更送入缓存。查询不回打浏览器。方法不进入产品 WebSocket，也不进入生成的协议 schema。不接入 MCP。不注册 Native Messaging host。不把 HTML 导入或导出当作读取路径。

## 实施分工

- Rust 实施代理：crates/core（bridge/sync、必要 storage API）、crates/protocol 与 packages/protocol 的新增 IPC DTO/schema、scripts/protocol.mjs、Tauri Rust 入口/依赖和 Cargo.lock。负责纯模块及真实 WebSocket 行为测试，并提供复用生产 Bridge API 的临时目录 stdio harness example，供真实临时 Chrome 检查；测试控制接口不进入产品 listener。
- 扩展实施代理：apps/extension、pnpm-lock.yaml、scripts/foundation.test.mjs 的扩展断言、scripts/check-artifacts.mjs 的扩展产物检查。沿用现有 wire v1 和上述配对串。负责 worker/options/action、有限权限、转换/恢复测试。
- 前端实施代理：apps/desktop/src、tests/e2e 和相关前端行为测试。消费上述 IPC/schema；不改 Rust、协议包、扩展或锁文件。
- 主会话：任务/父文档、spec、正式验收和独立检查协调。产品代理不互相覆盖文件；公共接口差异先沟通。

## 界面方向

视觉沿用现有 Segoe UI/Microsoft YaHei UI、灰绿背景和白色平面，单一全局 CSS，不新增样式依赖。内容为来源状态、端口、配对步骤、已配对资料节点计数与恢复操作。保留当前页眉、焦点和最小窗口范围；无装饰动画，仅按钮按压反馈。暂不实现 05 的书签工作台。

## 验收边界

自动测试、真实临时 Chrome 扩展、Tauri 原生交互分别记录。不得使用日常 Chrome 数据或已安装扩展；不安装到日常环境，不提交、归档或发布。01 原生交互保持 UNVERIFIED，除非获得新的实际证据。03 原生项缺证据时保持 NOT_RUN/UNVERIFIED，不启动 04。
