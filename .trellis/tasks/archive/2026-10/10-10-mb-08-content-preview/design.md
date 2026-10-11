# 08 网页抽取、摘要预览与缩略图：设计

## 当前与边界

实现位于下列路径。01 已创建的基础源码以当前工作树为准。

`crates/core/src/preview/`、`crates/core/src/storage/preview.rs`、`crates/protocol/src/preview.rs`、`apps/desktop/src/features/preview/`、`apps/extension/src/capture.ts`

## 技术合同

采用父设计第 8 节的超时、体积、重定向和地址限制。抽取摘要是正文 excerpt/页面 description，AI 摘要在 10 另行生成并明确来源。解析不执行页面 JS，纯文本展示，图片走同一受限 fetch。当前选择 token 防止晚到结果；刷新、取消、缓存时间和失败原因可见。对动态/登录页，用户到 Chrome 点扩展 action 后 activeTab+scripting 采集可见正文；桌面只能提示，不能自行取得 activeTab。不安装 Python/headless 浏览器服务。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

在测试页验证静态、动态、登录失败、无图和缓存离线；通过实际 Chrome 扩展点击进行一次授权采集；检查只采集选中页。

## 故障与回退

取消请求并清除 preview cache；保留本地标签和浏览器树。撤销扩展采集权限不会影响基础书签同步。
