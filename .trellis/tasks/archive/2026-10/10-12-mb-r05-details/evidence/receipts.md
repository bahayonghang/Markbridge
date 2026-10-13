# R05 验证记录

2026-10-13，R03/R04各自AC、独立检查与原生门槛已通过，R05 manifests11/12 validate成功并正式start。前置R04最终UI ad0def29/exe9ac5157f；完整批量安全证据见R04收据。本项产品自动/浏览器/原生尚NOT_RUN。

主线程维护native-*脚本和任务文档；实现代理负责产品与自动用例，之后独立检查。原生驱动从已验收R04复制到本项，更换临时根/凭据前缀为r05，不执行旧09扫描日常Profile的harness。保留真实休眠到R08完成前的用户授权，其他权限隔离/受限fetch合同不变。

## 原生驱动预校验（R04 artifact，非 R05 验收）

使用 R04 exe 9ac5157f / 23,766,016 bytes 构建 R05 harness。原始 `native-web-*.json` 保留，不据此勾选 R05 AC。已观察独立窗口、65 个应用命令均拒绝远程调用、真实前进/后退/刷新；以下首次失败分开处理：

- PowerShell helper 注释与慢进程枚举问题，修正后截图成功。延迟截图只能观测当时焦点，改为在打开前准备即时焦点观察；不主动激活 preview 冒充应用焦点转移。
- `javascript:void(0)` 的纯 location 赋值不一定产生导航，补真实 anchor 行为后 scheme/file notice 通过。
- `/userinfo` 可有 HTTP hit，但页面没有 hello、应用显示 USERINFO_DENIED；独立窗口导航不能与受限正文 fetch 的网络规则混同，按实际页面加载与状态断言。
- 下载脚本 link.download 触发已请求附件但无 DownloadBlocked notice；检查 SDK 接线无已证实缺陷，改用附件页面导航继续核验。
- e4f5bc66 的 A/B 会话隔离失败定位为 harness 全局 `WEBVIEW2_USER_DATA_FOLDER` 覆盖了 preview data_directory。移除此全局变量前，先使既有 `MARKBRIDGE_APP_DATA` 的 main WebView 数据也使用该临时根，避免落入日常应用目录。默认无该变量的应用行为保持。

上述运行临时凭据均已移除；测试从未写入日常 Chrome。真实系统休眠仍为 R08 完成前的未通过门槛。

补充驱动诊断：实际调用 Windows PowerShell 5.1 / 默认 code page 936，UTF-8 无 BOM helper 中的中文匹配字面量会误解码；焦点 watch 改为 Node 传 Unicode 参数，保留即时 Console.WriteLine READY。先前 `r05.bin` 在确切默认下载路径不存在；后续附件验收在临时 preview preferences 内指定 root/downloads，并断言无落盘文件。

## 最终自动与原生证据

冻结产物 `native-build-final.log`：PASS，23,772,160 bytes，SHA256 `f43fa1827d0b2b1a9d740cc997c34c880c7a6dda7b253d2dc733d4ec6afff7b1`。扩展未改，dist hash `7deb42c27dc23bca5e9277734d5d41a9c49d0c18d89e4b2475a703e3147b2040`。Windows 11 Pro 10.0.26300、Core Ultra 9 275HX、24 logical CPUs、68,143,853,568 bytes RAM、Node26.7.0、WebView2 155.0.4283.45、临时Chrome155.0.8059.39，实际系统缩放125%。

独立检查：lint/typecheck/protocol/fmt/clippy/root build+artifact PASS；156 Vitest +6脚本；Rust136 PASS/3ignored（107core、15desktop、14protocol）；45 E2E PASS。命令和首次失败详见implementation-report.md、check-report.md及各唯一log。受限fetch/离线缓存时间来自真实Rust HTTP fixture `http_fixture_switches_twenty_times_without_mixing_and_keeps_offline_cache` 与组件/浏览器渲染；Chrome断线不等于网络离线，未虚构强制缓存政策。

| 验收 | 实际证据 | 结果 |
|---|---|---|
| AC-R05-1 分区、多选、关闭回列表 | native-details-e5e26b2a.json：单项3tab/多选共同区域，草稿跨tab及关闭保留，列表scrollTop780→780 | PASS |
| AC-R05-2 离线标签/备注、草稿离开 | 同回执：关闭临时Chrome后保存A/B不同备注、批量标签增加/移除/增加；重连真实Chrome比对标题/URL保持原样；keep/discard对话框 | PASS |
| AC-R05-3 20次交替/长内容 | 同回执：真实IPC fetch Response交替延迟500/15ms，20 A/B周期实际观察40次读取，最终B备注正确；最终observer共43次延迟、120次IPC；5原生尺寸无横向溢出，组件/E2E显示离线缓存时间与长正文 | PASS |
| AC-R05-4 双预览/显式编码 | 同回执：hidden内容0请求，打开内容后正控制1请求；标题编码显式启用、全diff、取消0Chrome写入；不可达网页显示失败，真实rundll32接力在suspendCount1/0children时核对并终止 | PASS |
| 独立原生窗口/权限/会话 | native-web-2c95c715.json：11PASS，main→preview前台焦点35ms观察；65应用命令均DENIED；真实前后退刷新；scheme/file/userinfo/popup/download拦截；0下载落盘；关闭保留会话、A/B cookie/storage隔离、清A保留B/main | PASS |

最终五尺寸为1440×900、1100×760、640×760、1100×480、640×480，scale均1.25。已查看 `native-screenshots/cef84b75-long-url-640x480.png`、`cef84b75-long-url-1100x480.png`、`0e4f2c24-offline-common-metadata.png`、`2c95c715-remote-ready.png`；最终同产物图片使用e5e26b2a前缀。所有运行只操作临时目录/临时Profile，凭据已移除。Chrome外开仅检验真实进程接力，未声称日常Chrome页面已打开。

## 最终驱动复核与保留的首次结果

- native-details-0e4f2c24：前两项PASS；重连合法清除selection后脚本仍无条件点击取消按钮，改为按当前可见状态清理后继续。
- native-details-b39c1907：前三项PASS；Playwright.check的立即状态断言与真实异步set_encoding回执不匹配。改实际click+eventual checked，标题diff与取消通过，无产品修改。
- native-details-ae9d9318：其余UI/原生步骤PASS，但收据delayedReads=0揭示Tauri invoke属性不可写，原注入未生效；**不得作为强制晚到证据**。未覆盖或删除原回执。
- native-details-cef84b75：改为包装真实IPC fetch，>=40延迟正控制通过；最终e5e26b2a另补可见content_preview的计数正控制，证明hidden时0不是失效监测器。所有Response/headers/body原样返回，不伪造后端结果或暴露IPC凭据。

R05已发现并修复的身份世代、干净数据未加载时只读、标题diff刷新失效、键盘草稿确认、异步busy和非current会话清理错误合同写回spec。既有AiSuggest对已确认操作的取消文案交R07，研究文件已入其上下文，不将取消说成撤回已发送写入。真实OS休眠、系统150%与跨屏项仍留R08，R05不豁免。
