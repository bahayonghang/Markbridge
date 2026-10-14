# 后续会话实施与验收 Prompt

以下内容可直接复制。不要按旧 Prompt 重做已经完成的实现或创建重复任务。

---

请继续 D:\Documents\Code\Tauri\Markbridge。先使用 Trellis start/continue 读取 AGENTS.md、Git 状态、.trellis/spec/project-baseline.md、docs/implementation-status-2026-10-13.md，原父任务 execution-status/PRD/design/task-map/verification/implement/current-integration，以及既有 13/14/15 的 task.json、PRD/design/implement 和最新 evidence。以实际源码、收据与状态恢复，不对父任务运行 start，不新建同一任务，不重做已归档工作台。

旧 01–12、新版 R01–R08 及改版父任务已经完成。13 已完成本轮 Windows 安装、脱敏诊断与集成条件；15 已实现独立默认关闭本地语义检索、范围确认、migration 008、取消/失效、精确排名和 UI。源码、最终包及原生功能结果以最新收据为准。2026-10-13 晚用户明确目前默认 Windows，其他平台先不管：14 已离开活动队列，V17 仍为 NOT_RUN，不声明 macOS/Linux 支持。13 的 V12、15 的 V18 与原父任务仍未正式完成。

本轮已批准启动依赖例外：13 当前 Windows 安装、诊断和受影响自动检查通过即可推进 14/15，13 真实模型 V12/完整验收仍未完成。15 只依赖 12、13，不依赖 14。用户明确没有 macOS/Linux 原生主机或本地 embedding 模型，要求记录未验证并继续所有可执行工作。这些答复不是模型或平台验收 PASS。

按实际剩余门槛推进：

1. **13 / V12**：有用户明确配置的实际本地 AI 模型后，完成原单条/批量 AI 的真实模型验收及 13 完整矩阵。脚本协议响应、Chrome 批量写回及功能测试分别记录，不能替代模型证据。V16 缺专用 Floccus 库和第二客户端时保持 UNVERIFIED。代码更改后按新 hash 检查，不把历史安装结果当新产物重验。
2. **14 / V17**：用户已明确其他平台先不管，14 不在当前活动队列。可执行适配源码已提交，不要重做。将来若重新打开 macOS 14+ arm64 和 Ubuntu 24.04 x64 验收，再分别运行目标编译、包内扫描和 V02/V04 普通恢复/V08/V11/V15。当前 V17 保持 NOT_RUN，不能声明支持。CI 配置未运行，Windows 编译不会检查 cfg 排除的平台分支。
3. **15 / V18**：取得本地 embedding 模型与真实人工审查的 20 条标签后，按 evidence/evaluation.md 执行真实评测。固定 B10K 10,000 书签、1,000 文件夹、20 层；保留实际 model/digest/dimension、20 条相关性结果和至少 30 次暖态 UI 输入→HTTP→Rust 排名→协议校验→呈现的全部时延。平均 Recall@5 >=0.8、暖态 p95 <=1 s；低于门槛也保留。relevance-candidates.json 是开发者候选，不能自动改成 HUMAN_REVIEWED；synthetic-native 收据不是真实模型验收。不安装模型、不自动 pull 或调用云模型。
4. **原父任务**：检查 R01–R16 覆盖、验收复用范围、支持矩阵和指南。14 已按 Windows 默认范围移出活动队列，这不关闭 13、15 或父任务。只有 V12/V18 实际满足或用户再明确调整范围，才关闭剩余任务。未获环境时报告具体缺口，不重复实施已完成内容。

保持以下决定：

- 真实 OS 睡眠/唤醒为 WAIVED，实际 NOT_RUN，历史 V04 UNVERIFIED。不要再次要求休眠或调整电源策略。普通退出、重启、断连/重连和非 live 禁写仍有验收合同。
- 涉及 UI 使用 ui 和 frontend-design:frontend-design，保持现有蓝色、Codex/Apple 简洁风格，保存前后截图和实际交互证据。遵循 Trellis 实施/独立检查子代理要求，一次只实施一个满足启动门槛的既有任务。
- 浏览器写入唯一经扩展 chrome.bookmarks，Rust 唯一写 SQLite。保护节点、显式确认、执行前备份、串行回执、lost ack 不确定、重连不回放和条件撤销外部子节点保护保持不变。
- 仅使用新建临时 Chrome Profile、独立 app-data 和凭据命名空间。main 必须使用隔离根/main-webview，实际 OS 目录守卫通过后才交互；preview 独立。不要使用设置全局 WEBVIEW2_USER_DATA_FOLDER 或探查日常目录的旧脚本。早期默认 main store 写入过合成 r08-main 的事实保持记录，影响未验证，不自行检查或清理默认目录。
- semantic 默认关闭，与聊天独立。只发送确认范围的实际标题与已保存摘要；URL/备注/本地标签字段不进入输入，已编码进 Chrome 标题的文本仍属于标题。取消/暂停/禁用/删除/模型变更和世代守卫不能让迟到响应恢复旧索引；删除派生数据保留侧车和普通搜索。
- schema 008 不能用旧 schema 007 收据冒充当前检查。迁移前一致性备份，降级拒绝，不删除数据库绕过版本检查。Rust DTO→schema→TypeScript/validator 和 pnpm protocol:check 同步。
- 当前继续实施授权对剩余的 13 与 15 有效；隔离安装及必要重测只限已披露临时根、当前用户安装注册和标准卸载范围，保留数据。2026-10-13 晚已经授权并执行当时工作树的拆分提交，以及 14 的范围归档。新的 push、发布、签名、日常安装或付费/云模型请求仍需单独授权。

完成后给出实际状态、关键检查和收据、剩余具体环境及验收入口。持续完成所有可执行工作，不只停在计划，不虚构模型、原生平台或整体完成。
