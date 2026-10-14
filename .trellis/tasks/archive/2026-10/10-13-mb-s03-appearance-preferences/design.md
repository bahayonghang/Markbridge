# S03 偏好设计

使用父design的版本化localStorage、枚举白名单及失败行为；纯视觉键不是SQLite侧车数据。不新增后端、IPC、协议或持久化插件。

在main.tsx首屏前读取/验证/应用属性，App持有单份偏好状态。GeneralSettings消费值及onChange，辅助模块集中parse/save/resolveTheme/尺寸映射。system媒体订阅卸载清理，StrictMode不产生重复保存或外部任务。只有用户选择保存，不在渲染/effect反复覆盖记录。

主题补canvas/sidebar/surface/ink/muted/blue/selected/line/control-border/hover/disabled/danger/caution/backdrop。颜色硬编码消费端只按主题需求替换，业务逻辑不改；color-scheme同步原生表单/滚动条。主按钮与链接颜色分别保证对比度。

字体预设及12/13/15正文建议见父visual-design。字号使标题/辅助/输入实际变化，不用CSS zoom。树/书签尺寸与rowHeight集中映射，标准40/52px保留、大字号同步增高；同一尺寸源给CSS和VirtualRows，不复制两个比例。必要时给树显式rowHeight，不重写虚拟化算法。

调整字体/字号保留数据、选择、草稿，当前可见项及偏移需稳定，焦点项可见。列表已在底部时继续贴底，避免字号增大后末项离开视口；中段仍保持首个可见行及偏移。真实DPI的分数scrollTop允许1 CSS px测量容差，隐藏列表的零高度测量不覆盖已记录位置。恢复默认只重置本键。无持久化成功仅本会话应用并提示。原生重启失败保留FAIL，需改存储架构时回到规划。

只影响可信WebView内容，不尝试修改Windows系统字体/主题、标题栏或远程页面。
