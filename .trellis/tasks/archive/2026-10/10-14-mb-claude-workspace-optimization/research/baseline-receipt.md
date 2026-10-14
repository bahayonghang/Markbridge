# 研究浏览器基线收据（未取得有效运行结果）

日期2026-10-14，源码1000103，生产文件未改。目的仅为观察当前通用设置与主库，不能验收拟议新能力。

| 尝试 | 命令/配置 | 观察 | 结论 |
|---|---|---|---|
| A | pnpm exec playwright test appearance/shell，筛选四个现有场景，workers=1 | 无有效测试结果；终止后RTK报parser无法解析，退出1；提示的tee文件在可读路径未找到 | UNVERIFIED，非产品测试失败结论 |
| B | node node_modules/@playwright/test/cli.js + task内baseline.config.mjs | Vite路径误指仓库根node_modules，MODULE_NOT_FOUND，exit1 | FAIL（研究配置错误），已改为desktop本地依赖路径 |
| C | 修正配置后重跑同四场景 | 仅观察到Vite子进程98764的NO_COLOR/FORCE_COLOR警告，未取得用例结果或截图；停止会话，exit1；随后查询该已知进程无返回 | UNVERIFIED，未建立运行页结论 |

筛选：S03 appearance light standard 1440x900、dark standard 1440x900、light large 640x480，以及R01 shell and settings 1440x900。

本次保留用户截图与源码分析。未把旧S03通过结果挪作新基线。C01实施前必须补可用同场景基线；新的主题、真实字体服务、DPI和重启均NOT_RUN。研究配置只用于观察，不更改正式playwright.config.ts、pnpm版本或产品启动脚本。

