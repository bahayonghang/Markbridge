---
name: Markbridge — Claude-inspired workspace
status: approved
source-entry: style:claude
colors:
  primary: "#38362f"
  primary-hover: "#48453c"
  primary-pressed: "#25241f"
  on-primary: "#faf9f5"
  canvas: "#faf9f5"
  sidebar: "#f0eee7"
  surface: "#fdfcf9"
  text: "#25241f"
  muted: "#68665d"
  accent: "#a34b2f"
  selected: "#eae4d8"
  hover: "#efebe2"
  pressed: "#eae4d8"
  row-hover: "#f5f2eb"
  disabled-surface: "#f0eee7"
  line: "#ded8cc"
  control-border: "#847e72"
  danger: "#a93232"
  warning: "#80570f"
  canvas-dark: "#24231f"
  sidebar-dark: "#201f1b"
  surface-dark: "#2e2c27"
  text-dark: "#efede5"
  muted-dark: "#b6b2a7"
  accent-dark: "#dea58b"
  selected-dark: "#40392f"
  hover-dark: "#38352e"
  pressed-dark: "#40392f"
  row-hover-dark: "#35322b"
  disabled-surface-dark: "#302e28"
  line-dark: "#514c42"
  control-border-dark: "#8c877a"
  primary-dark: "#e3ded2"
  primary-hover-dark: "#f2eee4"
  primary-pressed-dark: "#d1cabb"
  on-primary-dark: "#26241f"
  danger-dark: "#ffaba3"
  warning-dark: "#e8c47d"
typography:
  body-md:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 1.6
    fontWeight: 400
  h1:
    fontFamily: inherit
    fontSize: 20px
    lineHeight: 1.4
    fontWeight: 600
  mono:
    fontFamily: '"Cascadia Code", Consolas, ui-monospace, monospace'
    fontSize: 1rem
    lineHeight: 1.6
rounded:
  sm: 4px
  md: 8px
  lg: 12px
spacing:
  sourceScale: "4/8/12/16/24/32"
---
<!-- design-md: entry=style:claude; source=https://github.com/bergside/awesome-design-skills@f631a09; license=MIT -->
<!-- customized: Markbridge desktop adaptation; warm light/dark palettes, local CJK fonts, scalable typography, data-workspace layouts and accessible states -->

## Overview

以暖纸色、近黑墨色和克制的陶土强调色，建立易读、稳定的本地书签工作台。2026-10-14 用户已批准顺序实施；C01 主题和 C02 本机字体及精确字号已验收，C03 页面布局正在核验，C04 负责当前产物集成。各项验收以任务证据为准。

基于 design-md 的通用 `style:claude`，不混入 `brand:claude` 的官网结构。不添加 Claude/Anthropic 标志、名称或专有字体文件。保留 Markbridge 现有蓝色图标与名称；蓝色图标是品牌资产，交互色改用语义角色。浅/深色及跟随系统继续存在，不增加皮肤选择器。

## Colors

使用以上颜色角色；实施在现有 `apps/desktop/src/styles.css` 建立一层令牌，不并存第二套主题引擎。

- canvas 为工作区基底；sidebar 为导航；surface 为主要阅读面；selected 为当前项。
- primary 是最重要动作；accent 是链接/选中标记/焦点。现有 `--blue` 消费点迁移到 `--accent` 或相应语义角色，不能只改色值继续把语义绑在颜色名上。
- focus 复用 accent，disabled-ink 复用 muted。选中项在 hover/pressed 时保持 selected；普通按钮使用 hover/pressed，主按钮分别使用 primary-hover/primary-pressed。禁用按钮不响应 hover，不降低整体 opacity。
- line 只作装饰分组；可操作边界使用 control-border。错误与警告必须同时有文字或图标。
- 深色为暖炭灰，不直接反相。禁用状态降低强调但文字仍可读；hover/pressed 单独定义并验证，不能用透明度把对比度降到不可读。
- 已计算 20 组候选对比度，见任务 `research/palette-contrast.json`；这是静态配色预检，不是运行页验收。正文 ≥4.5:1，控件边界/焦点 ≥3:1；所有实际消费组合须重新实测。

## Typography

所有可信主窗口页面使用用户字体选择。默认用本机系统字体栈，不下载网络字体，不捆绑 Anthropic Sans/Serif、Copernicus 或 StyreneB。

frontmatter和下表给出14px基准的示例值；实际字号切换时，各角色与行高统一由父design的resolveAppearanceMetrics计算，不能再按独立rem倍率维护第二套字阶。C01阶段仍保留旧偏好尺寸，C02上线v2后才采用新用户14px默认。

C01 在同一 `:root` 中将现有字号归入 caption/label/section/prominent/dialog/heading 角色；辅助字不低于12px，现有正文12/13/15、控件40/40/44及树/书签虚拟行几何保持。C02 的集中度量上线时替换这些过渡角色值，不额外叠加一套缩放。

| 角色 | 默认 14px 基准 | 规则 |
|---|---:|---|
| 正文/输入/导航 | 14px | 400；中文不加负字距 |
| 辅助说明/URL/时间 | 12px | 不低于12px，随用户字号增长 |
| 列表标题 | 15px | 500；单行截断，完整内容在详情可读 |
| 分组标题 | 16px | 600；与正文保持清晰间距 |
| 页面标题 | 20px | 600；不使用官网48/64px展示标题 |
| 代码/端口/结构化标识 | 跟随正文 | 保留等宽角色，不强制用户界面字体 |

建议用户字号范围 12–20 CSS px，步长1，提供12/14/16/18/20快捷值及数值输入；越界/无效输入保留上次有效值并提示。原有小/标准/大迁移为12/13/15，避免升级擅改既有字号；新用户及恢复默认为14。

字号和虚拟行几何必须来自同一个纯函数。不得用 CSS zoom、transform 或让浏览器自行撑开固定虚拟行。具体尺寸合同见父任务 design.md。

## Layout

继续采用应用左导航 + 书签工作区 / 设置左分类，不重写路由或状态所有权。

- 窗口宽 ≥1200：应用导航216、设置分类184；800–1199：设置分类152；640–799：应用图标栏64、设置分类132。保持现有折叠习惯。
- 内容边距24，紧窄窗口16/12；纵向分组24，组内8/12/16。主标题、说明、内容及动作使用统一起始线。
- 设置表单阅读宽度上限1040；连接管理和历史数据区可到1440；书签列表使用可用宽度。空白用于阅读节奏，不要求卡片铺满屏幕。
- 连接两栏保留，阈值为 max(960px, 64rem)，用两个 min-width 容器条件共同判定。大字号自动提前叠列。来源状态/主要动作靠近标题；端口等高级项保留折叠。
- 列表详情在 ≥1100 的宽屏使用 clamp(312px, 26vw, 400px)；不足以容纳列表时沿用替换模式。列表/详情/设置各自滚动，页面不出现横向滚动。
- 字体选择器和确认弹窗限定在可视区域；窄窗/低窗可滚动访问底部动作。不增加拖拽分栏、仪表盘或新导航层级。
- 窄窗文件夹/详情入口使用带可访问名称与提示的图标按钮；低窗工具栏可内部滚动，保留至少一整行书签。文件夹替换层避让随字号增长的底部状态条；详情固定标签栏避让实际标题高度。

## Elevation & Depth

普通阅读面无阴影或装饰渐变。浮层只使用一层轻阴影和可辨边界。对话框保留现有 backdrop、焦点锁定和返回焦点。非必要动画尊重 reduced-motion；不新增入场动画。

## Shapes

控件/选中项8px，较小标记4px，对话框12px。中文工具应用不采用目录中不对称CTA、硬直角营销按钮或倒置广告卡片。现有图标沿用，不用emoji替换。

## Components

- **导航/分类**：图标+名称，当前项用底色、字重及 aria 状态区分；hover 不覆盖 selected。
- **设置行**：左侧名称/解释、右侧控件；容器≤max(600px,40rem)时上下排，默认行距16–24。通用为第一项。
- **字体选择器**：独立“选择字体”操作打开搜索/列表/样例；列表名称用当前稳定UI字体，单个候选在样例区预览；选择后点“使用此字体”，取消不改变应用。提供系统默认和本机列表，刷新由用户触发。
- **字号控件**：显示明确px数值，键盘可操作；有效提交即时生效，不因输入临时空值重置UI。
- **预览**：中文、拉丁、数字、标点和长标题；字体切换只作用于样例直到应用。中文缺字通过既定回退显示，不能声称每个字形都来自所选字体。
- **按钮/输入**：default/hover/focus/pressed/disabled/loading/error 都有定义。默认目标至少40×40，大字号至少44；checkbox本体16，点击区域至少40。
- **列表/状态**：标题优先，URL/时间其次；已有选择、焦点、只读、失败、不确定结果仍独立可辨。
- **审查/确认**：差异内容先于危险动作，不折叠必要授权信息；操作未知不改写为失败或成功。

## Do's and Don'ts

Do：用角色令牌和宽度规则统一全应用；保留草稿与滚动；对本机枚举失败、字体消失、存储失败显示真实状态。

Don't：只给设置换色；把全部内容做成卡片；缩小文字来避免溢出；伪造已安装字体列表；使用网络字体；在隐藏页启动模型/抓取/索引。

## Responsive Behavior

正式 Windows 最小窗口为640×480，必须验证1440×900、1100×760、640×760、1100×480、640×480、1920×1080；另以用户截图尺寸2549×1356检查宽屏分配。320px是技能通用网页检查建议，本桌面任务不扩展到移动端支持。

浅/深色、12/14/20px和CJK/Latin混排必须覆盖。20px与640×480交叉组合保留完整导航、字号恢复、字体取消和确认动作。

## Iteration Guide

1. C01先落主题与字阶；C02接字体和精确字号；C03调整页面布局；C04做当前产物集成。
2. 不在本文件和CSS之外再定义字体几何常量。
3. 新状态复用令牌；只修改与本轮需求直接相关的样式。
4. 字体服务影响IPC时，Rust DTO、Schema、TypeScript、Ajv与权限检查一起更新。
5. 原生证据、模拟浏览器证据及配色计算分别记录。

## Known Gaps

- 本文件已经批准；C01 的浏览器截图与 computed-style 收据不代表 C02–C04 或原生验收通过。
- 原目录存在白色surface与“never pure white”、4/8px与“0px corners”的内部冲突；本提案明确采用暖色surface与8px工具控件。
- 目录字体为专有字体，使用本机系统栈与用户已安装字体替代。
- 40px点击目标延续项目桌面约定；不是44px通用移动端目标的达成声明。
- Windows标题栏、系统文件对话框、远程preview网页、扩展页面不强行继承主窗口字体主题。

## Approval 2026-10-14

The user approved this design and sequential C01-C04 implementation. Design approval is not evidence that implementation or native acceptance has passed.
