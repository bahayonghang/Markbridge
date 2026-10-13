# R02 验证记录

2026-10-13 R02 四项 AC、独立检查及最终原生验收通过。以下均为本项执行证据，不以 R01 或设计原型代替。保持未提交、未归档。

后续逐项记录日期、版本与diff、平台、视口/缩放、命令、退出码、fixture、结果和证据路径，禁止真实书签/密钥进入日志。

## 启动与前置复核

- R01 已完成四项 AC、独立检查与最终原生五尺寸；见 `../10-12-mb-r01-shell/evidence/receipts.md`。
- 用户明确授权“明确将真实休眠验收移到 R08 完成前，继续实施 R02”。原文和作用范围见父任务 `gate-change-2026-10-13.md`。旧 V04 保持 UNVERIFIED，没有改写旧收据或旧 03/04 完成状态。
- 旧 03 PRD 的 AC03-1–4 已有真实两 Profile/错误身份拒绝/Chrome 增量/worker 恢复/吊销收据；最新 `import-reconcile-818d78.json` 为真实导入核对 PASS。尚缺的真实 OS 休眠按上述授权延期。
- 旧 04 PRD 状态文字滞后于 task.json 和 evidence/receipts.md；其 AC04-1–4 在收据表分别为 PASS，且 2026-10-12 去抖、30 秒核对、RunEvent::Resumed 分别补测通过。后者仍不等于真实 OS 休眠。这里只核对历史前置，本项仍重新验收受影响接入行为。
- `task.py start .trellis/tasks/archive/2026-10/10-12-mb-r02-connection` 成功，`task.py validate` 为 implement 13 / check 14 条通过。未启动父任务或其他新子任务。

## 自动与浏览器

实施报告 `implementation-report.md` 保存全部改动、首次失败与重测。最终 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e` 退出码均为 0，分别见 `lint-final.log`、`typecheck-final.log`、`tests-final.log`、`browser-pass.log`。测试为 111 Vitest + 6 Node、25 Playwright；五尺寸为 1440×900、1100×760、640×760、1100×480、640×480。`pnpm protocol:check` 退出码 0，见 `protocol-check.log`。无 Rust/DTO 变更。

`build.log` 是实施中间构建；`native-build-final.log` 在最终错误提示/焦点修复后重新构建桌面生产资源并通过原生产物扫描。扩展产品未在其已通过的 build 之后变化。原生脚本记录每轮 exe 与扩展 dist hash，避免混用版本。

## 实际原生验收

`native-driver.mjs` / `native-connection.mjs` 使用实际 Tauri 可执行文件与生产扩展、独立临时应用目录/凭据命名空间/WebView2 目录，以及两个临时 Chrome Profile。扩展仅加载到测试 Profile。配对经桌面 UI 与扩展表单，状态观测读真实 IPC。票据只在内存，截图遮罩票据控件，日志不输出原始 DOM/状态/凭据。每轮结束撤销临时凭据并关闭本次进程。

- 环境：Windows 11 Pro 10.0.26300 x64、Chrome 155.0.8059.39、WebView2 Edg/154.0.4258.62；本机 125% 缩放，无进程缩放覆盖。通过 PID 限定窗口尺寸到 1100×760 和 640×480 CSS 客户区。
- `native-d1c3fdf5.json` 首次 FAIL：脚本错误地要求错误票据必须令扩展变为 `error`；现有认证有意将错误票据和未确认统一返回 pending。修改断言为观察请求后无 profile/无待确认身份，并保留首次失败。该轮临时凭据已清理。
- `native-25137adc.json`：中间构建 8 项 PASS，验证脚本与真实两端流程；不代替最终构建。
- `native-818baf26.json`：最终实施构建 10 项 PASS，退出码 0，临时凭据已清理。exe SHA256 `204b9c5f92f3c6eba5c3d4ddb4d49ffd9d401c9830755c1069f1bca86107fcb0`；扩展目录 hash `813f6266f083880a59b1542b7ea11e2657bcad45adf114874a33534f16117921`。
- 通过项：端口占用后 UI 更换端口恢复；错误票据无身份写入；A/B 两端显式配对；相同 chromeId=5 不串树；当前来源断线而另一来源 live 时只读；临时 Chrome 重启后全树核对恢复；吊销前二次确认；合成目录枚举/接入/浏览只读；合成 Bookmarks 损坏后保留最后有效缓存。
- 实际查看 `native-screenshots/818baf26-live-source-a.png`、`818baf26-revoke-640x480.png`、`818baf26-stale-file-cache.png`：书签主区、确认框和文件陈旧状态可读，确认按钮在小窗内可达。

## 边界

真实 OS 休眠仍 DEFERRED_BY_USER_TO_R08 / UNVERIFIED，完成 R08 前必须补齐；Windows 系统 150% / 跨屏 DPI 留待 R08。票据到期/取消及异步迟到的细粒度场景由组件/浏览器时钟测试覆盖，与实际原生配对证据分开。

## 独立检查与最终复验

`check-report.md` 记录四项修复：A→B→A 旧标签结果、popup 指向不存在的输入框、扩展确认清配对后的焦点、开发目录说明移入折叠区。回归先 FAIL 后 PASS；最终 lint/typecheck、受影响 47 项 Vitest、R02 7 项浏览器均通过。修复前的全量 111+6 / 25 仍单独记录，不冒称最终全量重跑。没有未修复的 R02 阻断；既有节点内编辑预览竞态已交 R04 的 research/r02-review-handoff.md。

主线程在审查修复后执行 `pnpm build` 和 `pnpm build:native`，均退出 0，见 `build-reviewed.log`、`native-build-reviewed.log`。生产扩展 CSP/权限/静态产物扫描与原生源路径/密钥模式扫描通过。

最终 `node .trellis/tasks/archive/2026-10/10-12-mb-r02-connection/evidence/native-connection.mjs` 退出 0，`native-70727125.json` **11 项 PASS**。exe SHA256 `4ccba488f378b7d2f03165b601d8ac3ecc85c80ebda7792a42d21462b19719fd`；扩展 hash `f6f61b34dde3d905302d11eb6d86ec04eea24045ad928503060d5c51bff35f4b`。包含前述 10 项以及真实扩展清配对二次确认/焦点返回。该报告逐图记录 CSS 尺寸和 devicePixelRatio=1.25。最终小窗接入图 `native-screenshots/70727125-onboarding-640x480.png` 已实际查看，主流程与折叠开发说明可读。结束全部临时凭据已清理，测试进程已关闭。

| AC | 结果 | 证据 |
|---|---|---|
| AC-R02-1 | PASS | 原生端口冲突、拒绝、两端配对；App 到期/取消/恢复回归 |
| AC-R02-2 | PASS | 初次不加载 AI；原生合成文件接入、只读、损坏缓存保留 |
| AC-R02-3 | PASS | 原生相同 chromeId 双资料/当前离线而另一在线/重启核对；浏览器输入保留与切换；延迟和 A→B→A 回归 |
| AC-R02-4 | PASS | 完整状态下一步、实际文件陈旧、桌面吊销及扩展清除确认、可见焦点恢复 |

稳定约定已写入 frontend component/quality 与 extension spec。用户已有 foundation.test.mjs / tauri-dev.mjs 哈希仍与 R01 开工前记录一致。R03 可按批准顺序启动；本结论不关闭 R08 的真实休眠门槛。

## 后续证据文件说明（2026-10-13）

R03 全量浏览器回归运行时，继承的测试将同名截图写入了本目录，部分 browser 截图已被 R03 界面更新。因此这些同名图不能继续当作 R02 冻结版本的像素证据；R02 测试日志仍记录原始执行结果。最终原生报告 `native-70727125.json` 和带唯一运行编号的 `native-screenshots/70727125-*.png` 未被覆盖，仍是 R02 最终构建的原生证据。后续浏览器截图使用本轮指定证据目录或默认 test-results 目录，避免跨任务覆盖。
