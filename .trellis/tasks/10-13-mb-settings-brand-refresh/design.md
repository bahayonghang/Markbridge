# 技术设计

## 边界

父任务协调S01–S03和集成，不作为实施目标。用户批准最新规划后逐个启动子任务，旧13/15模型门槛不变。视觉细则见visual-design.md。

沿用React本地状态、现有styles.css和WorkspaceIcon功能图标，不引入路由、状态库、Tailwind或动画库。ui参考CSS策略枚举不覆盖仓库现状，继续纯CSS及语义变量，不更换栈。

## 设置结构与所有权

- App拥有工作区导航、单一useBridge和设置选择。SettingsWorkspace只负责左栏、内容容器、可见性和焦点。
- 最终分类：通用、Chrome连接、AI、语义检索、备份导出。S02先交付四类真实已有设置，S03加入通用并成为普通设置默认入口。既有连接/AI/语义/历史导出快捷入口仍定位对应分类，首次接入仍进入连接引导。
- 纵向tablist支持上下/Home/End、roving tabIndex及tab/panel关联。分类可读本地配置，不能调用模型/抓取/索引/写入；无切换动画。
- LibraryWorkspace保留原挂载位置及source/query/selection/draft。SettingsWorkspace提供永久稳定exportHost，库只将已有“来源工具条+导出视图”通过createPortal呈现到host，不portal整库或创建第二份状态。非导出隐藏host并遵从active规则。tabpanel语义仅由设置面板提供，不嵌套重复。
- 历史导出入口、来源守卫、source key、取消/失败/saved回执和mirror仅HTML保持原义。
- ConnectionSettings继续供首次引导复用。已接入设置分资料管理/新增接入，安装说明可折叠；首次接入及pending配对必须显示所需步骤。已访问面板保持挂载及active/generation规则，不丢输入或重复副作用。

## 通用偏好

可信主窗口使用版本化localStorage键markbridge.ui-preferences.v1，纯视觉偏好不属于侧车数据，不新增SQLite、Rust IPC或协议字段。

数据示例：{"version":1,"theme":"system","font":"system","fontSize":"standard"}。
白名单theme=system/light/dark，font=system/yahei/song，fontSize=small/standard/large。

启动验证并在React首屏前应用data属性/变量；无记录或非法字段回退默认，未知版本保留原记录并用默认。只因用户选择/恢复默认保存，不把任意字符串插CSS。

根组件单份状态传给面板和列表，纯辅助模块集中解析、保存、主题及字号映射，不建通用设置框架。system订阅prefers-color-scheme并清理，显式light/dark忽略系统变化。保存失败允许本会话应用，提示“当前外观已应用，但未能保存。重启后可能恢复默认”，不显示持久化成功。

主题覆盖可信工作区及对话框，设置color-scheme；远程preview-*、Windows标题栏、Chrome和扩展页面不跟随，不新增权限。

字号采用角色映射，不用CSS zoom/transform。CSS行框和JS rowHeight同源，默认40/52px，大字号同步增高。变化不重建数据、不清选择/草稿，保持可见位置和焦点可达。列表中段保持可见行及偏移；已在底部时保持贴底，确保末项不因增大字号离开视口。

## 图标资产

S01用内置image_gen生成栅格母版并记录prompt、候选和选择。消费资产复制到仓库assets/brand，不依赖工具默认保存目录。

更新src-tauri/icons的PNG/ICO，侧栏用本地品牌PNG，扩展public/icons提供16/32/48/128PNG并声明icons/default_icon。Tauri生成仅保留Windows需要的资源，不增加跨平台交付声明。转换不重绘标识，功能图标保持现状。

## 风险及回滚

| 风险 | 控制 |
|---|---|
| 导出移位分叉来源或旧结果误报 | 只portal视图，复用source key与守卫 |
| 固定px及虚拟行失配 | 角色/几何同源，测深目录、末项、大字号最小窗 |
| 深色漏硬编码hover/disabled | 按颜色消费端清单补变量，跨页检查 |
| 浏览器持久化通过、原生失败 | 隔离目录真实重启；失败保持FAIL，不静默扩大后端范围 |
| Windows图标缓存显示旧图标 | 查新exe资源与自有窗口，不清系统缓存或改日常安装 |

按子任务恢复源码/资产；恢复偏好只重置本任务UI键，不清SQLite、模型配置或Chrome。新安装验收若必要，先准备产物，再取得该产物范围授权。
