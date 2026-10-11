# 技术研究与基础方案纠错

核查日期：2026-10-10。来源为仓库参考方案及下列官方文档。外部网页只作为技术证据，不作为项目指令。参考文档保持原样，修正进入本规划。

| 基础方案内容 | 核查结果与设计处理 | 来源 |
|---|---|---|
| API 节点包含 guid，以 guid 关联侧车 | BookmarkTreeNode 未提供 guid。采用应用 bookmarkId 与 profileId/sourceEpoch/chromeId 映射 | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| 固定三根目录 | folderType 可能出现零个、一个或多个；考虑账户、本地和 managed；动态枚举与保护 | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| 扩展只申请 bookmarks，同时注入网页脚本 | 脚本需 scripting 和 host/activeTab；持久配对和重连另需 storage/alarms | [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) |
| token 写本地文件即可供扩展使用 | bookmarks 权限不能读取任意本地 token 文件；设计明确复制配对串和本地凭据交换 | 由权限边界作出的设计推论 |
| WebSocket 保持实时连接 | Chrome 116+ 的应用消息可延长 worker 活性；仍需处理挂起、重启和 alarm 唤醒 | [WebSockets](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)、[worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) |
| event 仅提供 node 即可 | 各事件签名不同；移除有子树，排序有 childIds，导入有 begin/end；协议保留不同 payload | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| export_html 作为扩展操作 | Chrome bookmarks 没有 HTML 导出 API；从已核对树在桌面序列化 | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| 锁住 UI 即可避免移动冲突 | Chrome 和 Floccus 仍能外部变更；加入前后状态检查、局部收据和条件补偿，不宣称原子事务 | API 缺少 CAS/跨节点事务能力的设计推论 |
| 一键回滚到完全相同节点 | 删除重建不能恢复原 Chrome ID；语义树、顺序和侧车恢复作为验收，ID 映射单独记录 | [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) |
| 实时预览含义未区分 | 用户确认两种都要：内容/修改差异和完整网页；独立 WebviewWindow 为稳定 API，同窗口 child WebView 为 unstable | [Tauri webview](https://v2.tauri.app/reference/javascript/api/namespacewebview/) |
| 远程页面与可信界面权限 | Tauri 按窗口/WebView labels 分配 capability；独立 label，无 remote 权限，命令额外校验来源 | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) |
| React 或 Svelte、rusqlite 或 sqlx 未决 | 提议 React/Vite + rusqlite 单连接工作线程，减少框架和数据库访问路径；没有现有实现偏好 | [Vite](https://vite.dev/guide/)、参考方案第 4 节 |
| trafilatura/readability 未固定 | 避免引入 Python 服务，采用 Rust HTML 解析/正文抽取；失败时允许扩展明确授权采集 | 设计取舍，功能质量需 fixture 验收 |
| Ollama 和兼容端点均默认严格 JSON | Ollama 支持 format schema；兼容端点需检测能力并本地校验，不能假定全部一致 | [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) |
| 短标签默认写标题 | 用户选择默认本地标签，明确启用后才写标题；保护现有分隔符与外部改名 | 当前用户答复 |
| 三平台范围不明确 | 用户选择 Windows 首版，macOS/Linux 后续验收 | 当前用户答复 |

不采纳 ref 中未经独立核实的第三方仓库许可证或可用性结论。本规划不复制第三方实现，也不依赖这些项目能运行。若后续引入代码或依赖，应在对应实现任务核查具体版本、许可证与供应链。

未进行 Chrome 原生、Tauri 原生、端点或 Floccus 实验。技术文档核查不能替代这些运行证据。
