# 设计：可信工作台外观与 Windows 字体目录

## 架构与所有权

复用App单一偏好状态、SettingsWorkspace分类、LibraryWorkspace持续挂载与RowHeightsContext。C01/C03只更改视觉和必要布局容器；不重构订阅、源选择、模型/编辑/历史逻辑。

字体目录是新增的Windows主窗口只读能力：用户打开字体选择器 → backend.ts → trusted检查后的Tauri命令 → blocking任务内DirectWrite本地集合 → Rust DTO → 生成Schema/TS/Ajv → 前端搜索/预览 → 用户应用 → 同一UiPreferences状态及localStorage。Rust拥有系统访问，前端只消费校验DTO；目录不进SQLite、不进扩展协议消息。

## 字体目录合同（C02）

建议命令 `list_installed_fonts`，无路径、URL或任意查询参数；每次显式调用刷新本机集合，主窗口前端本会话缓存并合并并发调用。请求在工作线程完成，COM对象不跨线程传递；只返回普通拥有的字符串。沿用 `trusted(&window)?`；preview-*和其他label拒绝，前端isTauri判断不是权限边界。

建议由 `crates/protocol/src/ui_fonts.rs` 定义新的桌面DTO（拟新增），通过现有生成链导出：
```ts
type InstalledFontFamily = { family: string; displayName: string };
type InstalledFontCatalog =
  | { status: 'ready'; families: InstalledFontFamily[] }
  | { status: 'unavailable'; reason: 'unsupported_platform' | 'enumeration_failed' | 'catalog_limit' };
```
- family是可供CSS使用的族名，优先en-US，没有则可用的首个族名；displayName优先zh-CN，否则en-US/首个名。
- 按族去重（Windows名称大小写不敏感），不把bold/italic各做一个字体选项。不可用字体不伪装成已安装。
- family/displayName为非空、≤256 Unicode scalars且无控制字符；总数≤10000。超限返回catalog_limit，不静默截断/假装完整；不能由一个异常名称引入CSS或文件访问。
- 排序前端按本地化显示名稳定排列；对相同显示名补规范族名。筛选不改写持久选择。
- 错误只用稳定状态文案，不回传底层路径或原始错误。可重试，现有字体继续生效；非Windows显示不可用，不声明支持。
- 缓存只存当前App会话，不持久化字体清单。关闭选择器或更新请求代号后丢弃迟到结果，不重开浮层/覆盖候选。
- 复用锁定windows相关依赖；若需增加DirectWrite绑定feature，必须限cfg(windows)且不升级无关依赖。不添加通用文件系统权限。

## 字体选择交互

General中的“字体”显示当前值和“选择字体”。弹窗沿用现有ConfirmDialog焦点模式，内容为搜索、固定高度列表、样例、使用/取消。此处为字体选择，不复用危险确认文案。

打开后显示系统默认入口、三种兼容预设与真实系统列表；预设与“已安装字体”分组，不能把宋体预设当成枚举证明。列表可用现有VirtualRows选择能力和稳定行高，目录数大时不把全部项同时挂DOM。不为每行应用其字体；只渲染当前候选的样例。搜索框和列表有明确标签；方向键选择，Tab到“使用此字体”，Enter/Space应用；Escape取消并还焦点。预览不改全应用，应用后才写偏好。刷新保留查询和可匹配候选。

样例包括“让书签与灵感保持相连。”、拉丁大小写/0123456789/标点和长书签标题。固定帮助说明允许中文字形回退；没有实际字体映射证据时不显示“已验证全部字符使用此字体”。

## 偏好v2及迁移

建议独立键 `markbridge.ui-preferences.v2`：
```ts
type UiPreferencesV2 = {
  version: 2;
  theme: 'system' | 'light' | 'dark';
  font:
    | { kind: 'preset'; value: 'system' | 'yahei' | 'song' }
    | { kind: 'installed'; family: string };
  fontSizePx: number; // integer 12..20
};
```
默认system/system/14；旧v1的三种font保留为preset，small/standard/large精确转换12/13/15。读取优先v2；只有v2键不存在才读v1并内存迁移。坏JSON或未知v2版本用默认，不暗中重读旧v1或覆盖记录。启动/系统主题变化/字体枚举均不写存储；只有应用字体、提交有效字号、选择主题及恢复默认写v2。v1保持只读以支持代码回滚；回滚只看v1，不保证显示后来v2偏好，必须说明而非同步双写。

v2未知字段按既有规范明确归一化；未知kind/非法family只回退该字段。family来自目录仍需验证，存储也必须重验；通过CSS字符串安全转义后作为单个引号包裹的族名，追加固定回退栈。禁止把family当CSS声明/selector/URL或整个font-family清单；不得拼接style标签。

先同步应用已保存族名与回退栈，不等待枚举。目录后来发现族已缺失时展示“所选字体当前不可用，已使用备用字体”；不自动保存默认。如果目录本身失败则只能说无法读取列表，不能判定字体不存在。重新安装后无需改偏好即可由本机字体匹配恢复。保存失败仍应用会话值，保留现有真实失败提示。恢复默认只写v2，不删除字体、不改AI、语义和书签数据。

## 字号与几何

所有数值由 `resolveAppearanceMetrics(fontSizePx)` （拟新增纯函数）产生，不复制CSS/JS两个比例：
- 基础正文n（12≤n≤20），辅助max(12,n-2)，列表标题n+1，分组n+2，页标题n+6。
- 树行 `max(40, ceilTo4(1.6*n + 16))`；书签行 `max(48, ceilTo4(1.6*(n+1) + 1.5*max(12,n-2) + 12))`。
- 控件最小高度 `max(40, ceilTo4(1.6*n + 16))`；页头/状态条使用min-height和padding允许增长。
- 这些是可执行建议公式，不是现有规格已通过的尺寸。12/14/20的拟值见verification；原13/15用户保留文字大小，行高可因新可读性公式调整，必须保留位置。
- 根CSS变量和RowHeightsContext消费同一结果；表单/标题行高与该文字角色一致。不采用CSS zoom；不通过逐个测量10000条书签决定行高。
- CJK/Latin/字体实际ascender差异需原生确认。若样例表明几何不足，只调整集中公式，并重新验证边界字号，不能每个字体单独打补丁。
- 保留VirtualRows中段可见项/像素偏移、贴底、隐藏页不覆盖状态、checkbox焦点、键盘主动reveal及草稿。分数滚动容差1 CSS px。

## 全应用视觉和布局

根DESIGN.md是本提案单一视觉来源。C01先令牌和公共控件，C03再按页梳理：应用外壳 → 主库/详情 → 五设置/首次接入 → 整理/语义 → 历史/导出 → 各浮层/异常状态。

不批量格式化组件，不把CSS迁移变为业务重构。保持source kind/id/epoch、query、selection、draft、exportHost portal及异步失效机制；仅增加必要展示容器。必要授权说明、确认差异和状态文本不能因“简洁”隐藏。

## 兼容、回退与安全

新font IPC/DTO的生成链更新与现有接口同级，协议版本/扩展消息不升级。命令登记及敏感命令拒绝清单必须更新；当前主窗口capability不泛化到preview。现有CSP保持，不增加远程字体源。

回退代码不删除v1/v2或用户数据；不通过清空localStorage解决错误。C01可仅回退令牌；C02同时回退UI与命令/DTO登记，保留记录；C03回退对应布局容器，保持业务代码。所有原生试验用隔离app数据根与明确归属进程，不安装/卸载字体或触碰日常Chrome。
