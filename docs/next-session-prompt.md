# 下一对话实施 Prompt

以下内容可直接复制到下一对话：

---

请在 `D:\Documents\Code\Tauri\Markbridge` 继续已批准的 Trellis 规划，推进所有未完成任务，直到完成全部可执行工作；遇到真实环境或必要授权缺口时记录明确阻塞，继续不依赖它的工作，不要只停在计划或笼统的“等待确认”。

先使用 Trellis start/continue 读取 AGENTS.md、当前 Git 状态、`.trellis/spec/project-baseline.md`、`docs/implementation-status-2026-10-13.md`、当前父任务 execution-status/PRD/design/task-map/verification/implement，以及本轮归档 R08 中的 `research/remaining-task-audit.md` 和 `evidence/precommit-closeout.md`。按实际目录和 task.json 恢复既有任务，不创建重复任务，不对父任务执行 start。遵循项目要求，实施与独立检查使用相应 Trellis 子代理；一次只启动一个前置验收满足的子任务。

当前已完成：旧 01–12、新版 R01–R08 及改版父任务。2026-10-13 已获授权做本地提交和归档。未完成的是 `10-10-mb-13-windows-acceptance`、`10-10-mb-14-cross-platform`、`10-10-mb-15-semantic-search`，以及原父任务 `10-10-markbridge-workspace` 的最终集成。

按以下顺序推进：

1. **13 Windows 集成验收**：先核对最新收据，不能被旧 notes 中的 FAIL/NOT_RUN 误导，也不能拿旧版安装包 PASS 当新版通过。检查并补齐原 PRD/design 已要求的用户显式触发、脱敏的诊断导出。运行受影响自动检查，构建并扫描当前版本 NSIS，核对包内 exe hash/版本/内容，再执行已获授权的隔离安装、配对、日常管理、退出重启及卸载数据保留验收。实施和准备工作先做完；仅在实际需要且尚无授权的隔离安装前请求该具体授权。汇总 V01–V15 的当前结论和证据复用范围。V16 缺专用 Floccus 测试库与第二客户端时保留 UNVERIFIED，按合同不阻塞基础本地功能结论。
2. **14 macOS/Linux**：13 通过后实施平台能力，覆盖 Keychain/Secret Service、Profile 路径、外部打开、保存对话框、main/preview 会话隔离、平台构建和必要 Windows 回归。两种平台分别完成真实原生运行/安装/回滚验收并记录版本。缺主机时完成能独立进行的实现和检查，明确未测项与所需环境，不宣称支持，也不擅自关闭任务；清除当前活动指针后可推进 15。
3. **15 可选本地语义检索**：依赖 12、13，**不依赖 14**。沿用批准的本地 embedding + SQLite + Rust 有界精确 cosine 方案，默认零请求，启用前说明模型、索引范围和空间影响；实现暂停/恢复、删除/摘要更新失效、模型与维度隔离、删除索引不影响普通搜索/标签/摘要。只索引明确授权范围，不自动抓全库。用实际本地模型完成 20 条人工标注查询 Recall@5 ≥ 0.8 和 B10K 暖态 p95 ≤ 1 s。无真实模型则质量项 NOT_RUN，不能拿模拟响应关闭该验收。
4. **原父任务收尾**：更新 R01–R16 覆盖、依赖、证据矩阵、用户指南及平台支持范围。只有 13/14/15 满足各自门槛，或我明确调整范围后，才可宣布父任务整体完成。Windows 完成可以作为独立里程碑报告。

重要既有决定与约束：

- 我已明确“这一条不用管，使用的时候也不会睡眠”。真实 OS 休眠/唤醒项为 WAIVED，实际 NOT_RUN，历史 V04 保留 UNVERIFIED。不要重新要求睡眠、调整电源策略，或把豁免写成测试通过。普通断连、重连、重启和非 live 禁写仍需验证。
- UI 保持 Codex / Apple 简洁风格，以蓝色为基础；涉及 UI 继续使用 `$ui` 和 `$frontend-design:frontend-design`，保留截图及真实交互证据。
- Chrome 写入只经扩展 `chrome.bookmarks`；Rust 唯一写 SQLite；确认 apply、执行前备份、串行回执、lost ack 不确定、保护节点、非 live 禁写与重连不回放等边界不变。
- 保留最新修复的条件撤销安全：新建文件夹后来含外部内容时拒绝撤销删除，且执行前验证预期子树，不能覆盖外部改动。
- 只使用新建临时 Chrome Profile、应用目录和凭据命名空间；不得修改日常 Chrome/扩展/书签。main WebView 只用 `MARKBRIDGE_APP_DATA/main-webview`，preview 独立；不得复用会探查日常路径或设置全局 `WEBVIEW2_USER_DATA_FOLDER` 的旧验收脚本。
- 先看已有 diff，保留用户工作；遵循 Rust DTO → schema → TS 的生成及检查流程。源码检查、自动测试、原生、安装、模型质量和外部同步证据分别报告；旧 hash 的收据不能冒充新二进制重验。
- 当前继续实施授权有效，不必重复询问是否实施。2026-10-13 的提交/归档授权仅对应上一轮，后续提交/归档按当轮授权处理；push、发布、签名、付费模型调用或日常安装都需要单独授权。

完成后给出每个任务的实际状态、改动和证据、剩余具体阻塞及可执行下一步。不要虚构通过，也不要因 14 的环境不足而漏做独立的 15。
