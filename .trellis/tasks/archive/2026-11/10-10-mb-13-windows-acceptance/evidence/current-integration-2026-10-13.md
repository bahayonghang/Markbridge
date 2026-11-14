# 当前版本集成验收

本文件记录当前结论，不改写历史 FAIL、NOT_RUN 或旧包 PASS。本轮复用既有 13；09、12 已 completed，起始 HEAD `64234ce`。完整独立检查及失败调查见 [current-independent-check.md](current-independent-check.md)。

## 14/15 实施后的当前 Windows 集成

当前 release、NSIS 包内与实际安装 exe 为 25,301,504 bytes，SHA256 `4fcf7fcd506ad60eac1798c2a4c0ed9f80888648f7a5050ec41e6d47c67ff707`；setup SHA256 `2844783f1660d3708412b1bcbd602f8a2bc1c85369623cdf996d52368932b183`。包内格式/架构、路径/已知秘密模式扫描和 hash 一致通过，未签名、未发布。3a 是此前不同构建产物，只对应自身原生收据。

[3ee4f8c0/eee73eda 原始安装收据](current-installer-3ee4f8c0-0010-4ecf-a83c-627a3397746d-eee73eda-be7a-4238-a2be-18def7195915-receipt.json)、[完整闭环](current-installer-3ee4f8c0-0010-4ecf-a83c-627a3397746d-eee73eda-be7a-4238-a2be-18def7195915-completion.json)、[2f88d68b 注册恢复](current-installer-3ee4f8c0-0010-4ecf-a83c-627a3397746d-2f88d68b-7221-4cad-86ca-9e8ad73983a1-registry-restore.json) 均 PASS。11 控制、errors=[]：实际安装、main OS 目录、P2、编辑/标签备注、实际公共抓取、A/B/A 预览持久化、非 live 禁写、正常退出/重启/核对零重放、精确吊销、卸载保留通过，最终进程/监听为空。

诊断实际取消/保存、固定 schema 和 canary 排除通过，format1/app0.1.0/protocol1/**schema8**/windows/x86_64/live2。语义配置默认关闭且 endpoint/model=null；远程预览拒绝当前 **80** 个应用 command。旧 schema7/69 command 收据只是启动基线。

[15 最终独立检查](../../10-10-mb-15-semantic-search/evidence/current-independent-check.md)：192 Rust/3既有ignored、217 Vitest、20 Node、3 指标测试、80 E2E 及完整静态/构建/协议 gate PASS。[当前 4fc 原生语义合成功能](../../10-10-mb-15-semantic-search/evidence/current-semantic-native-73edf605-908d-4a3a-9aa8-c7ae6bcf0942-receipt.json) 9 控制/0错误，暂停/恢复/正常重启零请求、取消、资料与模型隔离、删除/摘要/标签/备注/FTS保留及实际查询 UI PASS；actualModelV18=NOT_RUN。

[当前 4fc V06 B10K](current-performance-6c7edb60-a8b9-42fa-ac40-0144aba261f8-receipt.json) PASS：3 次新进程冷启动 788.3896/633.5898/728.6094 ms；30 次暖态普通搜索 p50 95/p95 106.6/max110 ms，原始样本、实际单调时钟、目录/CDP所属和4次正常退出保留。没有扣除观测开销或清 OS 磁盘缓存，不保证所有硬件；原743/3c FAIL和dbfa/4f PASS均不改。它不是语义模型性能。

最终卸载前后完整 630 files/47,756,207 bytes manifest SHA `39eef1a9859cb7895e53f1b16764050616c0f775b24ae25eba6c63e38f901d4a` 相同，schema8 SQLite 245,760 bytes/SHA `40efaf06863007bce7be0a68de6ea3bda6b8b129eed9ec57ba2cc6dfc8b2b9e2` 相同。main145664/restart160068均exit0/no signal，4+1精确创建身份WebView均消失；首次Chrome正常退出实际110,395 ms（180秒预算），另外两次184/141 ms，不能宣称快速退出。method2现场 sole-root-dateAdded/B/history 原始精确比较保留，不追溯改旧FAIL。

未更改同步/编辑安全/导航策略按下表历史来源分层复用，不宣称所有旧 V 项在当前 hash 重测。V12/V17/V18 缺实际环境 NOT_RUN，V16 UNVERIFIED，13/M4、14、15 与原父任务仍未完成。

## 13 启动冻结基线（4f/269c 历史）

当前4f/269c完整 Windows 安装验收 **PASS**：[722a2dd5/f6c5a5fc 原始收据](current-installer-722a2dd5-d3d9-4787-b44c-74b92693c620-f6c5a5fc-c465-4837-8a72-a402ad7989e4-receipt.json)、[completion PASS](current-installer-722a2dd5-d3d9-4787-b44c-74b92693c620-f6c5a5fc-c465-4837-8a72-a402ad7989e4-completion.json)、[d4cc 产品键恢复 PASS](current-installer-722a2dd5-d3d9-4787-b44c-74b92693c620-d4ccd4fd-b78a-461a-9e6e-67223a64e6dd-registry-restore.json)。11项控制、0错误，实际安装、P2、诊断、只读、正常退出、重启/live2、标签备注、零回放及卸载保留通过；已独立读取完整原始结果。比较method2现场证明A原始hash不同的唯一字段是synthetic root0.dateAdded，替换仅该值后完整JSON精确相等；B和完整操作记录原始hash不变。旧9cf原因没有独立差异记录，仍UNKNOWN/FAIL；7acc/fd93及其他旧FAIL不改。旧7acc精确凭据由独立ce221清理PASS。

- Release/包内 exe：24,394,240 bytes，SHA256 `4f5833328131a7cd629ca10fa2953a88202fb343585072944e6e592709908f6f`。
- Unsigned/unpublished setup：5,852,262 bytes，SHA256 `269c747e4a8eee5cf147a97241f639ef7d832eb165844cb339a5579418d7ccb0`。
- `current-build-package-persistence-fixed.log` exit0：严格包内exe/release一致、资产与私有路径/密钥扫描通过；独立读取hash一致。实际Windows11 Pro build26300、Chrome155.0.8059.39、WebView2 155.0.4283.45。

## 执行与授权边界

用户要求持续完成全部可执行工作。真实休眠 WAIVED、实际 NOT_RUN、历史 V04 UNVERIFIED；普通恢复、非live禁写和零回放仍需验收。用户已授权临时隔离安装/必要重跑/正常卸载和两个明确HKCU产品键的严格所属残留恢复；原始收据保留准确范围。没有执行日常安装、push、发布或签名。

用户批准的 [13→14/15启动例外](../../10-10-markbridge-workspace/gate-proposal-2026-10-13-model.md) 要求当前安装/诊断/自动检查通过后才继续。**该启动条件已实际满足，独立review批准启动14/15**。实际模型缺口不阻塞这个启动，但V12、AC13-1、13/M4与原父任务仍未完成；没有豁免模型或平台验收。本文件是任务13的4f冻结基线，后续14/15源码改动须另执行受影响Windows回归，不能直接把本hash当新产物验收。

## 证据基线

| Gate | 证据及复用范围 | 当前结果 |
|---|---|---|
| V01 | 独立最终current-independent-preview-*：lint/typecheck/protocol/fmt/clippy与Rust118 core+27 desktop+14 protocol=159 PASS/3既有ignored；同前端/协议的188 Vitest+6 Node、66 E2E PASS；当前4f构建/锁文件/扫描 PASS。sandbox store-lock/凭据失败和成功重跑分开保留，既有chunk advisory有说明 | PASS；ignored真实fixture测试未计入通过 |
| V02 | 当前722a安装P2/equal chromeId及精确吊销 PASS；7acc原始清理失败后独立ce221精确2项吊销 PASS；旧03错误令牌/Origin/Profile/零未授权写入证据，认证层未改 | 当前原生与历史分层 PASS；独立清理不改原始安装FAIL |
| V03 | R08 `native-live-e5a17113.json`：B10K、100 次真实 Chrome 事件，p95 82 ms、max 88 ms、完整树核对 | 历史 PASS；未改同步层的分层复用 |
| V04 | 旧03导入/worker/Chrome重启、R08 native-system-probe-52c7576b真实断连/禁写/重连零回放；当前722a实际main0/重启/live2/标签备注/严格树与完整历史零回放通过 | 当前受影响恢复与历史非睡眠分层 PASS；真实睡眠 WAIVED/NOT_RUN，历史 UNVERIFIED 保留 |
| V05 | 旧 04 文件故障与真实 watcher；R02 `native-70727125.json` 临时文件来源、损坏保留缓存、Chrome 重启核对 | 历史 PASS；未改镜像层的分层复用 |
| V06 | 最新4f method2 current-performance-dbfa5819：3次真实静态DOM/rAF观测878.873/724.7868/1911.1388ms，首搜97.2ms，暖态30次p50 101.7/p95 130.4/max167.3ms；5个实际时钟/所有4次exact OSmain与CDP所属证明/正常0及root为空经独立核对 | 最新本机B10K测量 PASS；保留743串行上界FAIL和3c首4594ms FAIL，不丢样本/减开销，不保证所有硬件或每次环境下均3s |
| V07 | 最新4f实际UI create取消/确认/edit/本地元数据 PASS；旧06排序/根/managed/并发冲突证据，写入层未改 | 当前原生与历史分层 PASS |
| V08 | 旧 06/11 lost ack/crash/回滚；R08 `native-undo-folder-10f2e69e.json` 修复后条件撤销外部子节点保护 | 历史 PASS；安全修复已包含在本轮基线 |
| V09 | 当前722a本地标签/备注与P2隔离、重启后实际标签/备注及浏览器树不变通过；旧07/R08标题编码/转义/迁移/持久化 | 当前本地持久化与历史分层 PASS |
| V10 | 最新4f原生实际公共fetch/render PASS；旧08切换/取消/缓存/SSRF及自动回归，抽取层未改 | 当前抓取与历史分层 PASS |
| V11 | 最新4f安装exact main/v1 A-B-A持久化/69条current commands全部DENIED（含save_diagnostics）PASS，有原生截图；998f148c复制当前release的生产66字符/旧布局迁移回读 PASS。旧09/R07危险scheme/弹窗/下载策略未改 | 当前受影响会话/权限 PASS；未改导航策略历史分层复用，旧68条不替代新69条 |
| V12 | 旧 10 的 `loopback-chat.py` + 10 公开页面是脚本协议响应，不是实际 Ollama 模型 | 协议/取消/隐私功能历史 PASS；真实模型运行与质量 NOT_RUN，不能称实际模型通过 |
| V13 | 旧 11 `disposable_chrome_b100` 真实 B100 两遍分类/中断/回滚 | 历史 PASS；未改批量层的分层复用 |
| V14 | 旧 12 URL 等价、死链未知状态、FTS、清理确认/撤销；R07/R08 回归 | 历史 PASS；未改维护层的分层复用 |
| V15 | 当前722a/f6c5 raw与completion、d4cc恢复均PASS：11控制/0错误、实际安装/诊断/只读/正常退出/重启/零回放/精确吊销/完整630文件保留/无所属进程监听 | PASS；method2保留A raw mismatch与sole-root日期实证，旧9cf等FAIL保持原状 |
| V16 | 缺专用 Floccus 库及第二客户端 | UNVERIFIED，按原合同不阻塞基础本地功能 |
| V17 | 没有macOS/Linux原生桌面、Chrome及安装运行证据 | NOT_RUN；Windows/WSL/交叉编译不能代替，14未完成 |
| V18 | 没有实际embedding模型，标注查询/实际向量性能未测 | NOT_RUN；确定性检查不能代替模型质量/性能，15未完成 |

旧证据入口：`../../archive/2026-10/10-12-mb-r08-acceptance/evidence/precommit-closeout.md` 和 `check-report.md`，各原任务 `evidence/receipts.md`。R08 撤销修复后 exe 是 `4a7f12fe…`；更广矩阵的 `804d9207…` 为修复前历史分层证据。本文件不把旧 hash 写成新产物重验。

## 当前控制与保留的失败边界

当前722a/f6c5诊断严格schema/固定投影/私有canary排除通过：format1/app0.1.0/protocol1/schema7/windows/x86_64、bridgeListening=true、error=null、live2/其他连接0/镜像0。真实原生取消没有导出，保存产生固定报告；截图目录 `current-screenshots-722a2dd5-d3d9-4787-b44c-74b92693c620-f6c5a5fc-c465-4837-8a72-a402ad7989e4/`。mock IPC E2E不能代替它。

722a实际main128044与重启main22784均正常exit0/no signal；第一次4个、重启后1个WebView的精确PID+UTC创建身份均消失。Chrome正常exit0观察111,071/132/144ms，预算180秒，不声明45秒SLA或快速退出。正常uninstall0，630files/47,711,905bytes manifest `5e3add4d7bff6f43f81fc6448d1e42f2c0a58518e9b68927cb05f7ad6cb8d3f0` 与221,184byte SQLite `24841da429893ded102258bffbc101f25738fb10cb0f140644e6b01551f52455` 前后相同；最终root进程/监听、已知端口及产品键为空。

重启比较method2不丢弃一般日期字段：A原始hash不同，但唯一现场差异是单个无URL/parent的synthetic root0自身finite dateAdded；只替换该值后完整JSON精确相同，所有其他字段、属性顺序、子顺序、增删和普通节点日期均零差异。B原始hash精确相同，完整2条操作DTO在before、app restart、reconnect三点均同hash `17b6fc7a28482719af0cf40c8b5656a8240137f075fe762eee0b34e93ab9f736`。该现场证明与[13合同](../design.md)一致；原9cf没有这些独立事实，仍不能追溯认定其失败原因。

[旧7acc精确凭据清理ce221](current-fixture-credential-cleanup-7accfee5-259b-4733-8d77-60c71b7dda75-ce221c9c-700d-44a8-b014-ae1c079fdbf1-receipt.json) 独立PASS：2个exact OS targets true→false、两个Profile revoked/null refs、九类缓存/元数据/标签/历史/快照指纹不变，正常main0/创建身份消失/root为空。数据库因明确Rust吊销而改变，不称整个库hash不变；受保护的before/after SQL副本读取均保留原DB/WAL/SHM字节。原安装7acc和第一次fd93读取仍FAIL，单独清理不能升级它们。

Chrome首次请求ACK1ms、读写pipe39ms关闭，45秒仍有确切所属进程，正常关闭 FAIL。cleanup再次对已结束pipe写入错误后观察到晚到exit0不能覆盖该FAIL。同4f的简单live-paired对照73f6f83f两次关闭182/168ms、exit0，依次记录2live/1live并在关闭后吊销；它未重现包含编辑/抓取/预览/诊断的完整流程，不足以归因或更改关闭默认顺序。

后续同4f的只读getTree对照70af32aa也PASS（真实exit191/189ms）。仅增加40秒等待的live-aged对照1f5a0af6重现两次关闭超时；之后观察到exit0/正常main0/精确吊销与root为空仍保持原FAIL。修复预关闭状态读取竞态后的live-aged-concurrent对照5159fa3b也FAIL：实际同一2live/两target在线快照，两个close ACK0ms、pipe44ms关闭，两个45秒超时，收据末尾两个Chrome exitnull/root进程检查FAIL；main0和精确吊销通过。没有安装或CRUD/预览/诊断也可复现，当前因果未确定，并发顺序未解决它；之后清理观察须另记，不能改写这些FAIL。

[当前性能原始收据](current-performance-74346553-1870-410e-b101-546166109a57-receipt.json) 保留每次冷/暖样本与机器信息，复制release哈希仍4f。B10K来自固定seed20261010/10000书签/1000文件夹/最大深度20，Rust只写新fixture SQLite，无Chrome/model/installer调用。可见marker截图经独立检查，暖态严格输入到结果/动画帧无排除时间；冷启动超门槛但含受控目录守卫与CDP接入耗时，目前不能归因为产品变慢。

[先前method2原始收据](current-performance-3c5a62ae-9d7d-4098-9262-238f64b1a69e-receipt.json) 在静态DOM/rAF真实成功时记录单调时钟，直到exact main目录、该调试端口真实所属PID与精确tauri页面证明全部通过后才发布样本。3次候选独立于5.321–6.296s目录guard和8.054–12.670s全部检查结束；没有从旧结果扣减时间。首4594.3313ms仍超过3s，该次FAIL不改为通过，后两次和暖搜PASS不能覆盖首样本；之前没有操作输入/IPC/配对/截图/储存，默认安装驱动仍串行。

随后 [dbfa5819带实际阶段时钟的重验](current-performance-dbfa5819-d9a4-437c-b70a-66fb2b86fe0b-receipt.json) 在未改4f产品下PASS：完整保留3次冷启动与30次暖搜、首搜97.2ms、4次正常退出，没有预热SUT/工具、减时间或删样本。cdpTargetSeen/cdpConnectStarted/cdpConnected/headingSeen/domReady均为现场单调时钟，最后时钟等于候选，所属/隔离证明全部通过后才接受；独立检查原始样本与p50/p95/max一致。743与3c仍是各自原始FAIL，观察包含接入/轮询开销且OS磁盘缓存未清空；本机当前样本通过不保证所有硬件/所有运行场景性能。

[新180秒观察对照cfe2795a](current-paired-chrome-close-live-aged-observation-cfe2795a-4a37-4396-b09a-0e3ba9bb8098-receipt.json) 同4f/headless/40秒age，真实A exit0 99,822ms、B exit0事件144ms/观察179ms；2live→1live各target在线、关闭后精确吊销2项、main0/已知WebView消失/root进程监听空，独立检查PASS。它证明有界方法能记录实际正常退出，不是快速退出或Crashpad原因证明；没有安装，不能单独通过V15。

2648/0739实际失败截图显示已选1项、Move/Delete可见且禁用；LibraryWorkspace的pickedIds>0使browse-heading及New隐藏/inert，原因不是查询文本本身。修正后7acc/de41实际选择工具栏Move/Delete禁用及fixture文件夹New可见且禁用均通过，截图已独立查看。该次Chrome A实际exit0 108,304ms、B0 145ms，main90828 child0；PID-only检查仍报131548。随后只读审计显示131548已是新创建的command_shell且不属于测试根，不输出原始命令、不执行进程操作；旧WebView的exitcode仍UNVERIFIED，不改原FAIL。最终root进程/监听为空、正常uninstall0；611个文件/48,743,156bytes完整manifest与221,184byte SQLite hash前后相同，d785严格产品键恢复PASS。因为main已结束，trusted IPC凭据吊销失败，不能把卸载/根为空等同精确凭据不存在；该namespace须另列审计/清理证据。应用重启仍NOT_RUN。

早期b9e7a249实际main用了default app store，harness写入过合成r08-main localStorage；见 [native-isolation-failure-2026-10-13.md](native-isolation-failure-2026-10-13.md)。未读取/删除默认目录，影响仍UNVERIFIED；当前隔离通过不能反推早期日常数据未受影响。

## 后续环境实查

- 当前 host 为 Windows；`Get-Command ollama` 无结果，`http://127.0.0.1:11434/api/tags` 未响应。
- 已存在 Ubuntu-24.04 WSL2：Linux `6.18.54.1-microsoft-standard-WSL2 x86_64`，DISPLAY `:0`、WAYLAND_DISPLAY `wayland-0`，GTK `3.24.41`、WebKitGTK `2.52.6`。只读探测没有找到 `google-chrome`、`cargo` 或 `pnpm`；没有安装工具或改系统。
- 用户本轮答复：暂时没有 macOS/Linux 测试主机，也没有本地 embedding 模型；要求记录未验证并继续实现与确定性检查。因此 14 原生 V17、15 实际模型质量与性能 V18 必须保持 NOT_RUN，任务和原父任务不能因此关闭。
