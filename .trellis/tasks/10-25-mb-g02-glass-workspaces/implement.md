# G02 全工作区样式适配与交互回归执行

## 启动门槛

仅在 10-25-mb-g01-glass-foundation 阶段验收PASS后启动。 核对用户对最终规划的后续批准、git diff、spec、implement/check manifests；仅启动本子任务。父任务不start。

## 顺序

- [x] 核对G01验收与最新源码，保持其材料令牌而不是创建页面私有主题。
- [x] 按父研究清单迁移列表/详情，再设置/接入，再整理/语义/历史/导出。
- [x] 适配字体和危险dialog及路径浮层，保留实底、top layer、取消优先与焦点返回。
- [x] 运行七尺寸/状态/几何/键盘回归，保留所有失败和重测，不覆盖历史证据。
- [x] 独立check并写页面覆盖表；G02 PASS后才可启动G03。

## 验证

pnpm lint；pnpm typecheck；pnpm test；pnpm exec playwright test tests/e2e/workspace-layout.spec.ts tests/e2e/workspace-layout-review.spec.ts tests/e2e/settings-layout.spec.ts tests/e2e/font-picker.spec.ts tests/e2e/appearance.spec.ts tests/e2e/editing.spec.ts tests/e2e/details.spec.ts tests/e2e/history.spec.ts tests/e2e/organize.spec.ts tests/e2e/semantic.spec.ts tests/e2e/connection.spec.ts --workers=1。

按父verification矩阵评判。只设置本任务MARKBRIDGE_EVIDENCE_DIR；G02阶段验收PASS，见evidence/gate-review.md；最终原生仍属G03。代码完成后按工作流派发trellis-check，无法运行的原生项保持NOT_RUN并阻止对应完成声明。

## 回滚

App/LibraryWorkspace的挂载、portal、source/epoch、query、draft和订阅所有权不可改。不能为视觉把正文缩小、丢掉必要授权信息或放宽回归阈值。 失败回拥有该改动的阶段修复，不靠改门槛通过。
