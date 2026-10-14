<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Markbridge（签桥）

本地优先的 Tauri 2 桌面书签工作台。应用实时镜像 Chrome 书签树，并提供查看、编辑、本地标签、内容预览、应用内网页预览和 AI 整理。浏览器写回只经 Manifest V3 扩展调用 `chrome.bookmarks`。长摘要、向量和用户备注留在本机 SQLite。

Markbridge 连接现有书签树。Floccus 等工具继续负责跨设备同步。经 `chrome.bookmarks` 改动的标题和文件夹会被这些工具带出本机。侧车数据不会进入 Chrome，也不会被同步。

## 当前状态

仓库已进入实施阶段。规范在 `.trellis/spec/`。父任务在 `.trellis/tasks/10-10-markbridge-workspace/`，子任务在同级目录。2026-10-10 用户已批准按当前父子任务规划开始实施。2026-10-13 旧 01–12 已完成。13 的 Windows 安装、诊断和普通搜索已有当前证据，真实模型 V12 未完成，13 与 M4 不关闭。15 的默认可选语义检索已实现并通过合成功能检查，真实模型 V18 未完成，15 不关闭。同日用户明确目前默认 Windows，其他平台先不管：14 的原生 V17 保持 NOT_RUN，不声明 macOS/Linux 支持，并因此离开活动队列。原父任务仍因 13 与 15 未完成而保持 in_progress。实际进度以 task.json 和当前证据为准。

`implementation_approval` 为 `granted`。实施按子任务依赖和验收门槛逐项推进：

2026-10-13 本轮继续实施时，用户明确批准唯一新增启动依赖例外：13 当前 Windows 隔离安装、诊断导出和受影响自动检查通过后，可推进既有 14、15；13 的真实模型 V12/完整验收仍未完成，缺平台或模型证据仍为 NOT_RUN，不关闭 M4 或原父任务。15 不依赖 14，仍一次实施一个子任务。详见原父任务 `gate-proposal-2026-10-13-model.md`。用户同轮授权当前新包隔离安装及本轮必要重测，限新建临时目录、已披露的当前用户安装注册/正常卸载范围；不含日常安装、提交、归档、push、发布或签名。

2026-10-10 用户批准仅调整 01→02 启动门槛：01 自动检查通过，原生验收保留 UNVERIFIED，Windows 交付前补齐。其他依赖门槛不变。

2026-10-13 新版工作台规划已获批准，父任务为 `.trellis/tasks/archive/2026-10/10-12-mb-workspace-redesign/`。R01–R08 及本改版父任务已按调整后范围完成，R08 AC1–5 已通过。用户最新明确“这一条不用管，使用的时候也不会睡眠”，豁免本轮真实 OS 休眠/唤醒验收，取代原延期至 R08 的要求；AC6 为 WAIVED，实际 NOT_RUN，旧 V04 仍 UNVERIFIED。该项不再阻塞本轮改版完成，其他验收和安全约束不变。详见父任务 `gate-change-2026-10-13.md`；实际任务完成状态以 task.json 为准。

2026-10-13 上一轮用户授权检查、提交改动和归档已完成任务。旧 03/04 的其余验收已有通过证据，上一轮同步同一真实睡眠豁免后结案；旧 V04 仍 UNVERIFIED、实际 NOT_RUN。本轮13启动4f/269c/722a闭环通过后按例外推进14/15；当前最终4fc/284478包、3ee4/eee73安装、schema8诊断、80command拒绝、73edf语义原生合成功能和6c7e普通搜索B10K均通过。随后用户明确目前默认 Windows，其他平台先不管。14 因此离开活动队列，V17 仍为 NOT_RUN，不是 PASS。V12 与 V18 未豁免，13、15 与原父任务不关闭。参见 `docs/implementation-status-2026-10-13.md` 与 `docs/next-session-prompt.md`。

- 只对前置验收通过的子任务执行 `task.py start`，一次实施一个子任务。
- 父任务负责协调和集成，不对父任务执行 `task.py start`。
- 不修改真实 Chrome 配置、书签或已安装扩展。
- 提交、归档、发布和日常安装分别需要明确授权。2026-10-13 晚用户授权拆分提交当前改动，并把按 Windows 默认范围移出的 14 归档；未授权 push、发布、签名或日常安装。13 的 V12 与 15 的 V18 未豁免。隔离安装重测仍限已披露的临时范围。

`ref/Markbridge-实施方案.md` 被 Git 忽略，只作设计输入。实现和验收以已跟踪的任务文档、`.trellis/spec/` 为准。参考稿与后两者不一致时，以后两者里已经纠错的约束为准，并在回复中指出差异。

## 开工前阅读

实现某个子任务前，按这个顺序读：

1. `.trellis/spec/project-baseline.md`
2. 该子任务的 `prd.md`、`design.md`、`implement.md`
3. 父任务的 [需求](.trellis/tasks/10-10-markbridge-workspace/prd.md)、[设计](.trellis/tasks/10-10-markbridge-workspace/design.md)、[依赖](.trellis/tasks/10-10-markbridge-workspace/task-map.md)、[验证矩阵](.trellis/tasks/10-10-markbridge-workspace/verification.md)、[执行计划](.trellis/tasks/10-10-markbridge-workspace/implement.md)
4. 所改层的索引：`frontend/`、`backend/`、`extension/` 或 `guides/`
5. 该任务的 `implement.jsonl` 与 `check.jsonl`

父任务负责 R01–R16 的覆盖和集成结论。产品实现进入已批准、且前置验收已通过或有明确启动例外的子任务；当前 13 条件已满足，推进既有 14、15。不要对父任务运行 start 来跳过子任务门槛。

协议字段、表结构、抓取限额和 AI 批量参数以设计文档为准。下文只保留跨任务都不能改的边界。

## 术语

| 词 | 含义 |
|---|---|
| `profileId` | 应用拥有的已配对 Profile 身份 |
| `chromeId` | 浏览器节点 ID，只在一个 Profile 内有效，类型为字符串 |
| `bookmarkId` | 本地持久身份 |
| `sourceEpoch` | 一次身份重置的世代 |
| `sessionId` | 一次传输连接 |
| `mirrorSourceId` | 只读文件来源 |
| proposal | 尚未应用的建议 |
| operation | 用户已确认、可以执行的变更 |
| snapshot | 执行前状态 |
| receipt | 观察到的执行结果 |

显示名只用于界面。认证看 `profileId`、扩展 `instanceId` 和已配对 Origin。快照记录执行前状态；回滚成功要看回执和恢复后的树。

## 硬约束

- 禁止直接改写 Chrome 的 `Bookmarks` 文件。文件监听只用于展示和离线降级。
- 扩展是唯一的浏览器写入方。Rust 是唯一的 SQLite 写入方。前端只消费经过校验的 DTO。
- 根节点、带 `folderType` 的节点、managed 节点及其不可写后代，禁止移动或删除。
- 预览、模型输出和草稿都不能当作写入授权。写入 Chrome 前必须有用户确认的 apply。
- 标签默认只写入 SQLite。标题编码 `名称 | tag1 | tag2` 要由用户显式启用，并先展示完整差异。用户尚未认领的原有竖线保持原样。
- 未配对、扩展断开或状态不是 live 时，只能只读。首版不把离线浏览器写命令排队，重连后也不隐式回放。
- 同一 Profile 的写操作串行执行。冲突或结果不确定时停止后续步骤。丢失 ack 不能当成失败。发送成功不能当成已应用。
- 批量写入前先写 snapshot、Netscape HTML 备份和侧车 JSON 备份。备份失败则取消这次浏览器变更。
- 桌面只监听 `127.0.0.1`。凭据不进入 URL、日志或导出。不把 Tauri 图形进程注册为 Native Messaging host。
- 远程网页放在独立的 `preview-*` WebviewWindow 中，不授予应用 IPC。桌面按钮不能授予扩展 `activeTab`。
- 公共网页抓取拒绝 loopback、私网、链路本地、组播和云元数据地址。用户配置的 Ollama loopback 走单独端点，不复用公共抓取权限。
- AI 默认关闭。页面文本和模型输出按不可信数据处理。模型没有工具执行权。
- 语义检索独立默认关闭，只用明确确认范围的标题与已保存摘要；本地标签、备注与 URL 字段不进入输入。已由用户编码进真实 Chrome 标题的文本仍属于该标题，启用审查须说明。只允许 loopback 本地 embedding，模型版本或维度变化须显式重建。删除派生索引保留原书签、标签、备注、摘要和普通搜索。
- 日志不记录令牌、密钥、请求头、正文、完整标题、query、fragment 和书签树。不添加遥测。
- 密钥放在操作系统凭据存储。React 和扩展都不接收密钥。

## 规划中的技术选择

实施沿用已批准的父任务设计，不另行更换栈：

- Tauri 2、Rust、React、TypeScript、Vite、pnpm workspace。
- SQLite 使用 bundled rusqlite。运行时使用 tokio、reqwest、notify。
- 扩展使用 Manifest V3、TypeScript、Vite，直接调用 Chrome API。首版不引入 WXT。
- Rust serde DTO 生成 JSON Schema，再生成 TypeScript。运行时用 Ajv 校验。`crates/protocol` 与 `packages/protocol` 一起改，并用 `pnpm protocol:check` 检查漂移。
- 完整网页使用独立 WebviewWindow。不使用同窗口多 WebView 的实验性 API。
- 前端使用 React 本地状态和单一订阅适配器。组件不访问 SQLite、浏览器文件、模型端点或密钥。
- 目标路径：`apps/desktop`、`apps/extension`、`crates/core`、`crates/protocol`、`packages/protocol`、`tests/fixtures`、`docs`。

Windows 首版的原生验收目标是 Windows 11 x64 与 Chrome 134 及以上。macOS、Linux 属于子任务 14。语义检索属于子任务 15。这两项不阻塞 Windows 首版。首版文档不把它们写成已支持平台或已交付功能。

## 范围

Windows 首版是子任务 01–13，对应 M1–M4。子任务 14 和 15 属于后续 M5。

以下内容不在产品范围内：

- 新的跨设备云同步服务
- 未经确认的 AI 写回
- 直接改写 Chrome 书签文件
- 自动同步浏览器 Cookie
- Firefox 与 Safari
- 扩展商店发布，或未经单独授权发布安装包
- 把侧车摘要、向量或备注写回 Chrome

## 验证

文档检查、单元测试、浏览器测试、原生桌面测试和外部同步测试分别记录。未运行的项标 `NOT_RUN` 或 `UNVERIFIED`。只完成编译时，原生项保持 `NOT_RUN`。

3 秒同步指标只在应用和 Chrome 都在运行、配对有效、状态为 live 时适用。系统休眠、浏览器关闭、扩展暂停和网页加载时间不计入。恢复过程显示真实状态。

实验使用单独的临时 Profile 和应用数据目录。日常书签库不作为试验对象。

## 改动纪律

- 一次只做一个已批准子任务。前置验收未通过时停止。
- 先看当前 diff 和相关 spec。保留用户已有改动。
- 共享身份、schema 和 DTO 归子任务 02。浏览器写入、回执和撤销归子任务 06。受限 fetch 归子任务 08。远程网页权限归子任务 09。
- 命令、脚本或验收门槛变化时，更新父执行计划和受影响的子任务。
- 稳定下来的新约定写回 `.trellis/spec/`。重大边界变化同时更新本文件。
