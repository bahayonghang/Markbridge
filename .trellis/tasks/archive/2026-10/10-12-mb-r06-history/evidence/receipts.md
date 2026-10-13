# R06 验证记录

2026-10-13：R04/R05各自AC、独立检查和原生门槛通过后，R06 validate 10/11 PASS并start。基线R05冻结exe f43fa182 /23,772,160bytes；其native-details-e5e26b2a 6PASS、native-web-2c95c715 11PASS只作为前置证据，不替代R06保存/撤销验收。

主线程维护任务与native-*驱动，Trellis implement/check负责产品/自动检查。所有原生文件对话框和写入实验只用临时输出/应用目录、临时Chrome。继承R05 main-webview随MARKBRIDGE_APP_DATA隔离，不设置全局WEBVIEW2_USER_DATA_FOLDER。真实OS休眠仍留R08完成前。

以下为原始阶段记录；最终结论见本文后半部分。

阶段记录：

- `browser-history-first.log`：五种尺寸的初次历史/完整撤销/导出界面测试 5 PASS。主线程已查看 1440×900 历史、640×480 撤销与导出截图；这些是浏览器 fixture，不替代原生保存证据。小窗导出截图因按钮滚入视口而停在非页首，另补页首几何检查。
- `automated-rust-tests.log`：初次 core 106 PASS / 3 FAIL / 3 ignored。两个凭据测试需隔离环境权限复核；恢复映射断言 0 对 2 暴露临时映射已被消费的问题，后续改用持久提示和成功回执；独立审查另发现删除后代必须读取完整快照。保留首次日志，不能将本轮标为全量通过。
- 独立审查另要求保留已消费恢复映射的持久追溯、监听异步撤销终态。通过修复回归和原生证据后再更新结论。
- 主线程 `native-export.mjs`、`native-history.mjs`、`native-web.mjs` 及受自身 PID/临时根目录限制的对话框/文件占用 helpers 已准备，语法检查通过。尚未执行新产品原生验收。

原生阶段（最终构建复验前）：

- 第一产物 `77efe5e31122a3e7572c3f2170a27526ea010755f13150ad645fd874e754cdc7`，24,033,280 bytes，`native-build-first.log`。
- `native-export-807627e1.json`：6 PASS。实际 Unicode 路径 HTML/JSON 可解析；保存对话框期间 Chrome/本地备注继续变化但文件维持原快照；取消无文件/成功提示；占用目标产生真实 Rust 写入失败、旧字节保留、重试保存成功；离线与独立镜像 HTML-only 通过。0 页面错误，临时凭据已清理。
- 保存脚本初次失败全部保留：e4a120a3/1a13ff5f 为 UIA 未匹配原生文件名控件；be7118f5/6fb32f1a/53c74aa4 为覆盖提示使用现代 id=0 的 Yes/No 按钮；94c13658 为 PowerShell 5 Split 重载。现按本次 PID 下已观察到的 Edit/按钮定位，无产品绕过或模拟保存。
- 历史 ef65d3ce：语义树恢复后，harness 错误要求新旧 bookmarkId 相等。原06合同明确重建身份及侧车迁移；临时数据库只读检查确认备注迁移到新身份。bb2d8b7c：纯冲突零步骤按原引擎更新原 operation，harness 错误等待新 undo 记录。3f5acf49：已通过树/稀疏顺序/备注/外部标题保护，但试图跳过 partial 人工核对、点击禁用的确认按钮。已按真实合同修正断言，保留每次失败证据。
- 原生检查发现历史“备份导出”未接通：独立检查补 App → LibraryWorkspace → HistoryWorkspace 导航，保留来源和草稿。需对最终构建重跑本项三个 native 入口再关闭 AC。

## 最终验收（2026-10-13）

独立审查和四项 AC 全部 PASS。最终 exe SHA256 `89c17f5a9b59f08dd9f14654c4958597cc6a478665dd20ad5bf42fc5b6885178`，24,033,280 bytes；扩展 SHA256 `567f50146319a2b6f013f773308910f29bc56585a62075dbaf0f9b3cf1ff22c5`。`native-build-final.log` 记录最终构建。

环境：Windows 11 Pro 10.0.26300，Core Ultra 9 275HX / 24 logical CPUs / 68,143,853,568 bytes RAM，Chrome 155.0.8059.39，WebView2 155.0.4283.45。每次运行使用任务临时应用、Chrome Profile、凭据 namespace；最终报告均零页面错误且临时凭据清理成功。

自动检查详见 `check-report.md`：lint、typecheck、build/产物扫描、protocol:check、fmt、clippy PASS；最终 pnpm test 167 Vitest + 6 script；Rust 142 PASS / 3 pre-existing ignored；最终 E2E 51 PASS。最终命令均 exit 0。首次全前端 166/167 的既有标签异步草稿确认失败保留，同一源码 13/13 聚焦及全量 167+6 重测通过，未修改标签产品或测试以消除观察。

| AC | 最终原生证据 |
| --- | --- |
| AC-R06-1 | `native-history-61440e3d.json` 6 PASS：独立历史不依赖节点选择，类型/时间/数量/真实状态可见；partial 人工核对保留原状态；断线仍可读，撤销禁用，历史入口直达导出并保留来源。自动回归另覆盖 unknown/failed/conflict 和异步终态。 |
| AC-R06-2 | `native-export-951c480a.json` 6 PASS：实际 Windows 对话框写入 Unicode 路径，HTML/JSON 可解析；对话框期间 Chrome/备注变化但输出维持统一快照。取消无文件或成功提示；FileShare.None 占用目标产生真实 Rust write failed、旧内容保留，重试成功。未声称模拟磁盘耗尽。 |
| AC-R06-3 | 同一 export 报告：断线缓存可导出；独立文件镜像只显示 HTML、来源与缓存时间；直接 sidecar 请求 READ_ONLY 且不弹对话框。 |
| AC-R06-4 | 同一 history 报告：完整3步删除恢复预览取消零写入；实际 Chrome 恢复语义树/稀疏兄弟顺序/备注/3条持久映射。新节点获得新本地身份，原身份用于追溯。外部标题不覆盖；partial 必须人工核对后仅逆转2条已确认步骤，保留冲突/未执行项。 |

三个最终命令均以本项目根目录执行并 exit 0：

- `node .trellis/tasks/archive/2026-10/10-12-mb-r06-history/evidence/native-export.mjs`
- `node .trellis/tasks/archive/2026-10/10-12-mb-r06-history/evidence/native-history.mjs`
- `node .trellis/tasks/archive/2026-10/10-12-mb-r06-history/evidence/native-web.mjs`

补充安全：`native-web-c3d68946.json` 11 PASS，68个当前注册命令全部对远程页面 DENIED（含三个新增命令）；独立窗口、真实导航/焦点、Profile存储隔离、清理、禁止导航/弹窗/下载与失败状态通过。未开放通用文件系统 capability。

五尺寸浏览器截图在 `screenshots/check-final-navigation/`；原生截图在 `native-screenshots/`。包含完整61步撤销列表、页首/结果分开取景、640×480可达操作；主线程和独立检查已视觉检查。浏览器fixture不替代原生文件/Chrome证据。

已同步 frontend component/hook/type-safety 与 backend database/error-handling：epoch绑定、完整撤销、持久映射、统一快照、原生保存真实结果。检查新增真实SQLite回归覆盖跨epoch旧pending map不能覆盖新身份。最终历史导出入口补齐后重新构建并复跑全部原生入口。

受保护用户脚本 SHA256 未变：foundation.test.mjs `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`；tauri-dev.mjs `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`。

未提交、归档、发布、安装或修改日常 Chrome。R07 接手整理和 AI 已确认操作取消文案；R08 仍须完成真实系统休眠与实际显示缩放待验事项。

## 2026-10-13 提交前补充

撤销新建文件夹的外部后代保护已修复，自动回归及当前新exe真实UI回归通过。详见 [R08 最终复核](../../10-12-mb-r08-acceptance/evidence/precommit-closeout.md)。历史原生证据及其hash保持原样。
