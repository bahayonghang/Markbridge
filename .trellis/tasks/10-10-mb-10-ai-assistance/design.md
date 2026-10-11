# 10 AI 单条建议、端点与隐私控制：设计

## 当前与边界

当前仓库没有产品代码。以下是目标设计，路径为拟新增或修改位置，不代表已经存在。

apps/desktop/src-tauri ai/provider/secret storage、crates/core ai jobs/schema、apps/desktop/src/features/ai/settings、测试 provider

## 技术合同

父设计第 9 节定义结构化输出和边界。Rust 直接调用 reqwest provider adapter，不加本地 HTTP 服务。兼容端点以显式 base URL + 模型配置，支持能力探测与验证失败反馈；无密钥的本地 Ollama 可使用。Windows Credential Manager 保存秘密，前端只收到是否已配置。内容选择范围和 endpoint/model 在发送前可见；页面中的提示指令不具有执行权限。持久 job 包含输入指纹，已有书签变化使 proposal 失效。apply 复用 06/07。

公共协议、数据模型、来源优先级、操作状态和安全边界遵循 [父设计](../10-10-markbridge-workspace/design.md)。若发现需要改变跨任务合同，先修改父设计及受影响子任务，再进入实现；不得建立第二套不兼容协议。

## 数据与兼容

输入和输出使用 02 的版本化 DTO；Profile、sourceEpoch、requestId 和 revision 不在边界隐式丢弃。数据库改动必须编号 migration，保留旧库及回退证据。当前 task.json 的 relatedFiles 记录目标路径，实施时先检查真实目录再编辑。

## 验证边界

用已安装且用户配置的 Ollama 模型测 10 页；若无服务/模型保留 NOT_RUN。云端费用与账号需单独授权；模拟端点只验证协议，不称真实模型质量通过。

## 故障与回退

取消作业、删除 provider 凭据引用、保留未应用草稿供用户选择。已应用标题/标签按操作历史条件撤销。
