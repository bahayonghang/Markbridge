# 05 书签工作台、搜索与多 Profile：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

apps/desktop/src/features/library、connection、profile、typed backend adapter；UI fixtures 与组件/性能检查

## 技术合同

主界面为资料/目录导航、书签列表和详情区；详情为后续内容预览及修改差异提供真实空态。使用实际数据订阅而非多份树状态。subscribe-before-hydrate，revision 缺口重取。列表和树按需要虚拟化，搜索 200 ms 去抖或更低延迟；输入响应不得因后台全树刷新阻塞。Profile 切换取消旧请求并清理选择。键盘能选中、展开和打开链接；普通打开使用系统 Chrome/默认浏览器交由明确按钮。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

记录 1280×800 与 1920×1080 原生窗口截图、125%/150% DPI 行为、键盘遍历；执行 B10K 搜索和在线事件计时。

## 故障与回退

恢复前一 UI 版本，缓存与 Profile 不迁移。取消订阅应不影响后台存储。
