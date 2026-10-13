# Research: 实施收尾与全部剩余任务

- Query: 核对当前实施与归档范围，区分旧证据、当前版本验收与真正未实现功能，为下个对话提供完整实施入口。
- Scope: internal
- Date: 2026-10-13

## Findings

### 清点与本轮收尾分类

检查开始时，改版 R01–R08 和改版父任务共 9 项均为 completed，尚未归档。原父任务为 planning；旧 03、04、13 为 in_progress；14、15 为 planning。既有 archive/2026-10 中有 bootstrap 和旧 01、02、05–12，共 11 项。

主会话已明确采用用户同一条“这一条不用管，使用的时候也不会睡眠”决定，统一收尾旧 03/04，不再要求重复睡眠授权。应保留原始 V04=UNVERIFIED、真实执行 NOT_RUN，新增验收决定 WAIVED 和其余项目证据映射，而非把原始测试改为 PASS。完成映射后，旧 03/04 也可完成并归档。本轮预期归档共 11 项（改版 9 项 + 旧 03/04）；状态修改和实际归档由主会话执行，本研究没有修改它们。

最终仍需处理：旧 13 当前版本 Windows 集成/安装交付、14 macOS/Linux、15 可选本地向量检索，以及旧父任务最终集成闭环。原父任务 task.json/execution-status.md 的“03 正在实现、04 以后尚未开始”等记录已过时，应按逐项证据修正，不能据此重复实现完成的功能。

### 03 / 04 为什么可以收尾

| 项目 | 已有证据 | 结论 |
|---|---|---|
| 03 AC03-1–4 | `10-10-mb-03-chrome-bridge/evidence/receipts.md:59–62` | 四项均已 PASS，PRD 已勾选 |
| 实际 worker / 浏览器恢复 | 同目录 `native-42e65e09-b831-40ee-afd3-e616899a359c.json` controls：worker 强停/alarm 恢复 PASS，Chrome 重启全树 PASS，显式重连 565ms，闲置 309308ms 后同 session 事件 PASS；receipts.md:35–49、71 | 不需要重造恢复实现；历史结果应标历史 |
| 排序及断档/重复/乱序 | `native-21247130-0cf1-44ac-9327-041a27019d6f.json`、`native-6642b276-1972-4b2c-a12c-ba1d55e815db.json`；receipts.md:128–181 | 补齐最早大运行中未覆盖的排序/事件缺口 |
| 真正 Chrome import end | receipts.md:532–550；`import-reconcile-818d78.json` 实读 exitCode=0、pass=true、importEnded/reconcilingAfterImport/treeAfterResync/treesMatch 全 true | 导入已通过，不能被更早 FAIL/UNVERIFIED 叙述遮盖 |
| 04 AC04-1–4 | `10-10-mb-04-readonly-mirror/evidence/receipts.md:41–44` | 四项均已 PASS；旧 PRD/notes 未同步 |
| 实际 watcher 和时间边界 | 同收据:50、86–95：真实临时文件原子替换后 watcher 更新；300ms 去抖、30s 元数据核对、Resumed 处理器均独立复测 PASS | Resumed 测试不是 OS 睡眠，但同一睡眠已豁免 |
| 桌面接入和镜像可见 | `10-12-mb-r02-connection/evidence/receipts.md:27–29`，`native-70727125.json`：真实 Tauri 文件来源接入/浏览/只读、损坏保留缓存、临时 Chrome 重启后核对全部 PASS | 补足旧 04 当时未打开桌面窗口的证据 |
| 当前版本非 live 禁写与重启 | R08 `evidence/receipts.md`、`native-daily-c4d33b1e.json`、`native-system-probe-52c7576b.json` | 新 exe 有原生拒绝和重启零回放证据，不能冒充真实睡眠 |

以上足以支持按调整后范围结束旧 03/04；未发现除同一真实睡眠观察之外的剩余必要 AC 或独立门槛。无需重新启动已完成的改版任务。

### 13：当前版 Windows 集成与安装交付

前置 09、12 已完成并归档。旧 13 的 `task.json.notes` 和 design/implement 的“尚未实施”文字过时；须看追加到最后的收据。

- `prd.md:19` AC13-1 尚未关闭：01–12 必要证据可追溯、V01–V15 状态收敛。`evidence/receipts.md:779–800、822–838` 表明原先阻塞是 V04，不是功能尚未实现。同步睡眠豁免后，应新增当前验收汇总，保留旧 FAIL 行。
- `prd.md:20–22` AC13-2/3/4 已勾选；收据:745–751、780–782、816–838 为历史 PASS：隔离安装闭环、本地性能、包清单/hash/版本/卸载数据保留。
- **历史 NSIS 与新版不同**：收据:673、713 的 setup `edc562b4d105d1c8f32cdcc83860377b725fe1f8726bfa1a52282ddf203f77d8`、内嵌 exe `79c0f5879eb45e56bbc8778fe8407040db0332034be9f8aff4d4fc8b79da44b9` 是 2026-10-12 旧版；R08 当前 exe `804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910`。因此新版 NSIS 必须构建、扫描、检查实际包内 exe，并在授权的隔离安装环境验证；不得用旧包 PASS 宣称新版安装已验收。
- `prd.md:23` AC13-5 / V16 没有专用 Floccus 库与第二客户端，仍 UNVERIFIED。该条文字明确不阻塞基础本地功能结论；无环境时无需虚构或无限等待。
- **诊断导出需核实并补齐**：13 `prd.md:5` 和 `design.md:11` 明确要求用户显式触发的脱敏诊断导出。检索当前产品、README、docs，仅发现详情/历史诊断折叠，没有诊断导出命令/入口；当前导出为书签 HTML/侧车 JSON。下轮应在 13 内定义最小可观察验收并实现/验证，或取得明确范围调整，不能把书签导出当诊断导出。
- V01 最后具名旧判定还是 FAIL（收据:784），但同一记录已有修复后 exit 0，R07/R08 也有后续完整回归。不应恢复旧错误；应追加新的当前产物汇总，说明哪些检查重跑、哪些冻结源码证据复用。

### 14：真正未实现的平台能力

前置仅 13（`prd.md:11`），不依赖 15。推荐原生环境为 macOS 14+ arm64 和 Ubuntu 24.04 x64 桌面（`design.md:11`）。

- AC14-1（prd:19）：两系统分别完成 Profile 路径、配对、实时更新、只读降级、标签持久化。
- AC14-2（prd:20）：Keychain/Secret Service 不降级到明文，main/preview/Profile 会话和 IPC 隔离原生验证。
- AC14-3（prd:21）：中断/回滚及本地安装运行，记录 OS、WebKit/GTK、Chrome、构建版本。
- AC14-4（prd:22）：Windows 必要回归通过；无原生环境保持未完成/NOT_RUN。
- 两系统分别执行 V02/V04（按最新睡眠豁免调整实际范围）/V08/V11/V15，不用 Windows 或交叉编译替代（design:21）。

现有代码印证平台工作未交付：

- `crates/core/src/bridge/credentials.rs:55–85` 非 Windows 的 get/set/delete 均 StorageError；`crates/core/Cargo.toml:29` 仅启用 keyring windows-native。
- `apps/desktop/src-tauri/src/main.rs:249–252` 非 Windows 的外部 HTTP 打开返回 ReadOnly。
- `apps/desktop/src-tauri/src/export.rs:127–132` 非 Windows 原生保存目标返回 ReadOnly；应纳入平台适配，避免只修配对后仍不能日常导出。
- `apps/desktop/src-tauri/src/preview.rs:359–363` 当前使用 data_directory，另有 Windows 专用控制/导航回调；需按实际平台实现会话隔离和导航反馈。
- `scripts/native-build.mjs:55` 与 `scripts/native-package.mjs:65` 限定 win32；平台产物构建/扫描需适配，保持既有 Windows 门槛。

### 15：真正未实现的可选语义检索

前置 12 和 13（`prd.md:11`），**不依赖 14**。若 14 缺原生机器，在记录环境缺口并清除活动指针后，可继续实施 15，仍保持一次一个活动子任务。

- AC15-1（prd:19）：默认零 embedding 请求，启用前说明模型/范围/空间影响。
- AC15-2（prd:20）：暂停/恢复、删除或摘要变化导致失效重算；不同模型/维度不混用。
- AC15-3（prd:21）：固定真实本地模型，20 条人工标注查询 Recall@5 >= 0.8；B10K 暖态 p95 <= 1s；保留低于门槛结果。
- AC15-4（prd:22）：禁用/删除索引保留普通搜索、标签、摘要；无本地模型明确不可用。
- 已批准设计（design:11）：仅本地 embedding endpoint，复用 provider 配置通路；存 model/version/dimension/content fingerprint；SQLite 保存向量 + Rust 有界精确 cosine 检索；未经性能证据不引入独立向量服务或 ANN；只索引授权范围，不自动抓全库。
- 当前 protocol、SQLite migrations、前端、core 检索未发现 embedding/semantic 实现。需同时处理 Rust DTO/schema/TS 生成漂移。
- 缺真实本地 embedding 模型时可做实现和确定性协议/取消/隔离测试，但质量和真实性能保持 NOT_RUN，不能以模拟模型关闭 AC15-3。

### 下轮建议顺序与 Prompt 必备约束

1. 加载 AGENTS、Trellis start/continue、baseline、原父任务和最新审计；读取归档后的真实路径，先核对工作树与实际 task.json。恢复既有 13，不创建重复任务、不 start 父任务。
2. 13：核对 03/04 同一睡眠豁免结案、收敛 V01–V15，补诊断导出，验证当前 NSIS 与实际隔离安装闭环；V16 缺环境明确 UNVERIFIED。只在实际需要安装前确认或继承明确的隔离安装授权，当前审计/提交/归档授权不等于安装授权。
3. 14：实施平台缺口，macOS/Linux 分别验收；缺机器时把具体阻塞、可交付实现、未运行项留在文件，随后推进不依赖 14 的 15。
4. 15：完成授权的本地模型索引、控制 UI、删除/失效/隔离、真实模型相关性和 B10K 性能；无模型时保持验收未完成，并继续其他独立工作。
5. 原父任务：更新 R01–R16 覆盖与依赖、证据矩阵、支持范围和文档。只有 14/15 真正完成或用户明确缩小范围后才能完整关闭父任务，不能把 Windows 里程碑当全部完成。

沿用 Codex/Apple 简洁蓝色 UI；相关 UI 改动使用 ui 和 frontend-design。保持实际 Chromium 写入仅由扩展执行、Rust 负责 SQLite、显式 apply、批量备份、lost ack 不确定、非 live 禁写、不回放离线操作。只用临时 Chrome/app/凭据目录；不得重用旧 13 会探查日常路径并设置 WEBVIEW2_USER_DATA_FOLDER 的脚本。优先适配 R08 安全 harness 的隔离方式，main WebView 只用 MARKBRIDGE_APP_DATA/main-webview，preview 单独目录。

下轮应持续推进已批准且前置满足的工作；仅在环境、外部成本或必要授权缺失时询问具体缺项，不能重复请求同一休眠授权。区分实现、自动、原生、安装、模型质量和外部同步结论。当前用户只授权本轮提交与归档；push、发布、签名、日常安装或日常 Profile 改动仍不在授权内。

## Related Specs

- `.trellis/workflow.md`：阶段、一次一个活动任务、父任务协调、完成/归档机制。
- `.trellis/spec/project-baseline.md`：最新改版事实与睡眠豁免、安全和来源边界。
- `.trellis/spec/backend/quality-guidelines.md:15、21–56`：原生证据要求、打包前路径/密钥扫描、MARKBRIDGE_APP_DATA 隔离与禁止全局 WebView2 数据目录覆盖。
- `.trellis/tasks/10-10-markbridge-workspace/task-map.md:21–23、55–59`：13/14/15 依赖与父范围。
- `.trellis/tasks/10-10-markbridge-workspace/verification.md:20–37、47`：V01–V18 原合同、外部同步不阻塞本地结论、M5 缺环境仍未完成。
- `.trellis/tasks/10-10-markbridge-workspace/implement.md:63–65`：Windows 与完整父任务的完成边界。

## External References

没有查询外部网页；本次仅审计仓库事实和已批准合同。后续 14 需按实际 Tauri/keyring/平台版本检查官方平台 API；15 需记录实际本地 embedding 模型及版本，不预先声称兼容性或质量。

## Caveats / Not Found

- 本研究是只读审计，没有重新运行产品测试、原生窗口、安装程序、模型、Floccus，也没有 Git 操作或任务状态修改。唯一新文件是本研究文件，按研究者持久化合同保存。
- 行号对应 2026-10-13 审计时文件；主会话的后续归档会移动目录，后续状态以 task.json 和归档目录为准。
- 没有验证 macOS/Linux 主机或本地 embedding 模型当前是否可用；旧 13 中 where ollama 失败是历史环境记录，不能断言今天仍没有模型。
- MEMORY.md 路径不存在，未使用历史记忆内容。
- 诊断导出缺口来自明确目标/设计与当前源码入口检索；应在 13 继续时核对完整路径后收敛最小实现与验收，不借此扩大成新的遥测或支持平台。
