# G01 轻盈玻璃令牌与应用外壳设计

继承[父设计](../10-25-mb-airy-glass-refactor/design.md)与[现状/目录冲突](../10-25-mb-airy-glass-refactor/research/current-state.md)，不另建相互冲突的令牌或几何定义。

## 所有权

DESIGN.md、styles.css的根令牌/外壳/共享控件、必要App标记、外观测试、相关frontend视觉规范。只做与该交付直接相关的最小变更。

## 合同

禁止改ui-preferences持久化/度量或VirtualRows算法；只有视觉相关TSX标记。root DESIGN替换只在获批后，旧视觉备份与历史证据必须保留。

数据流、主题持久化、单订阅、授权确认、远程权限按现有spec保持；无数据迁移。回滚仅本任务视觉/测试diff，保留用户其他改动与历史证据。

## 证据

[父矩阵](../10-25-mb-airy-glass-refactor/verification.md)是检查来源；本子任务收据保存到自己的evidence，记录代码指纹、命令与退出码。浏览器/mock和原生不可互替。
