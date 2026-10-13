# R02 independent check

2026-10-13，trellis-check。当前任务：`.trellis/tasks/archive/2026-10/10-12-mb-r02-connection`。在 R01 已验收、R02 实现交接后的共享工作区上审查；不回退已有改动。已读完整 SubagentStart hook、check.jsonl 所列上下文、R02 PRD/design/implement、父设计/视觉/验证矩阵及 frontend/extension 规范。

## Findings (fixed)

1. **A → B → A 的旧标签回调可以回灌当前列表。**
   - File: `apps/desktop/src/features/library/LibraryWorkspace.tsx`，`sourceGeneration` 与 `TagDesk.onCatalog`。
   - Issue: R02 的 `currentKey === sourceKey` 只防止不同来源。A 的 `tag_command` 未完成时切到 B 再回 A，旧 A 组件仍持有回调；返回时字符串身份再次相同，会用旧 catalog 的 matches 覆盖新 A 当前筛选结果。
   - Fix: 每次来源变化递增代次；回调同时检查 kind/id 和捕获的换源代次。只改列表回调归属，不撤回已由用户发起的本地标签命令。
   - Regression: `library.test.tsx` 的 `ignores an old catalog command after switching away and back to the same profile`。先执行延迟旧 A 命令，A→B→A 后选择新筛选，再释放旧回调。修复前列表从 Alpha 变成 Beta；修复后保持 Alpha。

2. **未配对的扩展 popup 指向不存在的输入框。**
   - File: `apps/extension/src/main.ts`，`nextSteps.unpaired`。
   - Issue: popup 与 options 共用“然后在此粘贴”，popup 只有“打开配对设置”按钮。
   - Fix: options 保留当前输入说明；popup 明确引导点击“打开配对设置”。新增 popup 入口回归。

3. **确认清除本机配对后焦点留在隐藏确认区。**
   - File: `apps/extension/src/main.ts`，`forget-accept` handler。
   - Issue: 确认区隐藏后没有移出焦点，键盘用户留在不可见元素。
   - Fix: 同步恢复到可见的“清除本机配对”触发按钮，沿用取消路径的行为。现有二次确认测试增加完成后的焦点断言。

4. **开发验收说明混在接入主路径。**
   - File: `apps/desktop/src/features/settings/ConnectionSettings.tsx`，准备扩展步骤。
   - Issue: 常规引导直接展示“测试时…”和仓库构建目录。
   - Fix: 经主线程确认，将源码目录和临时测试资料说明放进折叠的“开发构建：扩展目录”。主文案保留打开扩展配对设置以及不自动安装/扫描的准确说明；仍保留当前开发态手工安装入口，不暗示已商店发布。

## Findings (not fixed)

- **既有 R04 编辑模型问题，非本次 R02 引入：** `apps/desktop/src/features/library/EditDesk.tsx` 的 `requestPreview` 在 `await previewEdit` 返回后无请求代次检查；同一 Profile 内从节点 A 切到 B 时，节点变化分支虽然清空 preview/action，A 的旧 Promise 仍可再次设置 A 的 preview/action。源码依据为节点 reset 分支与 `requestPreview`（约 61、118 行）。这涉及节点草稿和取消模型，超出本轮来源/接入审查所有权；未改动。建议在 R04 对节点、revision、取消和卸载做代次回归。本次跨来源切换通过详情重挂和独立回调代次处理，不会复用旧组件草稿。
- 本轮未发现其他未修复的 R02 范围问题。真实 OS 休眠/唤醒仍为旧 V04 UNVERIFIED，按用户授权移到 R08 完成前，不能用本次 mock/browser 或普通重启替代。

## Verification

| Check | Result | Evidence |
|---|---|---|
| 先复现新增回归 | 预期失败，exit 1，3 failed / 19 skipped | `check-regressions-before.log` |
| Lint | PASS，`pnpm lint`，exit 0 | `check-lint.log` |
| TypeCheck | PASS，`pnpm typecheck`，exit 0 | `check-typecheck.log` |
| Affected tests | PASS，`pnpm exec vitest run apps/extension/src/main.test.ts apps/desktop/src/features/library/library.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/features/tags/tags.test.tsx`，exit 0，4 files / 47 tests | `check-regressions-after.log` |
| R02 browser | PASS，`pnpm test:e2e tests/e2e/connection.spec.ts`，exit 0，7 tests | `check-browser.log` |
| Diff whitespace | PASS，`git diff --check`，exit 0 | 审查工具收据；仅已有 CRLF 提示 |

本轮浏览器重测更新了 `onboarding-<size>.png`、`onboarding-readonly-<size>.png`、`selected-offline-other-live.png` 和 `revoke-confirmation.png`。覆盖 1440×900、1100×760、640×760、1100×480、640×480；人工打开查看正常及最小接入截图。小窗保持内容区域滚动，开发说明折叠，下一步控件可通过滚动与键盘到达。来源下拉切换、设置发起切换、Escape 取消、输入保留与吊销取消焦点测试均通过。

保留验证层次：实施交接的 **111 Vitest + 6 Node / 25 e2e** 是修复前的全量结果，见 `implementation-report.md`，本审查不把它改写为新源代码的全量结果。审查新增两个测试、强化一个既有测试，最终执行的是上表 **47 targeted / 7 browser**。按主线程分工未重复 build、未写 dist、未运行原生。主线程须基于本次产品修复重新 build 并记录最终原生 hash/截图/回执；此前 `204b9c5f92f3c6eba5c3d4ddb4d49ffd9d401c9830755c1069f1bca86107fcb0` 的原生结果属于修复前构建。

非阻塞日志仍有 jsdom navigation-not-implemented 与 Playwright NO_COLOR/FORCE_COLOR 提示；上述命令退出码为 0。没有 Rust/DTO/schema/认证/权限修改，因此没有生成协议文件或改动公开接口。稳定来源代次约定已交主线程同步 spec。没有触碰用户已有的 `scripts/foundation.test.mjs`、`scripts/tauri-dev.mjs`，没有提交、归档、标记任务完成或发布。

## Acceptance path review

- AC-R02-1：引导不自动启动/安装；现有 begin/confirm/cancel 命令保留两端授权。有效票据、已水合候选到期、取消重试、端口本地校验和异步卸载均有 App 回归；真实配对/拒绝/端口冲突由主线程原生证据覆盖。
- AC-R02-2：首次接入不挂载 AI 配置，无自动目录枚举。kind/id 明确区分来源；缓存时间来自 DTO，null 显示尚无同步时间；文件始终不可写。文件读取与损坏缓存保留的真实结果由主线程记录。
- AC-R02-3：来源重置清理选择和未确认详情，文本输入先经保留/清除确认；当前来源决定顶部状态。现有请求取消/代次保护，加本次 A→B→A catalog 防护；非 live 不挂载浏览器编辑，重连前不会隐式 apply。
- AC-R02-4：连接状态及文件 stale/unavailable 均有恢复入口；吊销保留 Chrome 书签与本地缓存的影响明确。确认框 Escape 与焦点回退有 browser 回归；扩展 popup 与 options 入口提示一致且不把发送状态当作桌面 live。
