# S02 结构与布局

以父design与visual-design为完整合同。沿用纯CSS与现有组件，不引入新的全局状态。

App负责分类，SettingsWorkspace负责左栏/容器。保持AI、语义和连接的已访问挂载及active/generation；不通过按分类key重建面板。纵向使用上/下键，原左右键断言更新到实际语义。

exportHost稳定挂载于设置备份面板，LibraryWorkspace只portal已有来源工具条和导出视图，继续拥有来源和草稿。去掉当前settings-page:has(.settings-scroll[hidden]) display:contents补丁依赖，用显式容器解决布局。不得把整库重新挂载到设置、另起库实例或复制source状态。避免嵌套重复tabpanel。

分类栏184/152/132px，内容padding24/12px，内容上限1600px。连接正文≥960px为1.15fr/1fr两列，24px间距；已配对/只读资料在左、接入在右。无来源/引导主要列为步骤，有pending时配对内容必展开。宽度只约束可读段落，不对整页继续880px上限。

AI提供者/端点/模型与凭据/测试分组，语义配置/限制分组，导出是格式说明/按钮行。危险确认、配对有效期、密钥非受控输入清空、诊断显式导出保持原合同。

回滚仅恢复本任务容器/布局/测试，不改来源逻辑或用户草稿；需变更来源业务时回到规划，不以视觉优化扩大范围。
