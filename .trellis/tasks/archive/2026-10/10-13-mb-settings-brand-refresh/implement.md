# 执行计划

## 本轮规划

- [x] 阅读Trellis、ui、frontend-design、源码和既有设计，保留clean起点。
- [x] 创建独立父任务和S01–S03，保持planning/pending。
- [x] 编写PRD、技术/视觉设计、拆分、验收及上下文。
- [x] 校验任务关系、上下文路径、PRD收敛及diff，结果见planning-validation.md。
- [x] 整理最终审阅摘要；用户随后明确批准按S01→S02→S03实施，见execution-status.md。

## 实施前

重读当前diff、baseline、父/子规划、层索引及两个jsonl。记录最新规划批准证据，不从旧任务granted推导授权。只start当前可启动子任务，不start父任务。实施/check按项目Trellis sub-agent流程，图像仍用内置image_gen。

## 顺序与验证

1. [x] S01生成A/B及尺寸对比，记录选择后导出资产，验证alpha/尺寸/清单/构建和原生图标。
2. [x] S02保留库状态建立左栏与exportHost，重排连接及四类已有设置，验证纵向键盘、来源/导出/草稿/引导和六尺寸几何。
3. [x] S03加入通用与持久化，补主题变量、统一字号及虚拟几何，验证损坏存储/保存失败/系统主题/真实重启及最大字号最小窗。
4. [x] 父任务集成verification，稳定约定回写frontend组件/状态/质量spec，写收据和check-report。

实施后的受影响门槛，以下不是本轮结果：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm protocol:check
pnpm build
pnpm test:e2e
pnpm build:native
git diff --check
```

每个子任务先跑相关检查，只有新改动/失败/未决问题才重跑。新增PNG如影响产物扫描，仅准确处理格式、保留文本安全检查，不预先改扫描脚本。

2026-10-14最终结果：上述全部门槛PASS；232 Vitest、25 Node、133浏览器和当前b94程序原生11控制通过。详见S03收据、独立check-report及父集成check-report。底部字号调整先失败后修复的回归、旧失败尝试和新hash证据分开保留。实施/验收完成，提交和归档仍待单独授权。

## 回滚与结束

资产同次替换/恢复；布局回滚保留库状态；外观只恢复视觉代码和UI偏好键，不清SQLite或Chrome。新产物不能继承旧hash原生验收。新安装若必要，先准备产物并获范围授权。实施完成不等于获准提交、归档、push、签名、发布或安装。
