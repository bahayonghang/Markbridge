# 15 独立复核

日期：2026-10-13。既有任务 15 已由主会话启动；本报告记录后续源码、确定性及原生 mock 复核，不能替代真实模型 V18。

## 当前状态

已读取 PRD、design、implement、两个上下文清单及 check 的十份规范/研究引用。实施者分别负责 backend/protocol 与 UI/wrappers；复核者不创建重复任务或子代理，不启动原生应用或模型。最终源码、完整自动/E2E 检查、当前 4fc 原生 synthetic 功能、正式包隔离安装闭环及 B10K 普通搜索均已独立批准；真实模型和平台验收仍缺环境，15 与原父任务保持未完成。

## 必查合同

- 默认设置、启动、重启、未启用保存、渲染及状态读取零模型请求。embedding 配置与聊天 AI 独立；只访问受限 loopback/pinned localhost，禁用代理/重定向/隐含凭据，发送文本前拒绝声明的 remote-backed 模型，不 pull。
- Rust 解析当前 Profile/sourceEpoch/revision 的明确范围；审查计数/空间后确认，冻结 1–10,000 个持久 bookmarkId。仅标题与已保存摘要，经版本化限额裁剪；完整内容和身份指纹检查，不发送 URL、笔记、标签或预览全文。
- 注册唯一作业所有权；暂停/禁用/删除/配置替换先持久推进 generation 再取消。晚到响应提交时检查 index/generation/状态/身份/完整内容/model/dimension；取消在订阅前发生也有效。重启只转 paused，需显式继续。
- 标题/摘要所有写入口及元数据恢复使授权成员失效；notes/tags/move/unchanged full snapshot 不失效。全量替换只在最终状态判真正删除，避免临时 tombstone 清空向量。新身份不继承旧范围，删除派生索引保留原数据/FTS/聊天配置。
- migration008 前一致性备份与失败保留；SQLite worker 流式扫描最多 10,000 条，单行验证 finite/nonzero/维度与 BLOB 长度、保留 topK、逐行取消。schema/Ajv/IPC 只传验证过的命中与状态，所有新命令 main-only。
- UI 请求绑定 source visit/epoch/index generation/query request；A→B→A、晚到状态/结果/finally 不串源，不清较新 busy。范围说明/确认/暂停/继续/删除可见，词法搜索独立，保持现有蓝色简洁风格并检查实际截图。

## 已知未验证项

用户确认没有可用 embedding 模型；真实模型 digest/维度、人工审查 20 查询 Recall@5 与 B10K 至少 30 次暖态全路径 p95 均 NOT_RUN。开发者候选标签、确定性向量、HTTP 模拟、浏览器 fixture 或实际 Tauri mock 集成不能升级为模型质量证据。AC15-3/V18、15 任务及原父任务均不能据此完成。

## Findings / Verification

早期源码复核已提出以下具体发现，与对应文件所有者协调修复，以下完整独立回归已通过：

1. `/api/embed` 回应缺失或更换 `model` 原来仍可当作当前模型向量提交。现要求回应与解析后的规范模型名称一致；解析 `:latest` 别名后的名称也重新验证长度。
2. 初版 DTO 的模型/标题无界，dimension/count 仅用通用 u16，超过已批准范围仍可通过 schema。已加模型/标题、dimension 1–4096、review count 1–10000 与状态计数 0–10000 的 schema 约束；模型/状态跨字段校验仍需联审。
3. BLOB 解码原以各分量误差 <=0.001 判归一化，并返回原数值供点积排名；4096 个 0.016 分量的 norm 为 1.024，却会被接受并偏置所谓 cosine。已要求整体 norm 校验与防御性归一化、对应高维反例。
4. 改模型/端点后的 Stale 状态原可由禁用→启用或 pause 变回 Paused，查询只检查 enabled，随后会使用旧端点/模型。已要求 Stale 保持不可用，并在任何查询网络请求前及 SQLite 检索内部独立核对当前配置与索引端点/模型；反例须证明旧端点零请求。
5. 构建末尾检测模型 digest/维度变化原仅变 Failed，已提交 ready 向量保留；若旧模型版本稍后恢复，查询可能再次使用混入的向量。实现者已改为持久 Stale、必须重新审查构建，并补版本恢复后仍拒绝查询的反例。无法观测的外部 daemon 瞬时替换仍是明确边界，不宣称模型锁定。
6. 查询检测模型变化原来只返回失败，索引仍 Ready。现源码以 indexId/Profile/epoch/generation 的 CAS 持久标记 Stale、推进 generation，再取消绑定的旧工作；旧查询不能使较新的索引失效。跨 Profile 构建也已增加一个可取消的全局 embedding permit；显式查询独立于构建 permit。
7. UI 范围审查原只绑定来源，外部勾选集合改变时仍可显示或接受旧审查。UI 实施者已把选择 ID 或明确目录/模式加入独立 scope binding，并使晚到审查与其 finally 不能覆盖较新选择；共享状态读取绑定不受该修复影响。

8. 取消若早于 query handler 注册，原实现会返回成功但丢失取消，随后旧查询仍可能发送文本。现按主会话批准合同保留至多 128 个 Profile/request 绑定的 pending-cancel key，不按时间驱逐；匹配晚到请求继承 durable flag，在 SQLite 与 HTTP 前返回 Cancelled。容量已满时拒绝未知取消及未知新查询，已登记取消与匹配旧取消仍有效。独立回归包括虚拟 24 小时之后、暂时移除 Storage handle、跨 Profile、幂等、容量及重复所有权的反例，证明没有静默过期后重新发送。
9. 模型 metadata 原接受重复 `sha256:` 前缀，现只接受一个可选前缀及完整 64 hex digest。semantic 八个公共解析器现拒绝孤立 UTF-16 surrogate，保留有效 Unicode scalar pairs、4096 个 emoji 的边界与各自固定错误码。对应 Rust 与 Vitest 反例通过。

已阅读 migration008、全部语义存储与网络/Bridge 方法、现有 metadata 写入口、UI/wrappers 及相关反例源码。源码确认无全文向量 IPC、无模型密钥或 URL/笔记/标签输入；metadata 恢复及所有 summary 写入口经 SQL trigger 失效，真正删除仅在最终树状态删除冻结成员；unchanged 全量树不因中间 tombstone 清空向量。migration008 前保留 v7 含未 checkpoint WAL 的一致性备份，失败回滚 schema 与版本；十万行来源树中的授权范围仍限制最多一万个成员，检索一行一行解码并只保留 topK，不把全量向量送前端。

新评测工具保持边界：原生 HTTP fixture 明确仅为 synthetic functional，未来真实模型 runner 要求显式参数与 HUMAN_REVIEWED 标签；开发者候选当前未人工审查。收据现绑定 COPYFILE_EXCL 复制后的可执行文件与 release 字节一致、seeder/脚本版本、真实 main OS 目录证据及最终进程/监听器清空。Seeder 拒绝链接/重解析及 metadata 错误，只允许暂时缺少的 app-data 子目录，输入严格位于新 temp 根的 semantic-fixture.json；生产 Rust Storage worker 是唯一写库方。当前复核者未执行这些原生工具或模型请求。

未来评测工具另经薄复核：SemanticModelCheck 的 metadata dimension 合同允许 null，不能据此误判模型缺失。runner 先要求 available/digest，待完整 10,000 个 ready 向量后强制实际 index dimension 为整数 1–4096；生产构建仍校验向量和声明维度，不放宽模型变化或实际维度边界。[独立语法/直接 ESLint/无参数检查](current-independent-real-eval-nullable-check.json) 全部退出 0，无参数仅输出 V18 NOT_RUN。此调整只涉及未来工具与说明，未重跑产品 gate、原生或模型验收，不改变此前正式包的源码或通过结论。

## 独立验证

2026-10-13 在 Windows 使用既有 pnpm.exe 12.12.0、Node 26.7.0、Cargo，以下检查全部退出 0，没有安装依赖、日常安装或模型请求。Rust 检查结束后才允许主会话构建当前 release。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| pnpm lint | PASS | [lint](current-independent-lint.log) |
| pnpm typecheck | PASS | [types](current-independent-typecheck.log) |
| pnpm test | 217 Vitest + 20 Node PASS | [tests](current-independent-test.log) |
| pnpm build | PASS，产物权限、机器路径及秘密扫描通过 | [build](current-independent-build.log) |
| cargo fmt --all -- --check | PASS，真实 stdout 为空 | [命令/退出码](current-independent-rust-fmt-result.json)、[空 stdout](current-independent-rust-fmt.log) |
| cargo clippy --workspace --all-targets --locked -- -D warnings | PASS | [clippy](current-independent-rust-clippy.log) |
| cargo test --workspace --all-targets --locked | core144 + desktop34 + protocol14 = 192 PASS，3 个既有 ignore | [Rust](current-independent-rust-test.log) |
| pnpm protocol:check | PASS，无 schema/TypeScript/Ajv 漂移 | [protocol](current-independent-protocol-check.log) |
| semantic metrics pure tests | 3 PASS，候选不能成为人工标签，失败样本保留 | [metrics](current-independent-metrics-test.log) |
| pnpm test:e2e | 完整 80 PASS，含旧工作台、13 diagnostics、14 secure-storage 及 15 八个 semantic 场景 | [E2E](current-independent-e2e.log) |
| git diff --check | 正常仓库配置 PASS；未改行尾，首次检查方法错误单独保留 | [diff](current-independent-diff-check.log)、[方法说明](current-independent-diff-first-method.md) |
| future real-model runner 无参数运行 | 只输出 V18 NOT_RUN，无应用/模型请求 | [NOT_RUN](current-independent-real-eval-not-run.log) |

完整源码与脚本 hash 见 [source hashes](current-independent-source-hashes.json)，日志字节与 hash 见 [log hashes](current-independent-log-hashes.json)。生产构建保留现有大于 500 kB chunk 提示；它既不是检查失败，也不是性能通过证据。旧 Windows 环境或被 cfg 排除的 macOS/Linux 分支不能据此升级为当前原生平台通过。

独立读取并逐一重新 hash [UI 修改后收据](after-e72b4faa-6137-4803-9da3-dd1ce7c2aa9f/receipt.json)：13 浏览器 mock 测试 PASS，检查时 11 个源文件及 36 个截图 hash 全部匹配。它明确 nativeIpc=false、actualModel=false、qualityAcceptance=NOT_RUN。已查看 640×480 设置/范围审查/查询和 1440×900 查询截图，蓝色/白色、焦点和结果呈现与既有工作台一致。小高度范围审查图的下方按钮部分被 footer 截断，实际后续点击可达；随后仅改截图测试，另保留 [完整确认按钮入视收据](confirmation-frame-1934634d-1f44-45c4-8710-43c56c5ac749/receipt.json) 的 1 PASS，复核已查看确认与取消按钮完整显示在 footer 上方，产品/CSS 未变化。最终完整 E2E 80 PASS 包含该 test-only 变更；不把 e72 原测试 hash 说成后续测试修改后的 hash。先前 after-fe42 的 7 FAIL 与 after-b6b 的 1 FAIL 保留。

此 checkpoint 的源码与完整自动/E2E 检查已批准；当前包 hash 的原生功能与安装集成收据见下文。真实模型质量、B10K 模型查询性能、macOS/Linux、历史真实睡眠均按各自 NOT_RUN/UNVERIFIED/WAIVED 边界保留，任务 15 与原父任务未完成。

## 原生集成分层复核

已独立读取 [11449493 原始 synthetic 收据](current-semantic-native-11449493-eca1-402a-995d-5938aaacefa3-receipt.json)：9 个功能控制 PASS、errors 空，实际 release 与复制程序均为 25,301,504 字节、SHA256 `3a283fa596cfcba487ac4070f0b080de0fd3a1040f6c7b6fb5053d83718bef14`。首次与重启后的 main OS 观察为本 fixture 的 `app-data/main-webview/EBWebView`；两个 main 均正常退出 0、signal null，两个已观察 WebView 原 PID+UTC identity absent，最终 fixture processes/listeners 空。默认/未启用保存、typing、restart、disable 零隐含模型请求，明确 metadata 检查与 remote-model 拒绝，范围 3 个、4 维、48 字节向量，跨 Profile 拒绝、迟到响应/暂停/显式恢复、持久 Stale/明确重建、删除取消及普通搜索保留均有本次功能观察。其模型是确定性 HTTP fixture，actualModelV18 明确 NOT_RUN，不是模型质量证据。

正式打包随后产生不同字节：独立 [当前 release 静态扫描](current-independent-release-scan.json) 为同样大小、SHA256 `4fcf7fcd506ad60eac1798c2a4c0ed9f80888648f7a5050ec41e6d47c67ff707`，Windows x64 PE、路径/秘密扫描 PASS。包日志及独立读取明确 packed 与 post-bundle release 字节完全一致，随后本 hash 的 synthetic、安装及必要性能观察均通过；不能把先前 3a 收据重新标作 4fc。

另保留 [114 的 live helper 一致性检查失败](current-independent-native-first-assertions.log)：工具在首轮运行后加入精确 note/tag/summary FTS 前后对比，helper hash 从 `75dbe7...` 变为 `311ef8...`，故严格要求历史 helper 等于当前 helper 的复核断言失败。原始 114 native 状态保持 PASS、helper 与 exe 原 hash 不变；这项失败证明版本有变化，不能被隐藏或宣称历史工具仍是当前工具。新只读检查限定于同一新合成 Profile 的 b1/b2/b3，没有新增外部或日常数据范围，源码已复核批准；其结果须由新的当前 hash 收据证明。

随后已独立核验最终包同 hash 的 [73edf605 原始 synthetic 收据](current-semantic-native-73edf605-908d-4a3a-9aa8-c7ae6bcf0942-receipt.json)，收据完整 SHA256 `841f18ccd3a7403a0d254428aab81c1843c1661421099aa27e67ad6d8a13d2f8`。实际复制程序为上述 4fc hash；9 控制 PASS、errors 空，追加 note/tag/summary FTS 精确前后比对通过。两次 main PID 160624/161224 正常退出 0、signal null；各自观察的 WebView PID 157976/119220 及 UTC creation ticks 均 absent、reusedPids 空，最终 owned processes/listeners 空。两次先验证真实 OS main EBWebView 目录后才允许 IPC/UI，重启不自动调用模型。六个当前 helper hash 全部匹配。

独立 [最终与历史分层断言](current-independent-native-final-assertions.log) 实际退出 0：最终 73 对应当前 `311ef8...` helper，历史 114 对应运行前保留的 [75dbe 源码副本](current-semantic-native-11449493-source.mjs)，副本重新 hash 完全一致；历史 raw SHA256 `a3a2930f8cf2134e001d42b3d64a64c29921fbc6dbcb28099295b0be6498f11b`。它不撤销或覆盖上述首次一致性检查失败。此原生结果仍仅为模型协议、生命周期、真实 IPC/UI 与隔离存储的 synthetic 功能证据；20 人工标签/实际模型 Recall 与 B10K 模型时延 V18 均未执行。

## 最终安装与普通搜索集成

独立 [跨收据断言源码](current-independent-final-evidence.mjs)、[实际 PASS 日志](current-independent-final-evidence.log) 和 [完整 hash 摘要](current-independent-final-evidence.json) 只读取既有证据与产物，不启动应用/模型/安装器。代码实际重新读取 release、受守卫的 packed exe 和 setup，校验架构/路径/秘密、字节一致；同时核对 plan/raw/completion/restore 的精确 id/hash 引用、真实退出、目录所属、80 个当前注册 command 全部 DENIED、原始性能时钟与每个样本。

当前 setup 6,044,252 字节，SHA256 `2844783f1660d3708412b1bcbd602f8a2bc1c85369623cdf996d52368932b183`；未签名、未发布。最终 [3ee4f8c0/eee73eda 原始安装收据](../../10-10-mb-13-windows-acceptance/evidence/current-installer-3ee4f8c0-0010-4ecf-a83c-627a3397746d-eee73eda-be7a-4238-a2be-18def7195915-receipt.json) SHA `791b27f86b2b8aa3c4cbbf039ebfc92f6b5697256d6bf70c99bfc77e3cff5a28`、completion SHA `fa9feb3dd13deed1003720a1744245ea532f254af764e830422227bf611c480c`、严格 registry restore SHA `2dab489abfa0974645e63ea5d00ee5ed943134f1fec0c207a158257e73d5ad0c` 全部匹配且 PASS。11 控制、errors=[]，诊断 schema8/live2、semantic 默认关闭且 endpoint/model=null、80 当前 command 拒绝；普通编辑/抓取、A/B/A persistent session、非 live 禁写、正常重启/P2/本地数据及零回放通过。

main145664/restart160068 正常退出 0、signal null，4+1 原 WebView 的 PID+UTC 身份均 absent。Chrome 三次退出均为实际 0，首次观察 110,395 ms，之后 184/141 ms，在明确 180 秒有界观察内；不宣称快速退出或 45 秒 SLA。卸载实际 0，完整 630 文件、47,756,207 字节 manifest `39eef1a9859cb7895e53f1b16764050616c0f775b24ae25eba6c63e38f901d4a` 与 SQLite 245,760 字节/hash `40efaf06863007bce7be0a68de6ea3bda6b8b129eed9ec57ba2cc6dfc8b2b9e2` 前后完全相同，精确凭据吊销、最终进程/监听清空及两个 run-owned 产品键恢复均通过。严格比较保留 A raw mismatch，仅现场证明 sole synthetic root0.dateAdded 改变且单值替换后完整 JSON 相同；B raw 与完整两条操作历史在三点均精确相同，未追溯改写旧 9cf FAIL。

当前 4fc 的 [V06 普通搜索性能收据](../../10-10-mb-13-windows-acceptance/evidence/current-performance-6c7edb60-a8b9-42fa-ac40-0144aba261f8-receipt.json) SHA `520d5c884a88e118da21116629590d509a9eb4fa84c022cbfc1ba194d20265fe` 独立 PASS：完整三次新进程冷启动 788.3896/633.5898/728.6094 ms，30 个暖态普通搜索样本 p50 95/p95 106.6/max110 ms；另保留第一搜索 warmup 104.9 ms。四次 launch 的五个单调时钟、候选与预 spawn 差值、实际 OS guard 与 CDP 端口/主进程/直属 WebView/可信页面证明均匹配；四次 main 正常 0、精确 WebView 身份消失及 root 进程/监听空。候选只在隔离/所属证明通过后接受，观测/轮询开销未扣除，OS 磁盘缓存未清空；当前机器样本不保证所有硬件或每次环境。原 743/3c FAIL 保留，4f/dbfa 仅属于其自身历史层。此检查 installation/Chrome/model 均 NOT_RUN，且是普通搜索，不能证明语义模型时延 V18。

已独立查看最终 4fc 原生 640×480 查询截图，显示真实 trusted IPC 查询命中与相似度；所有输入均来自本次合成 fixture，没有访问日常 Chrome 资料。当前可执行源码、确定性检查与 Windows 集成均已完成，无剩余具体产品源码阻塞。13 实际模型 V12、14 双平台 V17、15 模型/人工标注 V18 仍未完成；真实睡眠豁免不扩大到这些验收。
