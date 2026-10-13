# R07 验证记录

2026-10-13：R04/R05/R06全部AC与独立/原生门槛通过；R07 validate 10/11 PASS后start。基线R06最终exe89c17f5a、167+6/142/51自动检查，native history6/export6/web11均PASS。主线程负责native-*、spec、任务及收据；实施/独立检查代理负责产品与自动回归。使用临时Profile和应用目录，禁止日常Chrome、真实云模型调用、提交或归档。

R07当前自动/浏览器/原生验收 NOT_RUN，AC未关闭。真实OS休眠仍待R08完成前。

首轮目录取消：main.rs/Bridge 增加可选 requestId，响应DTO不变。真实Bridge+临时SQLite的迟到有效响应测试通过（backend-cancel-test-first.log，1 PASS，exit0）；取消后持久job cancelled、零operation、零浏览器消息。原生脚本和本机合成HTTP fixture已准备但未执行，不声称真实模型通过。

独立后端检查修复两项真实取消竞态：无watch订阅者时send丢失取消值；重复requestId覆盖旧flag导致初次请求无法取消。red日志保留，send_replace/唯一注册/按实例释放后，Rust146PASS（core115/desktop17/protocol14）+3既有ignored，fmt/clippy PASS。

前端实施50聚焦测试及lint PASS；独立检查修复新测试类型/隐藏tab选择器（产品未变），typecheck/build/产物扫描PASS。最终浏览器及native正在运行，尚不关闭AC。

## 原生首轮与问题保留

ceeb13e821ceb4dbced06f7c23669672010233f4d047af497cbd23bb01a514fe / 24,054,272 bytes 构建扫描通过（native-build-first.log）。最初三次 prepare 启动未通过：新脚本使用未允许的 Markbridge.Task07 凭据前缀，stderr 明确为 invalid acceptance credential namespace，应用退出101。驱动改用既有允许的 Markbridge.Task06.r07-独立临时标识；未放宽产品校验。所有原始 native-organize-*.json 保留，启动失败不算功能失败或通过。

d062d07f 原生前2项PASS：整理/设置进入无网络任务和默认AI关闭；真实去重范围审查/确认/历史。folder-scope 首失败揭示真实提示错误：inspect_library 返回未探测链接行（checks=0），界面按 links.length 推断行为并误称链接检查完成。独立检查正在按启动动作修复提示并补回归，修复后重建再验。该次临时凭据已清除、无页面错误、公共loopback请求0。

修复该提示前的自动基线：177 Vitest + 6脚本、58浏览器（7R07）、Rust146 + 3既有ignored，lint/typecheck/build/artifact/protocol/fmt/clippy均PASS，详见check-report.md。该原生新发现必须关闭后才能验收R07。

## 最终原生验收

`pnpm build:native` exit0（native-build-final.log）：exe SHA256 **804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910**，24,054,272 bytes；扩展 **567f50146319a2b6f013f773308910f29bc56585a62075dbaf0f9b3cf1ff22c5**。Windows11 Pro10.0.26300、Core Ultra9 275HX/24逻辑CPU/68,143,853,568bytes RAM、Chrome155.0.8059.39、WebView2 Edg155.0.4283.45、Node26.7.0。

- `node .trellis/tasks/archive/2026-10/10-12-mb-r07-organize/evidence/native-organize.mjs` exit0：**874dbc46，10PASS**。真实Tauri/Rust/SQLite/临时Chrome。显式选择及含子目录范围；重复检查/保留项/预览零写/确认清理与历史；loopback链接被拒且未知；默认AI关闭与进入不触发任务；真实HTTP取消；建议显式确认后Chrome改名；过期方案禁止应用；目录审查及实际创建/移动；离线审查/五窗口。IPC观察器在进入前以get_bridge_state验证工作，最终真实调用计数inspect_library2/suggest_ai2/propose_organization3。
- `node .trellis/tasks/archive/2026-10/10-12-mb-r07-organize/evidence/native-web.mjs` exit0：**e34f302e，11PASS**。独立原生窗口/焦点、68命令全部拒绝、真实前进后退刷新、scheme/file/userinfo/popup/download限制、两Profile会话隔离和清除、失败页反馈。
- 两报告均清除任务临时凭据，0页面错误。模型fixture0异常，公共页面loopback命中0。模型只为本机合成HTTP，**真实模型质量NOT_RUN**。五视口1440×900/1100×760/640×760/1100×480/640×480，实际Windows125%；系统150%/跨屏及真实休眠仍归R08。

首次失败保留：507de491在settings下拉框测试定位失败（exact label包含嵌套option），改用既有控件id；9087fbd3全部10功能控制通过，但最终observer自检失败（Tauri invoke属性不可覆写），因此整次仍FAIL。最终874dbc46改成R05同样的fetch旁路观察，完全保留真实Response，先正向验证再断言零任务。未用这些失败关闭AC。

主会话实际查看native-screenshots/874dbc46-organization-ready.png与874dbc46-organize-640x480.png：灰侧栏、白主区、蓝选中及细分隔一致；小窗用内部滚动，主要审查内容和来源状态清楚。浏览器检查另有顶部/末端控件完整几何与截图，不能与原生截图混称。

| AC | 结果与证据 |
|---|---|
| AC-R07-1 | PASS：874dbc46显式选择/目录含子目录、进入零任务的有效IPC及网络观察 |
| AC-R07-2 | PASS：重复保留/未知链接/外部revision失效，五尺寸审查截图与浏览器几何 |
| AC-R07-3 | PASS：默认关闭、独立设置、发送范围披露、取消和确认前无写入；真实模型质量仍NOT_RUN |
| AC-R07-4 | PASS：两类生成取消HTTP终止、导航保留结果、真实operation历史、离线禁写 |

最终独立检查和自动回归以check-report.md为准；在其完成后更新任务状态。未提交、归档、发布、安装日常环境或修改日常Chrome。

最终独立检查已通过：提示修复后178Vitest+6脚本、58E2E全部PASS；lint/typecheck/build与产物扫描PASS，Rust146/3ignored及protocol先前PASS且未再变。独立核对原生JSON/截图/hash/清理状态通过，check-report.md无未修R07问题。R07完成，可按依赖启动R08。
