# 规划与原型验证

## 范围

本次交付父子任务规划与独立 HTML 设计原型。产品源码、真实 Chrome、SQLite、已安装扩展均未修改；原有两个 scripts 文件的用户修改保留。全部新任务 status=planning、planning_status=ready_for_review、implementation_approval=pending，未执行 task.py start。

## 规划检查：PASS

- 1 个父任务和 8 个子任务，双向关系一致；R05 创建时一次原子写入失败导致单边关系，已用 task.py add-subtask 修复并重新验证。
- 每项都有 prd.md、design.md、implement.md、implement.jsonl、check.jsonl；子任务另有 evidence/receipts.md。
- 对 9 项逐个运行 `python .trellis/scripts/task.py validate <task>`，均退出 0。
- 额外结构检查验证依赖无环、U01–U10 全覆盖、所有 JSONL 路径存在、34 个 Markdown 本地链接有效、无 TBD/TODO 模板占位。机器结果：[planning-report.json](planning-report.json)。
- 旧 task.json notes 与最新验收收据的差异记录在审计中，没有把历史 PASS 或过时 FAIL 当改版验收。
- 需求收敛复核：用户目标、范围、非目标、验收、风格与优先级明确；无待用户选择的产品分歧。剩余产品实施批准为阶段门槛。

## 原型渲染：PASS（仅设计）

运行 `node .trellis/tasks/archive/2026-10/10-12-mb-workspace-redesign/design/render-prototype.mjs`，退出 0。

使用项目现有 Playwright 的隔离 headless Chromium，未打开日常 Profile。14 张截图包括五种工作台尺寸、选择、设置及最小设置、历史、整理、首次接入及最小接入、只读、最小详情。程序验证全部无整页横/纵向溢出；页面内列表/详情/设置可独立滚动。浏览器版本与像素几何见 [render-report.json](design/render-report.json)。

交互断言：搜索过滤；多选数量与移动审查/取消；设置分组与 AI 关闭；小窗详情替换主内容并返回。JS 页面异常 0；HTTP/HTTPS 请求 0。原型从未连接应用后端；弹窗和按钮只演示，不保存、发请求或写 Chrome。

视觉复查已覆盖这些布局和状态。修正：小窗导航图标误隐藏、底部导航位置、未接入场景保留示例目录的误导、低对比度辅助文字；书签行统一到 52px。最终方案是蓝色选中态、浅灰导航、白色主区，保留 Windows 中英混排字体。无渐变、玻璃卡片、装饰背景和高频动画。

渲染几何：宽窗导航 216px、详情 312px；640px 窗口导航 64px，主区 576px；小窗详情替换列表。用户原截图只作为诊断证据，本轮没有重新运行旧应用测量前后几何，因此不声明实际应用对齐缺陷已经修复。

## 尚未验证

| 项目 | 状态 | 说明 |
|---|---|---|
| 新版产品功能/单元/e2e | NOT_RUN | 还没有进行产品实施 |
| Tauri/WebView2/真实Chrome | NOT_RUN | 原型浏览器不能代替原生 |
| Windows缩放/真实系统字体/读屏 | NOT_RUN | 由R01/R08原生验收 |
| B10K性能/真实批量恢复 | NOT_RUN | 由R03/R04/R08执行 |
| 旧V04休眠恢复、V16外部同步 | UNVERIFIED | 沿用已核查旧证据状态，本轮未复测 |

原型不是完整功能模拟：分页、Shift范围选择、真实配对/导出/撤销、任意保存及错误恢复仍是子任务实现内容。示例书签、摘要、连接与历史记录均为合成展示数据；产品接入时使用已验证DTO替换，不复用示例状态判断。

## 本地评审

[交互原型](design/workspace-prototype.html) 可直接在浏览器打开。当前会话另提供只绑定127.0.0.1:43183的本地预览，目录限定为本任务design；无真实书签资料。

视觉规范命名为 visual-design.md，因为 Windows 文件系统不允许 DESIGN.md 与技术设计 design.md 并存。九段视觉规范内容完整保留。
