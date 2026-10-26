# 基线恢复收据（2026-10-25）

保留原`baseline-receipt.md`的失败尝试。关联聊天已从HEAD `2ac7979`用git archive冻结产品输入到`runs/airy-glass-baseline`；G01/research同时保留原CSS与DESIGN备份。普通目录依赖恢复后，本会话以独立端口14936再次验证旧产品。

- 五项浏览器基线：PASS，5 expected、0 unexpected、0 skipped、0 flaky；机器报告见[G01 baseline recheck](../../10-25-mb-g01-glass-foundation/research/baseline-recheck-results.json)，截图位于同级`baseline-recheck`。
- B10K基线：关联聊天已执行浅深各三轮，Edge156.0.4314.42、1440×900、14px、相同R03合成fixture；两主题p95中位数均7ms，blur层0。原始帧和trace在[G01 baseline performance](../../10-25-mb-g01-glass-foundation/research/baseline-performance-results.json)及`baseline-performance/`。这是浏览器滚动基线，不是原生搜索。
- 环境：Windows10.0.26300、Ultra9 275HX、24逻辑CPU、68,143,853,568字节内存。源码CSS摘要、机器与结果摘录见[G01 baseline summary](../../10-25-mb-g01-glass-foundation/research/baseline-summary.json)。
- 使用仓库根普通目录`node_modules`里的CLI；原pnpm依赖备份保留在runs。未修改锁文件或产品依赖版本。

复现：设置`MARKBRIDGE_BASELINE=1`、`MARKBRIDGE_DEV_PORT=14936`和当前证据目录，直接运行`node node_modules/@playwright/test/cli.js test --config .trellis/tasks/10-25-mb-g01-glass-foundation/research/validation.config.mjs appearance.spec.ts workspace-layout.spec.ts --grep 'C03 workspace (light|dark) 14 1440x900|C03 workspace light 20 640x480|C02 (light|dark) contrast uses rendered semantic colors' --output test-results/glass-baseline-recheck --reporter=json`。

基线补验完成，不代表当前G01或最终G03验收通过。原生/DPI仍需当前产物独立证据。
