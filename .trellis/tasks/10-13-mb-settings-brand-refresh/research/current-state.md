# 当前界面与源码分析

日期2026-10-13，起始main/efd5728、工作树clean。仅研究源码和任务，未运行产品构建、测试或原生交互。

| 观察 | 证据 | 影响 |
|---|---|---|
| 横向分类占一行 | apps/desktop/src/App.tsx:82、apps/desktop/src/styles.css:142 | 独立纵向分类，区别主导航与设置导航 |
| 内容上限880px，分区上下24px，资料区再加20px间距 | apps/desktop/src/styles.css:146、:147、:165 | 同时改宽度及组织，宽屏并列资料/接入，不能只缩padding |
| 已连接后安装、启动、配对仍先于资料管理 | apps/desktop/src/features/settings/ConnectionSettings.tsx:121 | 日常来源优先，首次引导保留真实步骤 |
| 导出由长期挂载LibraryWorkspace承载，位于settings-scroll之外 | apps/desktop/src/App.tsx:76、:94、apps/desktop/src/features/library/LibraryWorkspace.tsx:586、:766 | 只移动视图，保留来源、草稿及切换守卫 |
| AI懒加载，语义使用active/generation | apps/desktop/src/App.tsx:48、:97、apps/desktop/src/features/semantic/SemanticSettings.tsx:18 | 不重建面板，不让切换发起隐式任务 |
| 浅色token和硬编码hover/disabled/backdrop并存 | apps/desktop/src/styles.css:1、:26、:30、:55、:105、:157 | 深色必须补共享语义变量 |
| Windows混排字体栈，字号多数px | apps/desktop/src/styles.css:2、:6、:108 | 根字号变化不足以实现全局字号 |
| 树行默认40px，书签52px，虚拟定位乘rowHeight | apps/desktop/src/features/library/VirtualRows.tsx:23、apps/desktop/src/features/library/LibraryWorkspace.tsx:644 | 文字、CSS行框和虚拟几何需一致 |
| 程序绿底白书签，侧栏蓝底线形书签 | 已视检apps/desktop/src-tauri/icons/icon.png，apps/desktop/src/App.tsx:63 | 缺“桥”识别点，端点品牌不一致 |
| 扩展未配置icons/default_icon | apps/extension/public/manifest.json:7 | 同母版本地PNG，不增加权限 |
| 原生最小640×480、常规1100×760 | apps/desktop/src-tauri/tauri.conf.json:13 | 最小窗保留左栏文字，不退回横向Tab |

截图仅用于视觉诊断，不把数量、时间、连接当作当前事实。880px为源码值，原图物理像素不等于CSS像素；实施采集viewport与DPI。

## 继承与差异

归档改版visual-design规定蓝色、中性底、Windows字体、无hero/卡片墙、40px目标和独立滚动，继续继承。本轮主题需求增加深色，超出旧PRD“不含暗色”，作为新规划审阅，不修改旧交付声明。

frontend/component-guidelines目前要求横向左右键。S02实施后改为纵向上下键及相应测试；此时不改有效spec，避免提案被误当实现。现有截图、代码和设计足以确定方向，无需外部产品模板。

## 一手资料

2026-10-13在线核对，仅用于技术约束：

- [WAI Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)：纵向声明aria-orientation=vertical并使用上/下键。
- [Tauri App Icons](https://v2.tauri.app/develop/icons/)：icon命令从母版生成平台资源；Windows消费ICO，生成不等于安装/发布。
- [Chrome icons](https://developer.chrome.com/docs/extensions/develop/ui/configure-icons)：清单使用受支持栅格格式，PNG适合16/32/48/128；manifest不使用SVG。
