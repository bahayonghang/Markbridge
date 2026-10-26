---
name: Markbridge — Airy glass workspace
status: approved
source-entry: style:airy-glass
colors:
  field-start: "#E7F6F1"
  field-end: "#EDE7F8"
  paper: "rgba(255,255,255,0.78)"
  paper-solid: "rgba(255,255,255,0.96)"
  paper-edge: "rgba(255,255,255,0.80)"
  surface: "#FFFFFF"
  sidebar: "#F1FAF6"
  ink: "#24303A"
  muted: "#5C6B76"
  accent: "#187A56"
  selected: "#E7F7F0"
  output: "#6D4BD6"
  output-wash: "#F3EEFC"
  primary-fill: "#187A56"
  primary-hover: "#146A4A"
  primary-pressed: "#105A3E"
  primary-ink: "#FFFFFF"
  control-border: "#73828C"
  line: "#D6E4DF"
  hover: "#EDF7F3"
  pressed: "#E2F1E9"
  row-hover: "#F2F9F6"
  disabled-surface: "#EEF3F1"
  danger: "#A93232"
  caution: "#80570F"
  field-start-dark: "#162820"
  field-end-dark: "#262238"
  paper-dark: "rgba(30,38,43,0.90)"
  paper-solid-dark: "rgba(30,38,43,0.96)"
  paper-edge-dark: "rgba(181,193,201,0.24)"
  surface-dark: "#1E262B"
  sidebar-dark: "#24312D"
  ink-dark: "#EAF0F3"
  muted-dark: "#B5C1C9"
  accent-dark: "#86D9B4"
  selected-dark: "#203C32"
  output-dark: "#C6B3FF"
  output-wash-dark: "#342C49"
  primary-fill-dark: "#86D9B4"
  primary-hover-dark: "#A0E6C7"
  primary-pressed-dark: "#71C8A2"
  primary-ink-dark: "#162820"
  control-border-dark: "#91A3AF"
  line-dark: "#3E504C"
  hover-dark: "#293C35"
  pressed-dark: "#254335"
  row-hover-dark: "#26372F"
  disabled-surface-dark: "#27343A"
  danger-dark: "#FFABA3"
  caution-dark: "#E8C47D"
typography:
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 1.6
    fontWeight: 400
  mono:
    fontFamily: '"Cascadia Code", Consolas, ui-monospace, monospace'
rounded:
  control: 8px
  dialog: 16px
  paper: 20px
  action: 999px
material:
  field-angle: 160deg
  sheet-blur: 20px
  sheet-saturate: 1.15
  backdrop-max: 1
  solid-breakpoint: 960px
  field-inset: 16px
motion:
  press-scale: 0.98
  press-duration: 120ms
---
<!-- design-md: entry=style:airy-glass; source=first-party; license=MIT -->
<!-- customized: Markbridge Windows workbench; dark semantic palette, local user fonts, existing virtual-row geometry, one paper, solid reading surfaces, accessible fallbacks -->

## Overview

以薄荷—淡紫低饱和场、单层纸面和清晰绿/紫语义替换Claude暖纸视觉。2026-10-25用户批准G01→G02→G03；设计批准不等于所有阶段验收通过。任务与当前证据在.trellis/tasks/10-25-mb-airy-glass-refactor。

保留Markbridge名称和蓝色图标、浅色/深色/跟随系统。深色为项目扩展；目录本身没有深色，不宣称原目录提供。根DESIGN.md与styles.css是唯一视觉合同及实现层，不增加皮肤设置或第二主题系统。

## Colors

field-start/end只构成#root的160deg静态渐变，不把渐变传给全部既有canvas消费者。canvas为同主题起始实底色，surface一直为完全不透明阅读面。

paper是唯一允许模糊的workspace填充；paper-solid是无模糊时的高不透明回退，0.96仍须合成验证。光边仅作材料边缘，不承担输入/按钮的3:1边界。

accent承担输入、链接、已确认完成、焦点与普通选中；output仅用于输出/结果区域的标记和摘要，正文始终ink。proposal不等于完成，颜色不改变授权和回执语义。danger/caution及未知状态同时带文字。

primary-border复用primary-fill，focus复用accent，disabled-ink复用muted。selected在hover/pressed保留选中填充。禁用无hover效果，不用整体opacity使文字变淡。所有状态颜色在同一CSS令牌层。

## Typography

保留本机系统默认与用户已安装字体、12–20px精确字号、v2偏好与v1只读迁移，不下载Figtree或任何网络字体。代码/端口继续等宽。

resolveAppearanceMetrics是字号、控件和虚拟行高的唯一来源。正文1.6、书签标题1.6、caption1.5；caption不低于12px。不套用目录1.7造成固定行错位，不用zoom/transform缩放文字或逐书签测量。

12/14/20px对应树40/40/48、书签52/56/76、控件40/40/48px。保留隐藏列表的行/像素锚点、底部、checkbox焦点、选择与草稿。

## Layout

维持左应用导航、设置左分类与内容内部滚动。应用栏216px，<800px图标栏64；设置分类184/152/132。详情在≥1100px使用clamp(312px,26vw,400px)，低于此宽度替换列表；目录<800px替换。960px只决定材料，不改变这些布局断点。

宽度≥960且高度≥551时#root边距16px、paper圆角20px/1px光边/单阴影；窄窗或低窗去外边距和外圆角以保护工作区。正式最小640×480，20px时至少一完整书签行与全部最终动作可达。

设置表单上限1040px、连接和历史数据上限1440px；连接双列条件仍为宽度≥max(960px,64rem)，设置行叠列≤max(600px,40rem)。不新增导航层级、拖拽分栏或营销内容。

## Elevation & Depth

#root承载场，workspace是唯一blur20px saturate1.15纸面。整个视口最多一层backdrop-filter，不放blob，不嵌套paper。默认纸面阴影0 20px 48px rgba(70,90,120,.08)，深色同几何rgba(0,0,0,.18)。

列表行、正文、输入、well、sticky标题/tabs和dialog都保持实底，无二次模糊。浮层单阴影0 12px 32px rgba(70,90,120,.12)，深色rgba(0,0,0,.24)。dialog::backdrop只有遮罩，浅#24303A66、深#10181DB3，不模糊。

## Shapes

普通动作按钮与标签用pill；密集导航、分类、breadcrumbs、tabs、输入及虚拟行保留8px工具控件圆角；dialog/well16px。避免将密集列表变成胶囊堆。

按压仅按钮允许scale(.98)，只对transform过渡120ms；键盘focus-visible不缩放，reduced-motion关闭。不得缩放整个paper、窗口或滚动容器。

## Components

- 导航/列表：选中底色、文字/aria状态区分，hover不覆盖selected；checkbox独立键盘语义保持。
- 输入/按钮：default、hover、pressed、focus-visible、disabled、loading、error分别核验；焦点≥2px；文字≥4.5:1，边界/焦点≥3:1。
- 详情/设置：保持阅读宽度、实底sticky、底部动作可达，不隐藏必要审查信息。
- 字体/确认：保留native dialog焦点约束、Escape、取消优先和返回触发器，不用装饰浮层替换交互。
- 整理/语义/历史：范围/输入与结果分层；错误、只读、不确定结果有真实文字；不新增隐式模型/抓取/索引/写入。

## Do's and Don'ts

Do：单纸面；可读的实底内容；相同角色浅深对应；透明度合成后验证；保留用户字体和布局合同。

Don't：逐行blur、玻璃嵌套、叠加辉光、动画模糊、负中文字距、把光边当控制边界、缩小文字消除溢出、用换色掩盖状态或授权。

## Responsive Behavior

- <960px：paper-solid、blur none。
- prefers-reduced-transparency:reduce：所有宽度paper-solid、blur none。
- 不支持backdrop-filter：基础样式即回退；增强在@supports内。
- forced-colors:active：系统Canvas/CanvasText/ButtonText/Highlight等，去渐变、blur、阴影，保留可辨焦点；这是装饰材料的可访问性例外。
- prefers-reduced-motion:reduce：禁用非必要缩放/过渡。

验证七尺寸：640×480、640×760、1100×480、1100×760、1440×900、1920×1080、2549×1356，加959/960材料边界。每尺寸浅深14/20，12至少极窄和极宽。不扩展到移动端。

## Iteration Guide

1. G01令牌/外壳/共享控件→G02全页面适配→G03当前产物集成，前一阶段PASS后推进。
2. 新样式先更新设计再消费同一令牌。度量/存储/权限/业务生命周期变化须回到规划。
3. 合成对比度验证两场端点、中间样本及实际消费状态；未知背景不能按白底忽略。静态候选预检不是运行验收。
4. B10K滚动前后同机三轮，p95中位数≤max(基线×1.2,基线+2ms)，DOM有界；普通搜索独立p95≤200ms。
5. 浏览器模拟与真实Windows/WebView2/DPI分开记；不复写归档证据，不将编译当原生PASS。

## Known Gaps

目录无深色；本项目自行补足。目录Figtree/1.7正文/paper按压/最多6层已分别适配为用户本机字体/原几何/只按钮按压/最多1层。4px密集内部间隔和40px桌面目标保留，不宣称44px移动目标。

Windows透明度系统设置是否传播到WebView2媒体查询须原生实测；模拟只能证明CSS分支。远程preview网页、扩展页面、系统文件对话框与原生标题栏不继承此主题。

根目录旧Claude设计已保存在G01/research，历史验收不改写。旧13/V12、15/V18不因本轮视觉改造关闭。
