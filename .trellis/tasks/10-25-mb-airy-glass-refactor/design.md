# 轻盈玻璃技术设计提案

状态：2026-10-25用户已批准实施。目录style:airy-glass已通过官方apply脚本落至research/catalog/DESIGN.md；根DESIGN.md已在G01应用并按项目合同定制，原版保留于G01/research/DESIGN.claude-backup.md。

## 架构与材料

继续styles.css唯一令牌层和data-theme。无新依赖/provider/DTO/持久化字段。偏好仍由App→applyUiPreferences→根CSS变量/RowHeightsContext传递，业务挂载和数据流不变。

#root作为薄荷—淡紫160deg静态场，workspace为唯一paper：白0.78、20px圆角、blur20px saturate1.15、1px半透明光边、单淡阴影。默认无blob。≥960px且高度>550时外边距16px，workspace用可用高度；低窗或<960无外边距/外圆角，保护工作区。app-main不使用整块实底完全遮掉材料，但具体列表、正文、输入、well、sticky和dialog保持实底。文本不直接落在场上。

只允许workspace消费blur，任一视口≤1层；dialog、::backdrop、行、图像与well不得加blur。不为装饰堆深层DOM。布局容器无transform；复用动作按钮0.98/120ms，键盘及reduced-motion关闭。原生标题栏不变。

## 候选角色

以下保留原规划候选与预检来源；G01已完成实际消费状态检查，G03提供最终集成收据。深色是项目扩展。研究期已用research/palette-preflight.py检查100组静态颜色组合，0失败（含双端背景、默认alpha及0.96回退），结果在research/palette-preflight.json。这不覆盖hover/pressed等尚未实现状态，也不替代运行时消费对比度。

| 角色 | 浅色 | 深色 |
|---|---|---|
| field-start/end | #E7F6F1 / #EDE7F8 | #162820 / #262238 |
| paper | rgba(255,255,255,.78) | rgba(30,38,43,.90) |
| paper-fallback | rgba(255,255,255,.96) | rgba(30,38,43,.96) |
| surface-solid | #FFFFFF | #1E262B |
| ink/muted | #24303A / #5C6B76 | #EAF0F3 / #B5C1C9 |
| accent/input/focus | #187A56 | #86D9B4 |
| selected/input-wash | #E7F7F0 | #203C32 |
| output/output-wash | #6D4BD6 / #F3EEFC | #C6B3FF / #342C49 |
| primary/on-primary | #187A56 / #FFFFFF | #86D9B4 / #162820 |
| control-border | #73828C | #91A3AF |
| danger/caution | #A93232 / #80570F | #FFABA3 / #E8C47D |

--canvas保留实底兼容角色，场新增单独变量；--surface继续实底，材料另用paper-fill。--accent/--focus映射input；output仅结果标题/标记/摘要，正文仍ink。完成只能来自真实receipt，生成proposal不表示成功。错误/警告/未知有独立文字。

在同一令牌区定义hover/pressed/disabled/selected-hover/loading/error；selected-hover保持selected，disabled不整体opacity。新增颜色仅出现在令牌层，不顺带重写历史spacing常量。光边不承担控件3:1边界。

## 字体与组件

保留用户字体、12–20范围、v1/v2和resolveAppearanceMetrics；正文1.6、列表标题1.6/caption1.5，不照搬1.7造成行高变化。动作按钮/标签pill；输入/导航/列表8–12px、well16px、paper20px。不缩小文字，不加32px装饰数字。

逐页覆盖以research/current-state.md为准。危险确认仍native dialog默认取消；字体候选只在样例预览，应用/取消不变。sticky标题/tabs实底，内部滚动保留。

## 回退

- 基础样式paper-fallback+none；仅≥960、支持backdrop-filter且没有减少透明度要求时启用材料；额外测959/960。
- prefers-reduced-transparency:reduce覆盖到无blur；原生不暴露时记录限制，不宣称响应Windows开关。无filter fixture只证明回退逻辑，不冒充实际平台缺失。
- forced-colors用系统Canvas/CanvasText/ButtonText/Highlight等，移除blur/渐变/阴影；保留焦点，属于装饰材料的可访问性例外。
- reduced-motion取消非必要缩放/transition；不动画blur、场或工作台。
- 960只管材料，保留800文件夹/1100详情和字号敏感设置容器断点；低窗重新检查状态栏避让与可视区域。

## 合成验证与性能预算

旧测试不能解析alpha。测试辅助器按层以C=alpha*前景+(1-alpha)*背景合成再算亮度；未知颜色/图片/渐变必须报错，不默认白底。固定双端场验证两端及实际消费者位置样本，取最差；无法可靠建模时提高不透明度或采用实底。目录静态表保留原文，新计算单列收据。

允许背景只有指定静态场，无图片/blob。paper、实底、hover、选中、警告、dialog均验证最终状态。透明度0.96仍不是数学上的全不透明，必须继续合成；forced-colors使用系统色单独核验。

B10K改造前后使用同机器/浏览器/viewport/主题/fixture/滚动脚本，每种3轮，记录rAF帧间隔p95、长帧和trace。预算：改后p95三轮中位数≤max(基线中位数×1.20,基线中位数+2ms)。该预算随规划批准，不能跑后改通过线。DOM保持viewport有界，blur≤1，行filter=none。超预算优先减少材料覆盖或改实底，不先改虚拟化算法。原普通搜索p95≤200ms保持，与滚动指标分别记录。

## 迁移与回滚

G01获批后执行design-md apply style:airy-glass --root项目 --force，保存时间戳备份于任务research；按本提案定制根DESIGN.md并保留来源注释，记录深色/字体/密度/禁止整页缩放例外，同步frontend component/ui-preferences视觉段落。历史证据只读。

允许改styles.css、必要TSX标记、对应测试和规范。若需几何公式、业务生命周期或IPC变化，退回规划。回滚仅恢复本任务视觉diff，不清偏好/数据库、不整库reset。无数据迁移。
