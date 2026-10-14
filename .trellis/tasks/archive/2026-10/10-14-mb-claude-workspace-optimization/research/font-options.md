# Windows 字体方案与来源

## 用户决定

2026-10-14最新要求“需要支持已安装的字体列表选择和预览”，覆盖此前选择的名称输入选项。因此纯名称输入不满足本次验收；导入/安装字体文件不在范围。

## 方案比较

| 方案 | 能力与成本 | 决定 |
|---|---|---|
| CSS本机字体名输入 | 不需IPC，但用户要记名称，无法保证列表真实性 | 不作为主方案 |
| 浏览器queryLocalFonts | 用户交互和权限要求，兼容性有限；当前Tauri/WebView2支持未经核验 | 不依赖，不以Chrome支持推断WebView2 |
| Windows DirectWrite已安装集合 | 本机字体族和本地化名，Rust只读返回名称，可测试授权边界 | 推荐实施方案 |
| 字体文件导入 | 文件管理、加载、解析、删除与CSP/持久化复杂度更高 | 明确范围外 |

DirectWrite官方文档提供系统字体集合和族/本地化名查询。采用仅本地已安装集合，禁用downloadable字体路径；API版本与Rust绑定在C02用当前锁定依赖做最小原生验证。不扫描任意目录，不读注册表路径，不给前端文件内容。[Microsoft系统字体集合](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefactory-getsystemfontcollection)、[DirectWrite字体系统](https://learn.microsoft.com/en-us/windows/win32/directwrite/introducing-directwrite)

浏览器queryLocalFonts要求权限及用户激活，且兼容性有限；本机主窗口支持仍需实测，不能视作跨WebView保证。[MDN queryLocalFonts](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)

fonts.check描述的是FontFaceSet的加载匹配行为；不存在的字体也可能返回true，不可用作“已安装”或“实际中文字形”证明。[MDN FontFaceSet.check](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)

资料核查2026-10-14；以上是API文档证据，尚非本仓库原生实现验证。

## 设计原则

- 主窗口启动与只浏览通用设置不枚举字体；点击选择字体时读取，刷新仅显式操作。
- 列表名称稳定易读，候选样例才使用候选字体；避免千种字体同时渲染。
- 列表支持按中文显示名/规范名搜索；数据来自真实系统，浏览器fixture只能标为mock。
- 无网络字体、字体安装、任意文件读取；本机字体名称/清单不进日志、诊断和侧车导出。
- 保存字体族名而非系统路径/临时索引。字体卸载后CSS回退不阻塞启动；下次目录读取确认缺失时提示，不静默清除偏好。
- CJK缺字回退常见，保留中文/英文/数字样例，不承诺单一字体覆盖所有字符。
