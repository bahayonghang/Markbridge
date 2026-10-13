# R01 独立检查报告

检查日期：2026-10-13。角色：已派发的 `trellis-check`，无递归派发。范围仅 R01 产品壳层、导航、设置迁移、焦点与相关测试。读取本项 PRD/design/implement/check.jsonl 各引用、父需求/设计/视觉/验证/执行与前端规范；核对 tracked diff 和 untracked 产品文件。没有修改后端、协议、扩展或日常 Chrome。

## Findings (fixed)

- File: `apps/desktop/src/features/library/VirtualRows.tsx:45`
  - Issue: 列表已有活动行时，checkbox 的 Space 勾选引发 rows 重绘，焦点同步 effect 把焦点从 checkbox 抢回先前活动行。640×480 实际浏览器回归先失败，见 `check-checkbox-before.log`。
  - Fix: 当前焦点在 input 内时不运行行焦点同步，保留 checkbox 自身的焦点。
- File: `apps/desktop/src/features/library/LibraryWorkspace.tsx:491`
  - Issue: checkbox 的键盘事件冒泡进入列表处理器，Enter 会按先前活动行执行详情/URL 打开逻辑。
  - Fix: input 目标不进入列表导航快捷键。`tests/e2e/shell.spec.ts` 新回归验证 Space 勾选后焦点保持、Enter 不开详情且不调用 URL 打开；`mock-bridge.ts` 记录测试专用的 `open_url` 调用。
- File: `apps/desktop/src/features/library/library.test.tsx:438`
  - Issue: 新的独立 history 模式缺少离线与确认阶段断线的行为覆盖，原有编辑确认测试不能证明这个分支。
  - Fix: 增加历史记录离线可读、离线 undo 禁用、live 只预览、预览后断线禁确认、恢复 live 后显式 apply undo、`rolled_back` 回执显示的回归。产品合同无需更改。

## Findings (not fixed)

未发现剩余的 R01 产品阻断问题。

- 本轮不接管原生验收：主线程负责最终产品 diff 的 native 构建、真实 Tauri 截图与 125%/150% 缩放证据。浏览器/组件 PASS 不替代原生 PASS，也不改变旧 03/04 V04 与 R02 前置。
- 原有导出仍采用 Blob/download，没有原生 saved/cancelled/failed 回执；这是父审计已登记的 R06 工作，不在 R01 扩展。当前文案已明确“已生成，请在下载位置确认文件”，未宣称落盘成功。
- R03 分页/组合筛选/选择语义、R04 完整编辑草稿与批量合同、R05/R07 详情/整理重组保留原责任。本报告没有将既有能力或本次壳层测试记为这些任务验收。

## Verification

| 项目 | 命令 / 证据 | 结果 |
|---|---|---|
| Lint | `pnpm lint` → `check-lint-final.log` | PASS，exit 0 |
| TypeCheck | `pnpm typecheck` → `check-typecheck-final.log` | PASS，exit 0 |
| 相关组件 | `pnpm exec vitest run apps/desktop/src/App.test.tsx apps/desktop/src/features/library/library.test.tsx apps/desktop/src/features/tags/tags.test.tsx` → `check-components.log` | PASS，38 tests，exit 0 |
| 新历史回归及 library 最终版本 | `pnpm exec vitest run apps/desktop/src/features/library/library.test.tsx` → `check-library-final.log` | PASS，17 tests，exit 0 |
| 复选框复现 | `pnpm exec playwright test tests/e2e/shell.spec.ts -g 'checkbox keys'` → `check-checkbox-before.log` | 首次 FAIL，Space 后焦点丢失，exit 1 |
| 复选框修复 | 同命令 → `check-checkbox-after.log` | PASS，1 test，exit 0 |
| 最终壳层浏览器回归 | `pnpm exec playwright test tests/e2e/shell.spec.ts` → `check-shell.log` | PASS，12 tests，exit 0 |
| 差异空白检查 | `git diff --check` | PASS，exit 0 |

五尺寸 1440×900、1100×760、640×760、1100×480、640×480 均由最终 shell 回归覆盖，包含分区布局、无整页横向溢出、导航保持查询/勾选、设置键盘标签、窄窗文件夹返回与 Escape、详情返回、checkbox 16px、reduced-motion、加载/失败/空/只读状态。核对实际 640×480 详情截图，详情替换列表且返回按钮可达。

已核对实施阶段的完整检查日志：`test-verified.log` 为 104 Vitest + 6 Node PASS，`browser-final-17.log` 为 17 e2e PASS，`build.log` 包含生产资源扫描通过。这些日志在本次局部修复之前；修复后针对性重测如上，最终原生构建由主线程另记。检查首次普通权限运行 pnpm 遇到 `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`，获得沙箱提升后实际执行了以上检查。

源码核对结论：App 是唯一 `useBridge` 调用点；LibraryWorkspace 没有因工作区切换而重挂载，搜索/勾选/编辑输入保留；ContentPreviewPanel/WebPreviewPanel 仅在当前可见详情挂载；设置与整理没有隐式模型/检查/应用命令；非 live 不挂普通编辑，独立历史传递 live 并在确认函数再次阻止离线 apply；EditDesk 的确认、二次确认与 receipt watch 未被 mode 拆分移除。

`scripts/dev-port.d.mts` 仅声明既有导出，`playwright.config.ts` 清除端口子进程输出的终端控制字符；lint/typecheck 与浏览器运行已覆盖这些改动。`scripts/foundation.test.mjs`、`scripts/tauri-dev.mjs` SHA256 与 `preexisting-hashes.json` 一致，未修改。

稳定规范建议已发主线程：虚拟行不得劫持 checkbox 的焦点与键盘；独立 history 继续遵守 preview → live confirm → receipt。规范、任务状态及原生 evidence 由主线程维护。
