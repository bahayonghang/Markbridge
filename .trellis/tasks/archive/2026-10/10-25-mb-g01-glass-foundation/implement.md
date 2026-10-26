# G01 轻盈玻璃令牌与应用外壳执行

## 启动门槛

用户已批准完整规划，并于2026-10-25允许G01在基线环境恢复前先启动；基线和验收仍须补齐，未PASS不得推进G02。 核对用户对最终规划的后续批准、git diff、spec、implement/check manifests；仅启动本子任务。父任务不start。

## 顺序

- [x] 恢复可运行测试环境并补改造前基线/滚动记录，无法运行不得把该门槛算过。
- [x] 按父design执行目录apply --force和备份，再定制根DESIGN与相关spec。
- [x] 拆开paper/solid令牌，接单paper、field、边距、共享按钮/输入/焦点及回退。
- [x] 更新alpha合成对比度验证，新增材料层/回退用例；保留原行为断言。
- [x] 运行阶段检查、查看浅深及小窗截图、独立check并写收据，G01 PASS后才可启动G02。

## 验证

pnpm lint；pnpm typecheck；pnpm exec playwright test tests/e2e/appearance.spec.ts tests/e2e/shell.spec.ts tests/e2e/appearance-captions.spec.ts --workers=1；新增airy-glass材料/回退用例；受影响Vitest。

按父verification矩阵评判。只设置本任务MARKBRIDGE_EVIDENCE_DIR；G01阶段检查PASS，见evidence/check-report.md；最终原生仍属G03。代码完成后按工作流派发trellis-check，无法运行的原生项保持NOT_RUN并阻止对应完成声明。

## 回滚

禁止改ui-preferences持久化/度量或VirtualRows算法；只有视觉相关TSX标记。root DESIGN替换只在获批后，旧视觉备份与历史证据必须保留。 失败回拥有该改动的阶段修复，不靠改门槛通过。
