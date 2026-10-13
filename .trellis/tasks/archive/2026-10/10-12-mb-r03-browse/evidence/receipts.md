# R03 验证记录

2026-10-13 R01/R02 验收通过后，本项已 start。实施自动与浏览器检查已通过，独立检查和最终原生复验进行中，尚未关闭本项AC。父级设计原型截图不能关闭本项AC。

后续逐项记录日期、版本与diff、平台、视口/缩放、命令、退出码、fixture、结果和证据路径，禁止真实书签/密钥进入日志。

前置证据：R02 `evidence/native-70727125.json` 最终实际原生11项通过，R02四项AC及独立check均PASS。真实OS休眠按父 gate-change-2026-10-13.md 移至R08完成前，旧V04保持UNVERIFIED。R03 implement/check manifests 12/13 entries validate通过。主线程准备隔离B10K原生测量，不复用历史数字。

## 原生测量脚本基线（不是 R03 验收）

2026-10-13 `node .trellis/tasks/archive/2026-10/10-12-mb-r03-browse/evidence/native-performance.mjs baseline` 退出0，使用仍为R02的release exe（4ccba488…），验证新测量脚本和隔离缓存。Rust seeder 写临时 SQLite，未打开日常Chrome。seed20261010，10000书签/1000文件夹/深20/11004节点。三次进程启动到可交互树为788.1954、731.6992、663.1261ms；30次输入到精确marker渲染，排除首样本后p95=7ms。输入计时包含请求/渲染和下一动画帧，不从SQL返回才开始计时。该基线不能替代R03最终源码/可执行文件的性能复验。完整环境/hash/原始样本见native-performance-baseline-*.json。

## 实施检查及首轮原生

`implementation-report.md` 记录实施阶段 117 Vitest + 6 Node、32 浏览器、Rust workspace core93/desktop13/protocol12（随后protocol新增输入测试13）通过；lint/typecheck/protocol:check/fmt/clippy/build通过。最后面包屑/ARIA修复另跑13 browse+foundation和21 library测试通过。独立审查后的检查单独记录，不把上述数字冒称最终版本全量复验。

首轮实际桌面exe SHA256 `a134443c3a19a2b806f77bcf43c34e7a9bc55a44408ce9684b9f84bf8fde0b86`，build/native扫描退出0，见native-build.log。其后面包屑和审查修复须重建后复验。Windows11 Pro 10.0.26300、WebView2 Edg154.0.4258.62、Chrome155.0.8059.39、系统缩放125%。所有数据来自Rust临时缓存、合成Bookmarks或临时Chrome；未使用日常资料。

- `native-browse-714f3997.json` 退出1：实际10001项分页无漏重复已通过；脚本在Playwright外层读取拒绝值时错误地期望原始字符串，已改在页面内捕获IPC稳定错误。不是版本冲突被接受。
- `native-browse-e8d873fd.json` 退出1：页版本冲突、交集、Ctrl/Shift/Ctrl+A、万条末项均通过；全局option选择数错误地包含来源下拉框，已限定到书签listbox。
- `native-browse-84fcbb07.json` 与细分阶段的 `native-browse-bbb69fa5.json`：Profile列表/搜索末项、深路径、只读空目录、镜像列表万条末项通过；镜像改查询后虚拟滚动位置停在首200条底部，阻止Ctrl+End到达新末项。交独立检查增加回归并修复，不将失败抹除。
- `native-live-query-6e024cc5.json` 退出0：真实临时Chrome从240增至241项后旧分页返回CONFLICT，UI到达新增末项；另10次增删可见样本全部≤3s，最大42.1109ms。该小样本不替代完整B10K V03。临时配对凭据已撤销，测试进程已关闭。最终审查版本仍需重跑。

独立检查另发现并修复AI本地标签/摘要成功保存后筛选未刷新、镜像删除当前文件夹后的旧选择状态；最终结果见check-report.md与后续复验节。

## 审查构建复验与性能失败

审查构建 `7c2ee3f39caeebacb63be248a47ba58556dd23cd58cc0393c86b5fd385ad1b7f`，23160320字节，`native-build-reviewed.log` 退出0。`native-browse-16b72406.json` 11项PASS（含镜像搜索修复、1100×760与640×480、深路径当前节点在视口）；`native-live-query-f38e0702.json` 2项PASS，10增删最大44.3022ms，临时凭据已清理。已人工查看16b72406的深路径和小窗镜像截图。此后AI成功回调时序与SQL性能修复必须再构建，以上是中间证据。

`native-performance-final-747b0c37.json` 退出1：三次缓存冷启动723.9188/642.1895/648.6320ms均通过，但暖搜索29有效样本p50=151.5、p95=207.9、max=222.8ms，超过200ms门槛，R03未完成、R04不启动。测试时独立检查已静默，没有用重试挑选通过样本。

诊断 `native-query-profile-ffda3880.json` 单测真实IPC，不代替输入到渲染验收：同一隔离B10K查询一个marker大多119–156ms，根目录3项查询86–101ms。说明主要延迟位于新本地查询，交实施者优化并再独立审查。保留全部失败与原始样本。

## 最终验收（2026-10-13）

性能修复只改变SQL查询路径：父索引遍历文件夹、一次物化窄ID/顺序列供count/page使用、最多一页读取node_json；不改变分页/交集/身份合同。诊断前后数据见rust-query-before.txt与rust-query-folder-walk.txt，不能当作原生验收。独立审查无未解决的R03代码问题，最终lint/typecheck、39项受影响前端/协议测试、3项Rust查询回归通过；32项浏览器为此前审查版本，后续回调及receipt失效由新组件回归覆盖。完整分层与首次失败见check-report.md。现有AI切换busy问题明确交R05 research，不隐藏在本项PASS中。

`pnpm build:native` 退出0，native-build-optimized.log。最终exe为23165952字节，SHA256 `371afbe956efb6a59a73273f96e93790aca3de00bc6e1215ba1a151be566d2e6`。Rust seeder也按当前源码重建，check-seeder-build-final.log退出0。下列三次命令均退出0、同一最终exe：

- `native-browse-d23bba4d.json`：11项PASS。10001兄弟无重漏、版本冲突拒绝、目录/文本/标签/备注交集、Ctrl/Shift/已加载Ctrl+A、全部加载后10001选择、查询清多选、搜索末项、深中文路径当前目录可见、只读空目录、镜像10001列表和搜索末项。native-screenshots/d23bba4d-*.png记录1100×760与640×480 CSS、devicePixelRatio=1.25；最终小窗已人工查看。
- `native-live-query-f1e15a18.json`：真实临时Chrome155与WebView2 154，240→241旧分页拒绝和新末项可达；10次增删可见最大42.8131ms，均≤3s。这是小样本同步复验，不冒称完整B10K V03。临时凭据已撤销。
- `native-performance-final-647f28ce.json`：B10K seed20261010，10000书签/1000文件夹/深20/11004节点；三次进程启动到缓存可操作647.8320/605.4637/605.9523ms；30次输入到精确结果和下一帧，首样本排除后29次暖样本p50=80.5、p95=103.2、max=115.5ms。每次冷启动≤3s、暖p95≤200ms通过。原始值、环境与hash在JSON。计时期间构建/检查已结束。

测试环境：Windows11 Pro 10.0.26300、Intel Core Ultra9 275HX、24逻辑核、68143853568字节内存、Node26.7。原生使用独立临时缓存/Chrome/凭据/WebView目录，Rust写SQLite，所有本轮测试进程关闭。没有改日常Chrome、提交、归档、发布或安装。两个受保护脚本哈希仍与R01开工前一致。

| AC | 最终结果 | 证据 |
|---|---|---|
| AC-R03-1 | PASS | 深20层/空目录浏览器创建入口；d23bba4d路径与只读空目录 |
| AC-R03-2 | PASS | Rust10001/所有offset/epoch/revision回归；d23bba4d与f1e15a18 |
| AC-R03-3 | PASS | Rust多标签/摘要备注/跨Profile交集；原生交集；AI/Tag/receipt刷新回归；镜像无侧车 |
| AC-R03-4 | PASS | 五视口浏览器/原生Ctrl-Shift-Ctrl+A、加载范围、查询清选择；晚响应及换源回归 |
| AC-R03-5 | PASS | 最终647f28ce原生性能、键盘/虚拟化/ARIA与动态尺寸回归 |

R03完成，可按批准顺序开始R04。稳定查询/状态/截图规则已写spec。真实OS休眠与实际系统150%/跨屏DPI仍属于R08未完成门槛，本结论不豁免。
