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

当前结果、依赖阻塞和恢复步骤见 [实施状态](execution-status.md)。2026-10-13 原 01–12 与改版 R01–R08 已完成；上一轮同步实际睡眠豁免后 03/04 结案。本轮13安装/诊断/自动检查满足批准的启动例外，14可执行适配及Windows回归已独立批准，清除指针后已启动独立15。最终新hash的Windows构建、打包、安装和新command权限检查随15集成。随后用户把其他平台移出当前范围，V17 保持 NOT_RUN；实际 V12/V18 保持未完成。

2026-10-13 用户批准 [13→14/15 启动例外](gate-proposal-2026-10-13-model.md)：当前 Windows 安装、诊断导出及受影响自动检查通过后允许后续实施，13 实际模型 V12 和完整验收保持未完成。该决定不豁免模型或平台验收，也不使 M4/父任务完成。清除当前指针后逐项切换既有子任务，不启动父任务。

## 计划建立的命令

以下命令已由 01 创建。实际运行结论见各子任务证据；命令表定义检查职责。scripts/README/CI 必须保持一致。

| 命令 | 责任 |
|---|---|
| pnpm install --frozen-lockfile | 重建 JS 依赖；首次生成 lockfile 后使用 |
| pnpm lint | ESLint；无修改模式 |
| pnpm typecheck | 前端、扩展、共享协议 TypeScript |
| pnpm test | Vitest 单次执行全部单元/组件测试 |
| pnpm build | 前端、协议消费者和扩展生产构建 |
| pnpm build:native | 当前真实 host 的原生 release 程序构建与格式/架构、路径/已知密钥扫描；显式 target，构建/扫描同一 releaseDirectory；不生成包，不代表原生交互通过 |
| pnpm build:package | 复用同一 host/路径映射生成 NSIS、app/dmg 或 deb/AppImage，扫描实际包内程序。deb/NSIS/app/dmg 与 release 字节一致；AppImage 只允许动态链接元数据不同。不安装、签名或发布 |
| pnpm protocol:check | 生成协议与已提交类型/schema 无差异 |
| pnpm test:e2e | 可自动化的浏览器工作台与扩展用例；不代表原生 Tauri |
| cargo fmt --all -- --check | Rust 格式 |
| cargo clippy --workspace --all-targets --locked -- -D warnings | Rust lint |
| cargo test --workspace --all-targets --locked | Rust所有target测试，包含受控种子example编译 |
| cargo build -p markbridge-core --example bridge_harness --locked | 03 临时原生验收驱动，复用生产 Bridge，不在 listener 增加测试接口 |
| node .trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs | 03 两个临时 Chrome Profile、独立应用目录和凭据命名空间；实际浏览器配对/同步/恢复，排除 Tauri GUI |
| pnpm --filter @markbridge/desktop tauri dev | Windows 原生交互检查 |
| pnpm --filter @markbridge/desktop tauri build | 裸本地构建，不经过正式路径映射/扫描；不能替代 build:native/build:package |
| cargo build -p markbridge-core --example semantic_fixture_seed --locked | 15新临时根的生产Storage种子，不打开OS凭据或模型 |
| node .trellis/tasks/10-10-mb-15-semantic-search/evidence/current-semantic-native.mjs | 当前release的真实Tauri/SQLite/HTTP合成功能，不是V18模型质量 |
| node .trellis/tasks/10-10-mb-15-semantic-search/evidence/evaluate-real-model.mjs | 无参数仅NOT_RUN；未来显式本机模型+人工标签参数才执行V18，见evaluation.md |

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

2026-10-13 任务13原生harness退出观察细化：父V15没有Chrome45秒退出SLA；旧观察watchdog导致的FAIL保留。当前Chrome155真实aged/headful对照已观察约100秒后自行exit0，后续方法2用有界180秒观察并记录精确耗时、实际exit0/无信号及所属进程/监听检查，完整安装重启闭环仍须重测。该改动只影响验收观察器，不改变产品超时、安全约束、真实模型/平台门槛或任务完成状态。

## 2026-10-13 新版任务门槛调整

用户明确将真实 OS 休眠/唤醒验收移至新版 R08 完成前，允许新版 R02–R07 继续实施。旧 V04 保持 UNVERIFIED，不改写本任务收据或完成状态；其他门槛不变。详见 ../10-12-mb-workspace-redesign/gate-change-2026-10-13.md。

2026-10-13 后续决定：用户明确“这一条不用管，使用的时候也不会睡眠”，豁免新版 R08 的真实睡眠验收，取代上述新版完成前门槛。本旧任务的 V04 仍 UNVERIFIED，收据和状态不改写；不将豁免记作测试通过。详见新版 gate-change-2026-10-13.md 当前决定。

## 2026-10-13 提交归档审计

上一轮用户明确要求提交改动并归档已完成任务，授权适用于上一轮且已执行。03/04 的其余 AC 已通过，同一真实睡眠项按既有用户决定 WAIVED 后完成；原始 V04 UNVERIFIED / 实际 NOT_RUN 保留。本轮继续实施未新增提交/归档授权，13/14/15 和本父任务仍未完成。前述“旧状态不改写”是当时阶段决定，现以本节及 execution-status.md 的证据映射为准。
