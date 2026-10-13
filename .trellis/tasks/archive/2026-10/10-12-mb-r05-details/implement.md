# R05 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] R03、R04 验收通过；复用原07/08/09；受限fetch与preview-*权限合同保持。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 实现详情信息结构与窄窗返回、草稿离开策略。
- [x] 迁标签备注与批量本地事务入口，接R03筛选。
- [x] 迁双预览，保留取消/晚到/受限网络与窗口权限回归。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、标签/预览组件行为、原生窗口焦点/尺寸；涉及远程窗口交互回归V11，浏览器mock不能替代。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。

## R05 原生命令

产品冻结后 `pnpm build:native`，记录产物 SHA256。随后运行 `node .trellis/tasks/archive/2026-10/10-12-mb-r05-details/evidence/native-details.mjs` 和 `node .trellis/tasks/archive/2026-10/10-12-mb-r05-details/evidence/native-web.mjs final`。两个脚本只用临时数据、临时 Chrome（details）和本机测试网页；所有原生结果写唯一 runId，不覆盖失败回执。`baseline` 仅用于准备驱动，不算 R05 验收。Web 驱动以实际页面脚本和真实 IPC 验证独立权限/会话；Chrome 外开接力暂停在自有 rundll32 创建后并终止，不打开日常浏览器。
