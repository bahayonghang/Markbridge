# 执行计划

2026-10-10 用户批准仅调整 01→02 启动门槛：01 自动检查通过，原生验收保留 UNVERIFIED，Windows 交付前补齐。其他依赖门槛不变。

## 状态与启动条件

本任务负责父级协调，不直接作为产品实现目标。2026-10-10 用户已批准当前规划实施。仅对前置验收通过的子任务运行 task.py start，尚未启动的子任务保持 planning。01 是首个实现目标。

每个子任务拥有 prd.md、design.md、implement.md、implement.jsonl、check.jsonl。父子关系是范围关系；依赖另存于 task-map.md 和各子任务 meta.depends_on。Trellis 不自动执行依赖门槛。

## 顺序和里程碑

1. 01 → 02 → 03 → 04 → 05：M1，同步与只读工作台可使用。
2. 06 → 07；08 与 09 可在 05 后分别完成：M2，人工编辑、标签及双预览。
3. 10 依赖 06/07/08，11 依赖 10：M3，AI 建议与可恢复批量分类。
4. 12 依赖 07/08/11，13 依赖 09/12：M4，库维护与 Windows 首版验收。
5. 14、15 为后续 M5，均不阻塞 Windows 首版，但仍在父任务总范围内。

01–04 为 M1 内部工程检查点，不单独宣传为用户可用发布。每个子任务必须能单独构建/检查，不以未来子任务掩盖当前失败。M1–M4 各自有可用产品闭环。13 的集成检查不能代替前面各任务的运行检查。

当前结果、依赖阻塞和恢复步骤见 [实施状态](execution-status.md)。02 已通过本地验收，03 于 2026-10-11 启动。01 原生验收仍为 UNVERIFIED，Windows 交付前补齐。04 及后续子任务仍须核对各自前置验收。

## 计划建立的命令

以下命令已由 01 创建。实际运行结论见各子任务证据；命令表定义检查职责。scripts/README/CI 必须保持一致。

| 命令 | 责任 |
|---|---|
| pnpm install --frozen-lockfile | 重建 JS 依赖；首次生成 lockfile 后使用 |
| pnpm lint | ESLint；无修改模式 |
| pnpm typecheck | 前端、扩展、共享协议 TypeScript |
| pnpm test | Vitest 单次执行全部单元/组件测试 |
| pnpm build | 前端、协议消费者和扩展生产构建 |
| pnpm build:native | Windows 原生 release 可执行文件构建与路径/已知密钥模式扫描；不生成安装包，不代表原生交互通过 |
| pnpm protocol:check | 生成协议与已提交类型/schema 无差异 |
| pnpm test:e2e | 可自动化的浏览器工作台与扩展用例；不代表原生 Tauri |
| cargo fmt --all -- --check | Rust 格式 |
| cargo clippy --workspace --all-targets -- -D warnings | Rust lint |
| cargo test --workspace --locked | Rust 测试 |
| cargo build -p markbridge-core --example bridge_harness --locked | 03 临时原生验收驱动，复用生产 Bridge，不在 listener 增加测试接口 |
| node .trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs | 03 两个临时 Chrome Profile、独立应用目录和凭据命名空间；实际浏览器配对/同步/恢复，排除 Tauri GUI |
| pnpm --filter @markbridge/desktop tauri dev | Windows 原生交互检查 |
| pnpm --filter @markbridge/desktop tauri build | 本地打包；不自动发布 |

01 完成时如命令变化，必须更新父计划和所有依赖任务，不能留下已失效指令。各子任务列出需要增加的测试套件和原生步骤；测试名在实现后补充真实路径，不虚构当前测试文件。

## 执行规则

- [ ] 启动前读取当前 diff、相关 specs 和该子任务上下文；保持用户其他改动。
- [ ] 确认前置子任务验收通过，或有用户明确批准的依赖调整。
- [ ] 通过 Trellis implement 子代理实施，check 子代理独立验证；主会话协调和维护文档。
- [ ] 对授权使用的临时 Profile、应用数据目录和 fixture 单独记录；禁止默认修改正常用户书签。
- [ ] 完成子任务指定检查，记录命令、退出码、版本、样本、时间与截图/回执路径。
- [ ] 修复由该任务引入的问题，保留首次失败记录。
- [ ] 为 bootstrap 规范补充已存在的真实源码和测试引用。
- [ ] 报告 PASS/FAIL/NOT_RUN，不把未验证平台标为支持。
- [ ] 用户另行授权后才提交、归档、发布或安装到日常环境。

## 回退检查点

01–05 尚无浏览器写入，回退代码并保留本地数据库。06 起代码回退前须确认未完成操作，导出历史并按条件撤销处理。08/09 可清理预览缓存/会话，不删除书签侧车。10/11 取消 AI 不撤销已应用变更；使用操作历史恢复。13 安装/卸载测试用隔离目录，不触碰正常应用数据。

## 完成门槛

Windows 首版要求 01–13 通过其正式验收及 verification.md 的 Windows 项。M5 允许单独排期。父任务整体完成还要求 14/15 完成，或用户明确变更范围并更新需求映射。

规划交付只校验任务结构、文档一致性、上下文引用、依赖无环和需求覆盖，不运行不存在的应用命令。
