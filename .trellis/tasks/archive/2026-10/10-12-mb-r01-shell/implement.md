# R01 执行

## 启动

- [x] 用户批准最新完整规划，implementation_approval=granted。
- [x] 无新子任务依赖 验收通过；无真实 Chrome 前置；仅壳层与合成数据，不宣称旧同步通过。
- [x] 检查diff，读取baseline、本项prd/design/implement、父规划和JSONL；按受影响层加载spec。

## 顺序

- [x] 从父原型提取 token 和布局，补现有首屏/checkbox样式回归。
- [x] 提取导航与设置容器，将 AiSettings 和连接表单移入，保持原行为。
- [x] 统一状态/焦点与分区滚动，逐尺寸截图检查。
- [x] 通过Trellis实施与独立检查，补实际截图/回执路径并更新稳定spec。

## 验证

前端四项、App/既有功能组件回归、浏览器窗口矩阵；原生实际截图在本项保留单独证据，最终R08复核。

逐条对应AC，记录真实命令/退出码/环境/样本与首次失败。尚未运行标NOT_RUN；缺原生证据标UNVERIFIED。必要命令见父implement.md，变化时同步受影响计划。完成本项不自动提交、归档或发布。
