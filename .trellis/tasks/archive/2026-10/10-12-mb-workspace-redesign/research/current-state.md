# 现状审计

基线：2026-10-12，main/a4489ce；用户 1377×989 原生截图。已有 scripts/foundation.test.mjs、scripts/tauri-dev.mjs 修改，保留。本表是源码证据，不是本轮运行验收。

| 发现 | 证据 | 处理 |
|---|---|---|
| 首屏标题是 Chrome 连接，AI 设置先于书签，连接表单继续堆叠 | apps/desktop/src/App.tsx:118–143 | R01 重建导航和设置 |
| 全局 input 的 240px 宽度也命中 checkbox | apps/desktop/src/styles.css:70–78 与截图启用 AI 行 | R01 按类型定义控件 |
| 列表固定 360px；960px 下三栏纵向堆叠 | styles.css:20–23,43–46 | R01/R03 全窗分区滚动 |
| 新建和编辑共用字段，表单要求 node 存在 | features/library/EditDesk.tsx:147–166 | R04 空目录独立创建 |
| 手工移动依赖 folderId，没有独立目标树 | EditDesk.tsx:147,166 | R04 目标选择器 |
| 多选集合和 checkbox 已有，没有普通批量移动/删除 UI | features/library/LibraryWorkspace.tsx:125,361–369,610–645 | R03 选择语义，R04 安全批量 |
| cache_list 总从 offset=0 开始、LIST_LIMIT=10000；搜索展示 200 条 | LibraryWorkspace.tsx:257,283–286,357,581；model.ts:3–4 | R03 分页，不无限调大常量 |
| 标签命中覆盖查询，标题/URL 与摘要/备注检索分散 | LibraryWorkspace.tsx:356–357；MaintenanceDesk.tsx 的 searchLibraryText | R03 可解释组合检索 |
| 详情堆叠预览/AI/整理/维护/编辑/标签 | LibraryWorkspace.tsx:619–664 | R05/R07 职责分区 |
| 导出/历史在 EditDesk，父组件只在 live 时挂载；Blob 点击后立刻报成功 | EditDesk.tsx:133–143,181–195；LibraryWorkspace.tsx:642 | R06 独立入口和原生落盘回执；不宣称已复现导出失败 |
| 基线仍写无配对/AI，与已存在 features/backend 不符 | .trellis/spec/project-baseline.md:3–7 | 存在性以源码为准，安全约束仍遵守 |

表内相对前端路径以 apps/desktop/src 为根。

## 旧门槛

旧 03 task.json 记载导入观察 PASS、V04 缺真实休眠。旧 04 保持 in_progress、V04 UNVERIFIED。
旧 13 evidence/receipts.md:802–838 比 task.json notes 更新：V06/V15 PASS，V04/AC13-1、V16/AC13-5 未闭合，AI 本机条目 NOT_RUN。不可引用过时 V15 FAIL 为当前结果，也不能把历史 PASS 算改版通过。

保留原树，不重挂已归档任务。原 02/06/08/09 仍分别拥有协议/写入恢复/fetch/远程窗口安全边界。R01 壳层合成测试不依赖真实同步；R02 真实接入需复核旧 03/04 相应门槛。2026-10-13 用户明确将真实休眠验收移至 R08 完成前，允许继续 R02；详见 ../gate-change-2026-10-13.md，其余门槛不变。

## 设计依据

用户拒绝原视觉；不保留绿色。Codex/Apple 参照拆为：小而一致圆角、低干扰平面分区、蓝色选择与主要动作；不是复制特定版本或仿 macOS 标题栏。当前代码与截图足以明确方向，无需额外品牌抓取。
