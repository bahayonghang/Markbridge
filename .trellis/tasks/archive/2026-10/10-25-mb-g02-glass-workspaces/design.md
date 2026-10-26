# G02 全工作区样式适配与交互回归设计

继承[父设计](../10-25-mb-airy-glass-refactor/design.md)与[现状/目录冲突](../10-25-mb-airy-glass-refactor/research/current-state.md)，不另建相互冲突的令牌或几何定义。

## 所有权

styles.css页面规则、现有feature组件必要语义class/标记及对应浏览器回归。只做与该交付直接相关的最小变更。

## 合同

App/LibraryWorkspace的挂载、portal、source/epoch、query、draft和订阅所有权不可改。不能为视觉把正文缩小、丢掉必要授权信息或放宽回归阈值。

数据流、主题持久化、单订阅、授权确认、远程权限按现有spec保持；无数据迁移。回滚仅本任务视觉/测试diff，保留用户其他改动与历史证据。

## 证据

[父矩阵](../10-25-mb-airy-glass-refactor/verification.md)是检查来源；本子任务收据保存到自己的evidence，记录代码指纹、命令与退出码。浏览器/mock和原生不可互替。
