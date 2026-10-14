# 13 Windows 集成验收与本地安装包：设计

## 当前与边界

该子任务已实施诊断与集成修复，正在完成当前版本验收。路径表示本任务修改范围；结果以当前原始收据、独立检查和 task.json 为准，实际模型缺口不代表任务完成。

Windows 集成测试/harness、docs/用户指南、README、Tauri bundle 配置、CI、evidence/、本地构建产物清单

## 技术合同

执行父 verification.md V01–V15，保留 V16 的独立 Floccus 证据边界。安装包目标 Windows x64 NSIS；是否签名在发布前单独决定，不把未签名包称已发布版本。核对包内前端资源、扩展产物和版本 manifest；扩展提供开发者模式安装说明，商店发布不在范围。诊断导出用户显式触发且脱敏。性能只调优已测瓶颈，禁止借验收任务重构无关功能。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

安装包构建继承 01 的原生产物隐私门槛：动态 remap 本机源码路径，并扫描安装包内的实际可执行文件。`pnpm build:native` 明确不打包；13 已增加 `pnpm build:package` 正式 NSIS 入口，验证包内程序与已扫描 release 一致，不能绕过路径和密钥模式检查。

## 显式脱敏诊断导出（2026-10-13）

设置 → Chrome 连接提供「导出诊断 JSON」，点击前说明固定内容，点击才捕获状态并打开原生保存对话框。它无需 Chrome 在线，不自动导出或上传。

- `DiagnosticReport` 格式 v1：`formatVersion`、`appVersion`（编译版本）、`protocolVersion`、`schemaVersion`、`platform`（windows/macos/linux/other）、`architecture`（x86_64/aarch64/other）、`bridgeListening`、`bridgeErrorCode`（固定错误枚举或 null）、`connections`（六种连接状态各自计数）、`mirrors`（current/stale/unavailable 计数）。不包含时间或机器指纹。
- 只从已发布的 Bridge 状态投影上述固定字段。没有 profile/instance/source 身份、显示名、待配对串、端口、书签标题/URL/树、标签/备注/摘要、路径、日志、请求头/正文、凭据、模型名称/端点；不扫描文件、查询树或访问网络。
- Rust DTO → JSON Schema → TypeScript 与 CSP 安全校验器。`save_diagnostics` 无前端参数，仅 `main` 可调用，复用 `SaveGuard`、原生选择位置和原子写入。默认文件 `markbridge-diagnostics.json`。文件正文和保存路径不进入 IPC；`DiagnosticSaveResult` 只返回 `status` 与稳定 `errorCode`。
- 只有完整写入并替换成功才 `saved`；取消为 `cancelled`，不写文件；对话框/写入失败为 `failed`，保留已有目标，清理本次临时文件。设置不挂载时不导出，浏览器预览禁用按钮；导出过程中防止重复点击。
- 检查包括敏感身份/名称/URL/路径 canary 的固定投影、schema 拒绝额外字段、取消/失败/重试和锁定目标保护，以及设置入口在正常/最小窗口的键盘操作与截图。浏览器 mock 不替代原生对话框、权限与实际保存验收。

## main WebView 隔离

当前 Tauri 2.12.3/runtime-wry 2.12.1 的自动 WindowConfig 转换没有传递 data_directory。Windows 验收覆盖存在时，验证 MARKBRIDGE_APP_DATA 是绝对目录，禁止自动创建 main，待服务注册后从原配置显式构建并传入 main-webview；未覆盖的日常 Windows 启动沿用原行为。驱动必须先从确切所属 WebView 进程证明 main 的实际目录，再操作页面；不能只检查配置或环境变量，也不能设置全局 WEBVIEW2_USER_DATA_FOLDER。早期 SDK 路径失败与默认目录影响保留为 UNVERIFIED，见 [原始隔离失败记录](evidence/native-isolation-failure-2026-10-13.md)，不检查或清理日常数据。

14 在 macOS/Linux 还须覆盖普通启动的显式 main store，不限于验收覆盖路径；该平台合同见 14 设计，不能用 Windows 默认目录行为推断其他平台隔离。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

实际安装到专用测试环境并运行完整闭环；分别记录源码检查、构建产物、安装后运行和外部 Floccus。没有安装权限时 V15=NOT_RUN，任务不能完成。

2026-10-13 退出观察方法细化：V15 要求正常退出、实际 exit0、无残留监听及安装重启闭环，没有 Chrome 45 秒退出 SLA。第一版 harness 的 45 秒是观察 watchdog；同一正式程序和 Chrome155 的 aged/headful 对照已记录约100秒后自行 exit0，以及退出等待期间仅剩 Crashpad 子进程。经独立合同复核，后续采用方法2的有界180秒正常退出观察，记录预算、实际耗时、退出码/信号和最终所属进程/监听检查。不得强杀、把缺失退出码当0、修改产品超时或宣称 Chrome 快速退出；原45秒 FAIL及单独晚到清理证据原样保留。新方法仍须重新执行当前包的完整安装/重启/卸载，不能凭观察窗口变化标PASS，也不据此断言 Crashpad 内部故障原因。

原生关闭只对已验证进程中的 main/preview 正常窗口发送 WM_CLOSE；其他窗口和 Tao message-only 事件窗口只读检查。实际 app exit0 后，检查此前从确切所属目录观测到的 WebView 身份：PID 加原始 UTC 创建 ticks（无损字符串），不能把 PID 被新进程复用当作原 WebView 残留。身份读取不可用则未验证；替代进程只记录复用事实，不读取或输出其命令/路径、不发送消息或终止。旧 PID-only 失败及独立只读核查原样保留，仍需新的完整安装重测。

重启零回放检查分别计算 A、B 的完整 Chrome API 树与完整持久操作列表，保存全部原始相等/不等事实及固定字段差异计数，不能用短路条件掩盖失败来源。Chrome155 每次加载都会新建虚拟 root0，其 dateAdded 来自当前时间且不由书签文件持久化（[初始化](https://raw.githubusercontent.com/chromium/chromium/155.0.8059.39/components/bookmarks/browser/bookmark_load_details.cc)、[节点构造](https://raw.githubusercontent.com/chromium/chromium/155.0.8059.39/components/bookmarks/browser/bookmark_node.cc)、[API 投影](https://raw.githubusercontent.com/chromium/chromium/155.0.8059.39/chrome/browser/extensions/bookmarks/bookmarks_helpers.cc)、[持久化范围](https://raw.githubusercontent.com/chromium/chromium/155.0.8059.39/components/bookmarks/browser/bookmark_codec.cc))。新比较方法只在实际本轮证明重新启动 A 唯一变化为该单个顶层、无 parent/URL 的 root0.dateAdded（两边均有有限数值，替换仅此字段后全树逐字相同）时允许语义保持；仍记录原始 A 不等。B 与完整操作 DTO 必须严格相同，其他节点日期、字段、顺序或未知差异一律失败。此项经独立合同审查，属于观察方法修正，不改产品或豁免浏览器变更。旧9cf缺少分项数据，仍 FAIL，不能凭源码机制追认通过。

## 故障与回退

卸载仅限已授权测试目录且先验证路径，保留测试证据。发布不在本任务授权内；生产数据升级失败保留迁移前备份和更高 schema 检测。
## 2026-10-13 当前集成发现：预览持久目录

历史修复前 exe4b0708b1 的真实 A/B/A 预览在正确独立目录与页面绑定下丢失持久 Cookie/localStorage。相同未修改 exe 的短身份探针49d通过，生产66字符身份探针bf020d91失败；同窗刷新成功，等待旧浏览器 PID 消失再重开仍失败。完整身份 UTF-8 hex 目录膨胀为132字符，当时临时根的已知 Local Storage/LevelDB 叶路径达到273字符。此故障已纳入既有13集成修复，不创建或重做已完成09/改版任务。原失败保留，不能启动14/15直到批准门槛实际通过。

修复合同：目录组件为 `v1-` 加 `SHA256(b"markbridge:preview-session:v1\0" + profileId UTF-8)` 全64位小写hex，共67字符；与旧纯hex名字不重叠。同Profile稳定、不同Profile隔离。Windows创建前对 `EBWebView/Default/Local Storage/leveldb/MANIFEST-000001` 已知持久叶路径及NUL作UTF-16长度<=260检查，超限稳定失败，不退回默认store。该检查是当前已测存储路径族的保守门槛，不承诺任意未来浏览器路径。

兼容旧会话：关闭所属预览后，旧精确hex目录存在且新目标不存在时，验证root/直接子目录及整棵迁移树无symlink/reparse，使用Windows原子不覆盖重命名。两者同时存在、链接、越界或文件占用则失败并保留旧内容；不合并或静默覆盖。显式确认清除仅处理该Profile的当前/旧目录，不动其他Profile/main/Chrome。Windows13不擅自宣称非Windows旧目录迁移支持；14须补对应不覆盖原语与原生store合同。没有数据模型/扩展协议变化。

临时COM观察器会延长environment生命周期，不得以其通过代替正式源码。长度对照已无需该观察器，移除诊断源码与孤立parser/test后构建、扫描正式hash；运行生产长度重开、旧目录迁移/冲突/链接反例及实际NSIS完整闭环。机制依据仅作支持：[Chromium文件路径限制研究](https://chromium.googlesource.com/chromium/src/%2B/522842bc0684a249c9cdfa42ed47d5d1140b28e1)、[Microsoft UDF持久化与迁移](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)；本应用结论以真实对照收据为准。
