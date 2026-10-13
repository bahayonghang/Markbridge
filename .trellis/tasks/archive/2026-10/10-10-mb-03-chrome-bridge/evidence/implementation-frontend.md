# 03 桌面连接界面实施记录

状态：前端实现和局部检查 PASS；原生 Tauri 交互 UNVERIFIED。浏览器截图和 mock IPC 测试不替代原生配对、Chrome 生命周期或 OS 凭据存储验收。

## 实现范围

- `apps/desktop/src/App.tsx`：连接端口、启动/重试、一次性配对串、已验证候选身份及真实 Origin 的人工确认/取消、已配对资料节点计数、来源 revision、最近同步时间、重连和吊销。保留安全启动失败分支。
- `apps/desktop/src/backend.ts`：通过生成的 `parseBridgeState`、`parsePairingOffer` 验证 unknown IPC 和事件；浏览器预览返回未配对状态并拒绝原生命令。
- `apps/desktop/src/useBridge.ts`：先订阅再读取启动/连接状态，以进程 revision 丢弃旧响应，注册完成前卸载也会退订。
- `apps/desktop/src/styles.css`：沿用 Segoe UI/Microsoft YaHei UI、灰绿背景、白色平面和全局 CSS。保持可见焦点、跳转内容链接和按钮按压反馈；无新依赖或装饰动画。
- `apps/desktop/src/App.test.tsx`、`backend.test.tsx`：前端行为和边界测试。
- `tests/e2e/foundation.spec.ts`：真实浏览器预览及仅由测试 route 提供的 mock backend；产品源码不读取 harness query，也不提供测试控制入口。
- `vitest.config.ts`：按主会话授权增加扩展测试 glob，保留原有前端和协议测试入口。

配对串只放在当前组件临时状态，120 秒到期后清除；确认、取消或卸载后清除。不写 localStorage、URL 或日志。长期凭据不进入前端。

## 局部检查

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `pnpm --filter @markbridge/desktop typecheck` | 0 | PASS |
| `pnpm exec tsc -p tsconfig.tools.json` | 0 | PASS |
| `pnpm exec eslint apps/desktop/src tests/e2e vitest.config.ts --max-warnings 0` | 0 | No issues found |
| `pnpm exec vitest run apps/desktop/src/App.test.tsx apps/desktop/src/backend.test.tsx --reporter=json --outputFile=.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/frontend-vitest.json` | 0 | 15/15 PASS；原始 JSON 在同目录 |
| `pnpm exec playwright test tests/e2e/foundation.spec.ts` | 0 | 6/6 PASS，3.3 秒 |
| `pnpm --filter @markbridge/desktop build` | 0 | Vite 8.3.4，29 modules，112 ms |

行为覆盖：浏览器禁用原生命令、安全启动失败、订阅早于 hydration、事件先于旧响应、旧命令响应丢弃、端口范围与编辑重试、显式确认身份、未验证候选无确认入口、取消、重连核对期间只读、吊销保留缓存、无效事件拒绝、迟到注册退订、开发重挂载、到期配对串清除和卸载后迟到配对结果。

## 首次失败及重测

首次 desktop typecheck 因测试函数直接访问 `.mock` 失败，TypeScript 报 TS2339：

```text
src/App.test.tsx(56,39): error TS2339: Property 'mock' does not exist on type '(onState: (state: BridgeState) => void, onInvalid: () => void) => Promise<() => void>'.
src/App.test.tsx(56,104): error TS2339: Property 'mock' does not exist on type '() => Promise<BridgeState>'.
[ELIFECYCLE] Command failed with exit code 2.
```

测试改用 `vi.mocked(...)` 后，单独执行 desktop typecheck 返回 0。之后工具 TypeScript、前端 ESLint 和最终 15 项 Vitest 检查均通过。

## 浏览器视觉验证

Playwright 实际渲染并读取了以下四张截图。截图为 fullPage；1100×760、640×480 表示浏览器 viewport。内容超过窗口高度时纵向滚动，未发现横向溢出。

- `browser-preview-1100x760.png`
- `browser-preview-640x480.png`
- `browser-diagnostics-mock-1100x760.png`
- `browser-diagnostics-mock-640x480.png`

预览截图始终未配对且按钮禁用。诊断截图显示明确标记的测试资料，仅包含 synthetic 节点计数和连接状态，不含配对串或任何真实凭据。主标题、本机地址、节点数和只读标签在两个尺寸均可读；键盘首个 Tab 可到达“跳至内容”。

视觉方向保持现有工具界面的字体、色彩和白色分区；数字采用等宽数字特性。未引入图标、图片、阴影卡片或新的书签树界面。真实资料通过已验证的 BridgeState 填充，无产品占位数据。

## 验收边界

未执行原生 Tauri 配对交互、真实 Chrome 扩展场景、OS 凭据验证或完整正式矩阵。上述项目由主会话协调，前端局部结果不能将 AC03-* 标为全部满足。没有提交、归档、发布、安装或操作日常 Chrome 数据。
