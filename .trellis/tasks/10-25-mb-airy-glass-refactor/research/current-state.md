# 当前前端与目录适配研究

基线2ac7979。这是源码分析，非当前运行视觉评审。旧C01–C04已归档，旧研究中的字体/尺寸缺口不能复制为本轮缺陷。

## 源码证据

| 锚点 | 事实 | 本轮影响 |
|---|---|---|
| DESIGN.md:1、:66 | 已批准Claude暖纸风，限制普通阅读面渐变 | G01明确替换视觉条款，保留原版及来源 |
| apps/desktop/src/styles.css:1、:38 | 唯一浅深CSS令牌层 | 原位迁移，不增加主题provider或UI库 |
| apps/desktop/src/styles.css:70 | 按钮/表单共用背景圆角，已有按压缩放 | 分开pill动作与表单/虚拟行圆角，不叠加动画 |
| apps/desktop/src/styles.css:97 | 全窗口grid，侧栏216，主区实底 | 单paper放workspace；阅读面实底，外壳材料不被整块主区遮掉 |
| apps/desktop/src/App.tsx:24、:79 | 单偏好、RowHeightsContext、持续挂载LibraryWorkspace | 保留source/epoch、挂载、portal和导航所有权 |
| apps/desktop/src/features/settings/ui-preferences.ts | 12..20纯度量、v2、已安装字体 | 不更改存储/字体服务/度量公式 |
| apps/desktop/src/features/library/VirtualRows.tsx | 固定行高、隐藏状态和锚点 | 不做逐行filter/阴影，不全局套用1.7撑破固定行 |
| apps/desktop/src/styles.css:170、:336 | 详情滚动和sticky已有遮挡保护 | sticky实底，不能透出滚动正文 |
| apps/desktop/src/features/settings/SettingsWorkspace.tsx:12 | 竖向tab键盘和设置内部滚动 | 保留左分类，不改卡片导航 |
| apps/desktop/src/features/settings/ConfirmDialog.tsx:10 | showModal、默认取消、恢复焦点 | 保留top layer，弹窗实底，不嵌套blur |
| apps/desktop/src/styles.css:288 | 1100/800断点及窄窗替换 | 960只管材料，不改变布局断点 |
| apps/desktop/src-tauri/tauri.conf.json:14 | 最小640×480、严格CSP | 不增加透明窗口、原生材料或网络资源 |
| tests/e2e/appearance.spec.ts:173、:193、:204 | hex计算及首个非透明背景，消费者要求三通道RGB | 不能验证rgba/渐变，需合成验证，不放宽断言 |
| tests/e2e/workspace-layout.spec.ts:56、:75 | 现有全页/首次接入尺寸矩阵 | 复用fixture与bbox，补959/960 |
| .trellis/spec/frontend/quality-guidelines.md | exe/DPI、观察校准、当前证据目录合同 | mock不替代原生，不覆盖归档截图 |

## 全页面迁移

| 面 | 材料与语义 | 特别保留 |
|---|---|---|
| 导航/页头/状态 | 同纸面，中性文字+绿色选中/焦点 | 品牌、真实连接状态、skip link |
| 文件夹/书签 | 实底行无blur，绿色选中 | 有界DOM、checkbox独立键盘、隐藏锚点 |
| 详情/标签备注/预览控制 | 实底正文/输入，sticky实底 | 草稿、全量差异、URL、按需预览 |
| 五类设置/首次接入 | 输入绿、输出摘要紫，不全卡片化 | 本机字体、懒加载、必要接入说明 |
| 整理/语义 | 范围与审查结果色面+标题 | 无自动模型调用，proposal不等于完成 |
| 历史/导出 | 结果紫，成功/失败/未知有文字 | 全量撤销、离线可读、保存取消真实 |
| 字体/危险确认/路径浮层 | 实底well、单阴影 | focus trap、Escape、取消优先、返回焦点 |

## 目录与项目冲突

1. 目录没有深色：推荐补项目暗色令牌，保留系统/浅/深，不删除既有能力。
2. Figtree/1.7正文：沿用用户字体与1.6正文、1.5列表caption及纯度量函数，不下载字体。
3. pill：动作按钮/标签采用；密集导航、tabs、输入和虚拟行保留较小圆角，避免胶囊堆。
4. 目录最多6层：项目收紧到1个workspace；well/dialog实底；不放可选blob。
5. paper按压缩放：不缩放工作台，仅动作按钮；键盘/reduced-motion不缩放。
6. 最小8间距/44触点：不重写列表内部4px间隔或40px桌面目标，保持现有几何，记录适配。
7. 通用320/390网页检查不扩展桌面产品范围，正式最小640×480。
8. 旧spec暖纸/陶土视觉段落由G01替换；安全/焦点/字体/状态合同不被目录覆盖。

## 风险排序

- 高：直接把--surface改rgba会污染输入、sticky和dialog；必须拆paper与实底surface。
- 高：对比度现有算法不含alpha；强行适配为RGB只会制造错误通过。
- 高：外边距压缩最小窗；低窗/窄窗取消边距，重新测至少一行与最后动作。
- 中：filter绘制层和fixed/portal/top-layer关系变化，逐项实测，不用无限加z-index解决。
- 中：WebView2是否暴露减少透明度偏好待原生检查，不建立未经验证的OS联动承诺。
- 环境：Playwright入口不可解析，未安装依赖或修复链接；实施前补基线。
- 历史C04记录附带启动4605.9/4552.3ms观察，原因UNVERIFIED；不是本次测量，本轮不宣称修复启动。
