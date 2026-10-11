# Markbridge 技术设计

## 1. 技术选型与取舍

本方案拟采用 Tauri 2、Rust、React + TypeScript + Vite、pnpm workspace、SQLite/rusqlite（bundled）、tokio、reqwest、notify。扩展采用 MV3 + TypeScript + Vite，直接使用 Chrome API，先不增加 WXT。前端先使用 React 本地状态及单一订阅适配器，避免引入多个全局状态库。列表使用成熟虚拟化组件；实际版本由 01 锁定在 lockfile。

Rust serde DTO + schemars 生成 JSON Schema，TypeScript 类型由 schema 生成，运行时以 Ajv 校验边界。共享协议包放在 packages/protocol，Rust 类型放在 crates/protocol。CI 检查生成结果无漂移。SQLite 由后台单一存储工作线程持有连接，异步调用方不阻塞 tokio。

最低实施目标建议 Windows 11 x64，当前稳定 Chrome 且最低 134；Chrome 134 提供更明确的浏览器根目录属性。其余 Windows 架构与 Windows 10 不在首版原生验收声明中。M5 单独适配 macOS/Linux。没有已安装依赖或现有版本基线；01 创建后需在 README 固化实际支持版本。

最小方案是扩展读写 + 本地树 + 人工编辑。用户已要求两种预览和 AI，因此分阶段扩展该闭环。纯文件读写方案不能满足安全写回；Native Messaging 需额外桥接进程和系统注册，首版采用已在参考方案中的 loopback WebSocket。完整网页采用独立 WebviewWindow，避开多子 WebView 的实验性 API；同窗口网页分栏另需明确改变该决定。

## 2. 组件与数据流

```text
Chrome bookmark tree <--> MV3 extension <--> authenticated loopback WS
                                                 |
                                          Rust application
                               +-----------------+------------------+
                               |                 |                  |
                         SQLite + journal   safe fetch + AI    readonly file watcher
                               |
                         typed Tauri IPC
                               |
                        trusted React UI
                               |
                      Rust-owned preview window
                     remote WebView, no app permissions
```

只读文件监听永不成为写回通路。网页脚本和模型输出均属于不可信输入。Chrome 的外部修改通过扩展事件进入缓存，不通过前端乐观状态直接确认。

拟建目录：apps/desktop/src、apps/desktop/src-tauri、apps/extension、crates/core、crates/protocol、packages/protocol、tests/fixtures、docs。上述目录尚不存在，不在规划阶段创建应用骨架。

## 3. Profile 与身份

应用创建 profileId；扩展首次安装生成 instanceId 并保存在 chrome.storage.local，禁止存 chrome.storage.sync。凭据绑定 profileId + instanceId + 已配对扩展 Origin。扩展不能通过 profile: Default 的自报字符串获得其他 Profile 权限。

浏览器缓存以 (profileId, sourceEpoch, chromeId) 唯一，侧车通过本地 bookmarkId 关联。Chrome ID 重启可用，但删除重建/扩展重装/资料重置不保证原身份。重新配对创建新身份；旧侧车保留供显式关联，不按 URL 自动合并。同 URL 多书签各自保留标签和历史。

文件来源为独立 mirrorSourceId，记录用户选择的 Profile 路径。扩展 API 不提供磁盘 Profile 路径。只有用户明确关联且完整树结构/ID/URL 一致才允许建立文件与在线来源的映射。匹配不确定时保持独立只读来源，不借此写回。

## 4. 配对、连接与协议 v1

桌面仅监听 127.0.0.1；提议默认端口 49153。端口占用显示错误并允许在配对页面更换，扩展由配对串获得准确端口，不扫描端口。生成至少 192 bit 随机的一次性配对凭据，有效期 120 秒，用户复制到扩展选项。桌面显示新扩展身份并确认一次，完成后换发可吊销的随机长期凭据。

初始连接只允许 chrome-extension:// Origin 和限速的配对消息；已配对连接还必须匹配保存的 Origin 和凭据。5 秒内未认证则断开；普通网页 Origin、缺失 Origin、错误凭据拒绝。令牌不进入 URL、日志或导出。长期凭据存 OS 凭据存储；扩展凭据存本机 extension local storage，限制内容脚本访问，不声称能抵抗同用户权限恶意进程。

消息 envelope 包含 protocolVersion、type、profileId、sessionId、requestId（命令/应答）、seq（事件）。连接重建产生新 sessionId；旧 session 消息丢弃。Chrome ID 保持字符串。已认证后协商版本，未知写命令与不兼容主版本拒绝。

- 配对/连接：pair、pair_result、hello、hello_result、ping、pong。
- 同步：get_tree、tree_full、event、resync_required。事件明确区分 created/changed/moved/removed/reordered/import_began/import_ended，各自携带完整所需字段。
- 写入：apply_operation、operation_receipt、get_operation_status。每个子操作有独立 requestId、kind、目标、expectedBefore 和 payload。
- 导出由桌面完成，协议不伪造 Chrome export_html API。

初版限制单帧 16 MiB、树最多 100,000 节点、深度 256、单字段长度和数组数量；超过限制返回明确不支持且保留旧缓存，不截断为成功。主验收数据量 10,000。边界值写入 schema 并有测试，后续调整需同时更新文档与门槛。

在线每 20 秒应用级心跳；在 worker 活跃期间以 1/2/4/8/16/30 秒带抖动重连。注册 alarms 和 onStartup 唤醒，恢复时确认 alarm 存在；至少 0.5 分钟周期只负责后台唤醒，不能承诺断线 3 秒内恢复。提供显式重新连接按钮。

## 5. 一致性与恢复

扩展在开始取树前注册事件监听。记录 getTree 前后事件世代；读取期间发生变更则丢弃该次快照并在短暂安静期重新取树，最多连续 3 次，仍忙时保持 reconciling 并延迟重试。成功快照带 barrier seq，此后只应用更大且连续的 seq。出现断档、未知父节点、导入结束、worker 重启或恢复前台时请求全量校验。在线每 5 分钟执行全量核对。

SQLite 在单事务中提交树和 sourceRevision，然后向前端发布 revision 事件。UI 先订阅再加载快照，按 revision 忽略重复、发现缺口重取。浏览器确认的状态是展示基础，待执行草稿单独保存。

只读监听父目录以兼容 Bookmarks 原子替换，300 ms 去抖、失败重读保持上次有效树；每 30 秒校验元数据并在唤醒后重扫。读取 Chrome Local State 时只取 profile 显示信息，不导出其他隐私。在线来源优先于关联文件来源，切换来源始终显示来源和时间。

所有在线写操作要求状态 live、profile 一致和预览基础有效。离线可编辑标签/备注、查看缓存；首版不排队离线浏览器写命令，避免重连后隐式回放。恢复后用户重新确认提案。

## 6. 数据模型

| 表 | 关键字段与约束 |
|---|---|
| profiles | id、instance_id、source_epoch、display_name、pairing_state、last_synced_at；秘密仅存凭据引用 |
| mirror_sources | id、用户选择路径、可空 paired_profile_id、association_status |
| bookmarks_cache | bookmark_id 主键、profile_id、source_epoch、chrome_id 唯一组合、parent_id、position、node_kind、原始 title/url、folder_type、unmodifiable、revision、deleted_at |
| bookmark_metadata | bookmark_id 主键、display_title、summary、note、updated_at；不存模型密钥 |
| tags / bookmark_tags | 标签名称和规范化名称、bookmark_id/tag_id 联合唯一 |
| source_cursors | profile_id、session_id、last_seq、revision，与树更新同事务 |
| preview_cache | bookmark_id、url_fingerprint、status、safe metadata/text excerpt、image reference、fetched_at、size |
| operations / operation_steps | operation_id、profile_id、state、before/after、expected_before、request_id、receipt、ordinal |
| snapshots | operation_id、schema_version、tree/metadata before-state、created_at、backup_path |
| ai_jobs | id、kind、profile_id、input_fingerprint、model/provider reference、state、proposal、error_code |
| settings | 非敏感配置、端点引用、标签编码模式、缓存上限 |

foreign_keys 开启，WAL，参数化 SQL，编号 migration。批量写事务不跨网络等待。迁移前一致性备份；失败不重建空库。用户可清除预览缓存和 AI 派生数据；历史保留最近 100 次已完成操作/快照，未解决操作永不自动清理，清理前显示后果。预览缓存上限建议 200 MiB，最近最少使用淘汰。这些为实现常量，不增加大量设置入口。

## 7. 人工编辑、标签与操作日志

支持书签/文件夹创建、改名、书签 URL 修改、同 Profile 移动、同父排序和删除。动态保护 root、folderType、managed 及不可写后代。禁止移动到自身或后代。跨 Profile 移动不在首版范围。

任何浏览器变更先创建 proposal；普通单条可在编辑表单中直接看到差异并按保存确认。删除与批量操作显示受影响数量；大范围删除需二次确认。apply 前写 snapshot、Netscape HTML 备份与 sidecar JSON 备份；备份失败禁止浏览器变更。单条操作也记录最小 before-state。

同 Profile 单队列串行执行。扩展执行前重读目标检查 expectedBefore，执行后验证字段和顺序；Chrome 没有 CAS，仍可能出现外部并发窗口。发生冲突立即停后续步骤并要求审查，不声称事务隔离。桌面 UI 的写锁不能锁住 Chrome/Floccus。

操作状态 planned → applying → applied；中断进入 uncertain/partial/failed；撤销为 rolling_back → rolled_back 或 rollback_conflict。ack 丢失后查操作回执和新树，不能直接重放 create/delete。扩展在 chrome.storage.local 保留最近 1,000 条回执，进行中的条目不淘汰。重启时无回执且状态无法唯一判定则人工审查。

撤销只恢复当前仍匹配本操作 after-state 的字段。外部变更作为冲突保留。顺序以稳定同父节点序列和锚点恢复。撤销删除会创建新 Chrome ID，记录旧新映射并恢复 sidecar；不保证恢复原 ID。批量恢复目标为语义树和兄弟顺序一致。

标签默认本地存储。新增/重命名/合并/移除标签可撤销，按规范化名称去重但保留显示名称。启用标题编码先显示变更预览；选择应用到哪些书签，不自动改全库。格式采用名称 | tag1 | tag2，对应用产生的分隔符和反斜线做可逆转义，同时保存 rawTitle 与 lastEncodedTitle；未经用户认领的现有竖线不拆标签。外部标题改变时转冲突，不反复追加后缀。

## 8. 两种预览

内容预览在用户选中后去抖 200 ms 请求，只处理当前选中项；默认不批量访问全部站点。使用 Rust reqwest 抓公开 HTTP(S) 页面、解析可见正文和 Open Graph/description 元信息；选用 Rust 解析库，避免额外 Python 服务。缩略图为来源站点的 og:image 等元图，标明来源，不声称是实时截图。无图显示站点图标或空态。

每次请求与重定向校验 scheme、userinfo、解析后的 IP；拒绝 loopback、私网、链路本地、组播与云元数据地址。绑定本次已校验解析结果，防止 DNS 重绑定；最多 5 次跳转、10 秒总超时、5 MiB 解压后正文、2 MiB 图像。预览图片同样经过后台代理限制。Ollama loopback 是独立用户配置端点通路，不复用公共网页抓取权限。

抽取结果仅按文本呈现。登录/动态页面失败显示原因，可要求用户在 Chrome 扩展点击采集当前页；用户手势加 activeTab+scripting，采集前显示将传回的文本范围。桌面按钮不能隐式注入任意标签页。禁止后台遍历 Cookie 或采集密码输入框。

完整网页以 Rust 创建的固定前缀 preview-* WebviewWindow 显示。窗口独立数据目录，与可信 app WebView 和 Chrome Profile 分开。用户在该窗口自行登录；不承诺共用 Chrome 登录态。可信主窗口提供当前 URL、刷新、前进/后退、打开 Chrome、关闭及清除预览会话控制，远程页无权限控制应用。

只允许 HTTP(S) 初始/后续导航，拒绝 file/javascript/data 和外部协议；弹窗/下载默认拦截或返回可信主窗口明确确认。不给 preview-* 任何远程 capability，不用通配 window 权限；敏感命令再校验可信 main 标签。网页预览会访问所选站点并可执行站点脚本，首次使用有明确说明。预览浏览器的子资源不等同于受限的后台抓取沙箱；其安全边界是原生浏览器隔离与应用 IPC 隔离，不承诺完整网络沙箱。

## 9. AI 单条与批量

AI 默认关闭；端点、模型和凭据由用户配置。支持 Ollama /api/chat 及兼容 Chat Completions 的端点，不能承诺所有兼容服务的扩展能力。先测试能力：schema 支持则使用；否则 JSON 输出加本地校验。配置明确路径拼接，避免重复 /v1。远程端点使用 HTTPS，本地 Ollama 允许 loopback HTTP；不自动发现或调用远程账号。

密钥存 Windows Credential Manager；macOS/Linux 在 14 适配原生存储。不把密钥发到 React/扩展。请求前展示目标端点、模型、条目数和内容范围；一次确认仅授权当前作业。批量只发送选中范围的必要标题、URL 和路径，不发送整个库或笔记。页面文本属于数据，不服从其中的指令，不授予模型工具执行权。

单条 schema：title <= 60 Unicode 字符、tags 最多 3 个且每个 <= 8 字符、summary <= 1,000 字符、suggestedFolder 可空。证据不足允许空标签和明确缺失摘要；未知字段拒绝。最多 1 次格式修复；429 尊重限流提示，超时/取消不自动创建新费用作业。摘要保留证据片段和来源时间。AI 结果可编辑，应用走 06 的操作日志。

批量：在用户选定范围采样（最多 200 条）提议 8–12 类，条目少时允许更少；用户确认分类目录后，以每批 25 条、并发 2 生成分配。输出必须引用已有输入 ID 或已审查新目录 ID；每条出现一次且不能发明输入。预览支持单条拒绝/改目标、汇总数量与来源→目标。apply 前检查版本并保存快照，串行创建目录和移动。取消停止后续步骤，已写入记录保留。删除/空目录清理另行审查。

本地模型只有在运行服务及模型已准备时才能离线推理；已缓存正文可离线使用，新网页抓取仍需网络。

## 10. 优化与后续范围

重复项首版按严格 URL 等价分组：仅解析器标准化 scheme/host/默认端口，不删 query/fragment、不改路径。死链使用受限 fetch，HEAD 失败可尝试小体积 GET；403、429、超时和登录要求为 unknown。404/410 复查后才列为候选，绝不自动删除。摘要搜索采用 SQLite FTS5 并验证中文子串检索；trigram tokenizer 不足 3 字符的查询用普通子串查询补充，标签检索使用关联表。

向量检索在 15 显式启用：只用用户选择的本地 embedding 模型，记录模型名/维度/版本；索引可重建和删除，模型变更不混用向量。首版不引入向量服务。

## 11. 失败与撤回

代码回退不等于撤回浏览器变更。已应用操作须通过历史记录条件回滚；已有新外部修改不能强制覆盖。数据库升级有前置备份，旧版本不读取更高 schema。配对可以吊销，停 listener 后缓存和本地标签仍可用。

最脆弱前提是扩展保持可用。设计以缓存只读、显式断线状态、持久唤醒和全量校验应对该前提失效。其他成本包括用户安装扩展、首次配对、模型配置和网页独立登录。首版不安装系统服务，不注册 Native Messaging host，不发布公共服务。
