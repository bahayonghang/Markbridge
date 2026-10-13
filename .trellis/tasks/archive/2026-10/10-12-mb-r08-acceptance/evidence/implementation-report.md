# R08 实施报告（文档与浏览器组合回归）

> 2026-10-13 提交前另补条件撤销安全修复及新产物定向原生回归。本文下方保留改版验收当时的结果，804d 产物已是修复前历史；当前结论和分层证据复用范围见 [precommit-closeout.md](precommit-closeout.md)。

> 历史实施阶段报告，保留当时的分工与未测状态。用户随后已豁免本轮真实睡眠验收；当前门槛以父 `gate-change-2026-10-13.md` 为准，最终验收以本项 `receipts.md` / `check-report.md` 为准。下文“仍需补齐”不是当前阻塞。

2026-10-13，trellis-implement 子代理。R08 为当前唯一活动子任务。主会话负责 native-*、系统休眠、性能、任务状态及最终收据；本报告不关闭 R08，也不把 R01–R07 的历史 PASS 算作 R08 新运行。

## 改动范围

- `docs/user-guide.md`：按实际界面入口编写中文指南，覆盖连接／只读来源、范围搜索、单条与批量、标签备注、双预览、历史导出与条件撤销、整理和 AI。明确 expectedSubtree 要求桌面与扩展配套更新；不声称安装包发布、跨平台、全库恢复、真实模型质量或外部同步通过。
- `tests/e2e/acceptance.spec.ts`：两个组合场景，复用既有 fixture。测试搜索后保存标签备注、内容预览、整理、历史、导出再回到原查询；测试相同 chromeId 的两个 Profile 保存内容隔离、未保存草稿取消／放弃和焦点恢复。操作通过可读标签完成，内部编号仅用于核对边界调用。
- `tests/e2e/mock-bridge.ts`：sources 场景复用本地侧车及内容缓存；侧车按 Profile 与节点编号分区；记录本地保存与导出参数以验证来源归属。代码仅由测试路由使用，不进入产品。
- 本报告及 `implement-*.log`、`screenshots/implement*`。没有改动产品源码、协议、Rust 或扩展。

## 本次执行

| 命令／观察 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm lint` | PASS，exit 0 | `implement-lint.log` |
| `pnpm typecheck` | PASS，exit 0 | `implement-typecheck.log` |
| `pnpm test:e2e tests/e2e/acceptance.spec.ts --workers=1 --repeat-each=3` | 6 PASS，exit 0；两个用例各三次 | `implement-browser-settled.log` |
| `pnpm test:e2e tests/e2e/acceptance.spec.ts tests/e2e/connection.spec.ts tests/e2e/details.spec.ts tests/e2e/history.spec.ts --workers=1` | 21 PASS，exit 0 | `implement-browser-regression.log` |
| 浏览器渲染 | PASS：正常窗口工作区往返与640×480导出页已实际查看；复用五尺寸矩阵的几何断言通过 | `screenshots/implement/r08-workspace-roundtrip.png`、`screenshots/implement-regression/r06-export-top-640x480.png` |
| Rust、协议、构建、全量单元／E2E、原生测试 | 此代理 NOT_RUN，由主会话和独立检查承担 | 以本项 `receipts.md`／`check-report.md` 为准 |

浏览器使用本地 Vite 与 Playwright 隔离 fixture，所有截图命令都设置 `MARKBRIDGE_EVIDENCE_DIR` 到本项 `evidence/screenshots/implement` 或 `implement-regression`。资料、备注、网址和保存结果均为合成数据。`save_export` 返回 saved 只验证导航及来源传参，**不证明原生保存对话框或真实文件落盘**；侧车 fixture 不替代实际 SQLite 的 Profile 隔离验收。

首次失败保留：

1. `implement-browser-first.log`：pnpm 包缓存锁受沙盒访问限制，未启动用例；host 权限重跑。
2. `implement-browser-host-first.log`：1 PASS／1 FAIL。第二份资料保存备注后立即切换，父级未保存草稿保护尚未随子编辑器的 React effect 完成刷新，出现确认框。诊断在 `implement-profile-diagnostic.log`，没有产品写入或身份串用。测试改为在已保存、按钮可用、文本稳定后等待两次渲染帧，随后 6 次和受影响 21 项全部通过。诊断用 React 内部读取已从最终测试移除。

## U01–U10 与验收映射

下表的 R01–R07 为已核对的前置证据，原始版本、环境和失败保留在对应收据。最终 R08 原生、性能与系统行为仍须使用本项新运行。

| 需求 | 已有分项证据 | 本项覆盖／剩余验收 |
| --- | --- | --- |
| U01 蓝色桌面布局 | [R01 收据](../../10-12-mb-r01-shell/evidence/receipts.md)：native-report 五尺寸；[R07](../../10-12-mb-r07-organize/evidence/receipts.md)：874dbc46 五尺寸 | 新组合截图为书签优先，灰侧栏、白主区、蓝色选择；AC-R08-3 原生矩阵由主会话补齐 |
| U02 来源接入与状态 | [R02](../../10-12-mb-r02-connection/evidence/receipts.md)：70727125，两临时 Profile、断线、重启、相同编号 | 新 sources 组合验证换源草稿选择；AC-R08-1／2 实际接入和断重连独立验证 |
| U03 浏览搜索 | [R03](../../10-12-mb-r03-browse/evidence/receipts.md)：d23bba4d，10001项、深20层、交集与末项可达 | 新组合返回后查询及4条命中不丢；AC-R08-1／4 仍需真实大库 |
| U04 单条编辑 | [R04](../../10-12-mb-r04-editing/evidence/receipts.md)：ad0def29，空目录创建／独立草稿／预览取消 | 指南串起实际按钮；不复制已有 CRUD 测试；AC-R08-1 原生闭环 |
| U05 多选安全 | [R03](../../10-12-mb-r03-browse/evidence/receipts.md)选择范围；[R04](../../10-12-mb-r04-editing/evidence/receipts.md) a1a1186d 和四类第40项故障 | 指南强调已加载范围、影响数量和已完成部分；AC-R08-1／2 集成 |
| U06 详情和本地数据 | [R05](../../10-12-mb-r05-details/evidence/receipts.md)：e5e26b2a，20A/B延迟、离线元数据、双预览 | 新组合覆盖来源相同编号的保存隔离、离开草稿和内容预览；AC-R08-1／2 实际数据仍独立 |
| U07 历史／导出／撤销 | [R06](../../10-12-mb-r06-history/evidence/receipts.md)：history61440e3d、export951c480a、webc3d68946 | 新组合历史→导出→书签保持来源、查询与本地内容；AC-R08-1／4 原生保存与撤销 |
| U08 整理与 AI | [R07](../../10-12-mb-r07-organize/evidence/receipts.md)：organize874dbc46／webe34f302e，默认关闭、范围、取消和过期方案 | 新组合进入整理不触发模型／检查／写入；指南披露发送内容，真实模型质量保持 NOT_RUN |
| U09 键盘／性能／视觉 | [R01](../../10-12-mb-r01-shell/evidence/receipts.md)焦点／尺寸；[R03](../../10-12-mb-r03-browse/evidence/receipts.md)647f28ce p95=103.2ms；V03小样本最大42.8131ms | 新换源 Escape 回焦；AC-R08-3／4 的 B10K V03/V06 与实际系统150%／跨屏不由旧收据关闭 |
| U10 安全回归 | [R04](../../10-12-mb-r04-editing/evidence/receipts.md)备份／保护／冲突；[R07](../../10-12-mb-r07-organize/evidence/receipts.md)68条远程命令均拒绝 | 新组合核对无浏览器写入或自动模型调用；AC-R08-2／4／6 的原生隔离、远程窗口及真实休眠由主会话补齐 |

| R08 AC | 此交付的贡献 | 关闭条件 |
| --- | --- | --- |
| AC-R08-1 | 浏览器跨工作区组合 PASS；指南提供不依赖编号的路径 | 新隔离目录上的真实接入、CRUD、多选、预览、导出、撤销完整闭环 |
| AC-R08-2 | 相同 chromeId 两资料的 UI 备注／草稿边界 PASS | 两真实临时 Profile 与中断恢复 |
| AC-R08-3 | 受影响浏览器五尺寸回归 PASS，2张实际视觉复核 | 本项原生窗口／缩放／状态矩阵 |
| AC-R08-4 | 不用 mock 证明原生或性能 | 本项 B10K 原始时序、live V03、原生保存和预览权限 |
| AC-R08-5 | 用户指南及分层映射已完成 | 独立检查、主会话完整分层结果与剩余项 |
| AC-R08-6 | 未执行系统休眠 | 真实 OS 休眠／唤醒观察，live前不能写入，完整树重新核对；不可用 mock 或 Resumed 单测替代 |

## 视觉与边界复核

沿已批准蓝色方案：平面灰白分区、细分隔、蓝色选中行，紧凑书签列表居中；信息和操作按需进入详情，没有首屏模型配置。此次检查2张代表性渲染，修改0个产品界面，发现0个需在本次文档／测试范围修复的视觉问题。当前截图是 fixture 内容，实际资料由原有经过校验的 DTO 接入。

用户脚本 SHA256 核对未变：

- `scripts/foundation.test.mjs`：`d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`
- `scripts/tauri-dev.mjs`：`85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`

没有提交、归档、发布、安装或操作日常 Chrome。既有用户修改和其他代理文件保留。仍须完成主会话原生验证及独立检查，不能以本报告关闭 R08。真实系统150%／跨屏 DPI、真实休眠仍以本项收据最终状态为准；外部同步 V16 缺环境保持 UNVERIFIED，真实模型质量保持 NOT_RUN。
