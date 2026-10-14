# 执行计划

## 当前阶段与批准门槛

2026-10-14 用户已明确批准按规划顺序实施。父任务负责协调，不执行start；从C01开始，仅当前置子任务全部验收通过才启动下一项。父子任务PRD、design、implement、jsonl齐全；当前改动和证据见execution-status.md。

## 顺序

1. C01按DESIGN落实语义令牌、公共字体角色及状态，生成当前前后对照；检查浅/深色对比度、现有字号与入口。
2. C02先最小DirectWrite原生探针（只读、隔离）、确认字体族名和WebView实际渲染；再RustDTO/生成链、frontend adapter、字体选择器、v2迁移/字号几何。不能用原生探针替代实现验收。
3. C03逐页改布局；同场景、同viewport/字体字号、相同fixture前后截图；不能把内容变化当成视觉优化。
4. C04完整覆盖verification矩阵，绑定当前源码与exe hash；修复回归后只重跑受影响项及必要集成；最终独立check，更新稳定spec。

## 命令与检查

现有命令：pnpm lint、pnpm typecheck、pnpm test、pnpm protocol:check、pnpm build、pnpm test:e2e。Rust受影响时cargo fmt --all -- --check、cargo test --workspace --locked及项目既有clippy检查；Windows构建使用pnpm build:native（保持仓库脚本产物身份/缓存合同）。

研究浏览器基线可以使用research/baseline.config.mjs直接调用本地node/Vite/Playwright；它是任务内观察工具，不替换正式CI或产品脚本，不修改pnpm版本策略。正式实施恢复标准命令并解释环境阻塞。

C01聚焦appearance/shell、C02聚焦ui-preferences/App/backend/DTO + appearance/settings、C03聚焦shell/settings/details/organize/semantic/history、C04全受影响集成。新测试放现有合适套件；新文件名在实现后写回，不把拟新增文件称为已存在。

每次截图设置本次MARKBRIDGE_EVIDENCE_DIR，禁止覆盖归档任务的图片。原生基于已归档S03 evidence脚本可复用方法，但复制到新任务并更新产物/路径/命令清单；保留原始失败。

## 风险文件与回退

- styles.css：全局影响，主题/布局分步提交候选，不同时重写业务组件。
- ui-preferences/main/App/VirtualRows：首次渲染、版本迁移、隐藏列表和草稿。v1保留，坏v2不写回。
- src-tauri main/新字体服务及protocol生成链：命令信任边界、线程/COM、schema漂移、锁依赖。任何preview可调用的回归阻塞C02。
- LibraryWorkspace与exportHost：保持挂载、source/query/draft唯一owner，不创建另一个导出数据源。
- 当前运行截图版本差异：只记录可核实身份；不为“解决截图”自动安装到用户日常环境。

## 结束条件

每子任务有当前check-report和分层收据。C04将稳定新约定写入frontend/ui-preferences、component/quality、backend权限/错误/日志规范；本轮规划不提前改运行spec。若增加命令/脚本，更新旧父执行计划相关入口，保留13/15/V12/V18状态。提交、归档、日志记录、安装与发布依项目授权单独处理。

## Implementation approval 2026-10-14

The user explicitly approved sequential execution of the reviewed C01-C04 plan. This supersedes the pending-approval wording above. Start one child only after its prerequisite acceptance passes. No commit, archive, install, signing or publication authorization is added.
