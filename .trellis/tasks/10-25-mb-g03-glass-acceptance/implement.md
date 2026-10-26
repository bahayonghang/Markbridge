# G03 玻璃视觉性能与 Windows 集成验收执行

## 启动门槛

仅在 10-25-mb-g02-glass-workspaces 阶段验收PASS后启动。 核对用户对最终规划的后续批准、git diff、spec、implement/check manifests；仅启动本子任务。父任务不start。

## 顺序

- [x] 核对G02收据，冻结源指纹，确认当前依赖/构建入口和完整验证矩阵。
- [x] 运行完整自动套件及截图，检查alpha/最差背景和全部回退。
- [x] 以G01前冻结基线作同机前后B10K三轮测量；缺基线先从基线代码独立可复现构建补齐，不伪造比较。
- [x] 按现有build:native入口构建当前exe，在独立数据根做真实重启、DPI、字体/确认/滚动和IPC观察。
- [x] 性能/视觉失败回对应子任务修复再测，保留失败收据。
- [x] 独立check核对R→AC→V、实际diff、设计/spec和源/产物指纹，出最终报告。

## 验证

pnpm lint；pnpm typecheck；pnpm test；pnpm protocol:check；pnpm build；pnpm test:e2e；pnpm build:native；当前隔离原生驱动、B10K对比脚本（实施时建立）。

按父verification矩阵评判。只设置本任务MARKBRIDGE_EVIDENCE_DIR；当前已执行自动/浏览器/滚动/原生，实际收据见evidence/automated-report.md、native-report.md；最终独立结论见check-report.md。代码完成后按工作流派发trellis-check，无法运行的原生项保持NOT_RUN并阻止对应完成声明。

## 回滚

不安装当前包替换日常应用，不操作日常Chrome，不使用历史exe截图证明当前样式。真实DPI与模拟缩放分列；缺硬件/能力不得自动豁免。 失败回拥有该改动的阶段修复，不靠改门槛通过。

执行适配：直接CLI及任务wrapper替代pnpm链接遍历，项目manifest/锁和生产构建配置未改。普通Cargo target及原生beforeBuild覆盖的精确命令在native-build-receipt.json；自动12步骤在automated/results.json。原生搜索首轮208.6ms失败、唯一同条件新目录复测149.2ms通过，两轮保留、原因UNVERIFIED；不宣称性能修复。
