# 09 应用内完整网页预览与隔离：设计

## 当前与边界

窗口管理在 `apps/desktop/src-tauri/src/preview.rs`。主窗口控件在 `apps/desktop/src/features/preview/WebPreview.tsx`。原生结果见 `evidence/receipts.md`。路径表示该任务的修改范围。

apps/desktop/src-tauri preview window manager/navigation policy、capabilities、apps/desktop/src/features/preview controls、原生安全测试页

## 技术合同

采用父设计第 8 节。每个 Profile 使用独立 preview 数据空间，与 main 和 Chrome 数据隔离；每次仅复用一个完整网页预览窗口以限制资源。Rust 管理 preview-* label 和生命周期，固定可信主窗口控制导航。远程页面无任何 app capability，敏感命令再次验证 main 来源。浏览器 Cookie 独立，用户自行登录，可清除当前 Profile 预览会话。初始与后续导航只允许 HTTP(S)，阻止危险 scheme 和默认弹窗/下载，打开 Chrome 由可信按钮明确触发。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

必须实际运行 Windows WebView2；记录远程页调用文件/密钥/书签命令的拒绝证据，Profile A/B 登录隔离，关闭/重开与焦点截图。浏览器 mock 不计入 V11。

## 故障与回退

关闭预览窗口、禁用入口并保留或由用户清除专用会话目录；不能删除 Chrome 或 main 的数据目录。
