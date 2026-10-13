# R02 implementation handoff

2026-10-13，trellis-implement。产品已冻结，供主线程原生复验与独立检查。工作在 R01 已验收但未提交的同一工作区上进行，未覆盖既有脚本、任务元数据或主线程原生 harness。

## 实现

- `apps/desktop/src/App.tsx`：首次无来源展示接入引导；设置与引导共用唯一 ConnectionSettings/useBridge 状态。顶部连接状态绑定当前来源。设置发起带 kind/id 和请求序号的浏览请求，重复进入同一来源也可生效。
- `apps/desktop/src/features/settings/ConnectionSettings.tsx`：准备扩展、启动本机监听、两端配对三步；默认端口保留，高级端口与手动文件目录折叠；票据及已水合候选到期后禁止确认并可显式重新生成；取消后可重试。资料和文件缓存可返回书签浏览。吊销说明缓存、侧车和书签影响并二次确认。只读分支共享错误提示，目录结果绑定枚举时路径。
- 新增 `features/settings/source-status.ts`：复用连接标签、每种状态下一步与真实缓存时间格式；空时间明确显示“尚无同步时间”。
- 新增 `features/settings/ConfirmDialog.tsx`：原生 HTML dialog、安全默认焦点、Escape 取消与恢复焦点。设置发起切源后取消时回到可见来源下拉框。
- `features/library/LibraryWorkspace.tsx`：来源选项标明 Chrome/文件只读；当前来源的缓存时间及恢复入口；切源前对详情文本输入给出明确清除/保留选择。按来源重挂详情/整理组件，旧来源的 catalog 回调不能写进新来源；旧树请求失败不污染当前来源。沿用既有非 live 禁写和请求代次保护。
- `apps/desktop/src/styles.css`：沿用 R01 普通 CSS、Windows 字体、蓝色焦点、无阴影分区；增加引导和确认框样式。
- `apps/extension/src/main.ts`、`style.css`、`index.html`、`options.html`：两端可核对扩展 instance/origin；明确以桌面实时同步为最终状态；到期/无效输入提示不会被状态轮询立刻擦除；本机清配对需显式二次确认。纠正原 popup“扩展不写书签”的过时描述。

新建或更新测试：`App.test.tsx`、`features/library/library.test.tsx`、`apps/extension/src/main.test.ts`、`tests/setup.ts`、`tests/e2e/connection.spec.ts`、`mock-bridge.ts`、`foundation.spec.ts`、`shell.spec.ts`。R01 既有浏览器矩阵仍执行，新截图写入 R02 evidence，不覆盖旧验收截图。

## 最终检查

命令均在仓库根目录执行，使用现有 pnpm 依赖；pnpm engine store 需要 sandbox escalation，没有重装依赖。

| 命令 | 退出码 / 结果 | 日志 |
|---|---|---|
| `pnpm lint` | 0 | `lint-final.log` |
| `pnpm typecheck` | 0 | `typecheck-final.log` |
| `pnpm test` | 0，15 suites / 111 tests；6 Node script tests | `tests-final.log` |
| `pnpm test:e2e` | 0，25 tests，12.0s | `browser-pass.log` |
| `pnpm build` | 0，desktop/extension 与 production CSP/artifact scan | `build.log` |
| `git diff --check` | 0，仅既有 LF/CRLF 提示 | 实施工具收据 |

`build.log` 在最后 CSS、共享错误提示位置和取消焦点修复之前产生；最终 bundle 由主线程的 native build 重建，避免两方同时写 dist。最后产品修改后的 lint/typecheck/unit/browser 全部通过。`pnpm test` 包含协议漂移拒绝及禁用字符串代码生成的 MV3 validator 检查；没有协议/Rust 修改。

## 首次失败与修正

1. 初次聚焦 33 tests 有 1 失败：顶部现能显示当前来源核对状态，旧 findByText 假定标签唯一。作用域修正，并增加吊销第二次确认断言。扩展 App 回归到 37 tests 时同类 status 查询再次发现读取中 role=status，已精确绑定顶部状态。
2. 原生 dialog 的 jsdom 方法不存在，聚焦测试 2 失败；测试 setup 增加 shim。首次全量运行发现 node 环境没有 HTMLDialogElement，给 shim 增加环境条件。扩展新测试缺 jest-dom matcher 类型导入，typecheck 失败后补齐。最终 111+6 tests 和 typecheck 均通过，生产代码没有 jsdom fallback。
3. 首轮 browser 18/18 PASS，但控制台发现整理和维护两个同级组件使用相同来源 key。增加功能前缀后最终 browser 不再有该警告。
4. 新增双 Profile browser 夹具第二资料未出现，原因是字符串插值写成字面值；修正夹具。来源 selectOption 需要模拟用户先聚焦，避免错误地断言恢复至程序化未聚焦的控件。相关首次日志为 `browser-retest.log`、`browser-final.log`。
5. 代码自查发现首次只读路径的错误提示在隐藏连接分支内。移入共享区域，App 测试断言目录空输入错误可见。
6. 新增真实 browser 回归发现“设置发起切源→取消”焦点确实返回已隐藏按钮。确认框支持显式返回来源 select；`browser-settings-cancel.log` 失败，`browser-settings-cancel-retest.log` 通过。最终 25/25 包含此路径。

保留非阻塞警告：Vite 的现有 >500kB chunk 建议；Node NO_COLOR/FORCE_COLOR；jsdom 导出/链接的 navigation-not-implemented。自动检查退出码仍为 0。

## AC 覆盖与截图

| AC | 自动证据 | 原生边界 |
|---|---|---|
| AC-R02-1 | App 显式配对/取消、offer 与水合候选到期、重新生成、端口校验、旧响应丢弃；browser 端口冲突修正重试；extension 清输入及错误保留 | 两个真实临时 Profile 配对、拒绝、到期和冲突恢复由主线程记录 |
| AC-R02-2 | 引导无 AI 请求；只读入口不自动枚举；真实 DTO 时间/null 语义；文件镜像只读原有回归 | 真实文件接入与损坏保留缓存由主线程记录 |
| AC-R02-3 | 相同 chromeId 跨 Profile 旧响应丢弃、输入保留/放弃、设置浏览请求；当前资料离线但另一个 live 时顶部只读且零 apply | 真实 Chrome 双 Profile 断线、重连、重启由主线程记录 |
| AC-R02-4 | connecting/reconciling/cached/unpaired/error 与 stale/unavailable 提示；桌面吊销和扩展清配对明确确认；对话框 Escape/焦点 | 原生连接/文件错误与吊销影响由主线程记录 |

浏览器五尺寸：1440×900、1100×760、640×760、1100×480、640×480。新接入图为 `onboarding-<size>.png`，只读图为 `onboarding-readonly-<size>.png`；另有 `selected-offline-other-live.png`、`revoke-confirmation.png`，以及 R01 shell/detail/AI 回归截图。实施者实际打开审视正常/最小接入、最小只读、离线详情和吊销图；最终图层次、字号、焦点及滚动可达性符合既定设计。

## 交接限制

- 本报告只交接产品和自动/浏览器证据；不以 mock 或 build 宣称 AC 原生通过，由主线程合并最终原生 receipts 并派独立 check。
- 详情输入保护是保守提示，文案说明“清除详情中的输入”，不声称已保存内容仍未保存。当前来源点“留在当前页面”保留输入；放弃才切换。没有扩展 R04/R05 编辑模型。
- 延用既有 BridgeState/缓存 DTO，没有新增 sourceEpoch UI 字段、Rust/Schema/认证流程。现有身份/写入边界继续由后端验证。
- 真实 OS 休眠仍按已批准门槛由 R08 完成前补齐，不在本报告改写为 PASS。
- 没有提交、归档、发布、日常 Profile 或安装环境变更。主线程拥有 spec/task/receipt 汇总及 `evidence/native-*`。
