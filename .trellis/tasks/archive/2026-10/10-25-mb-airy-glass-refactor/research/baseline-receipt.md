# 当前基线尝试

基线2ac7979，未改产品代码。计划选择5项：浅/深14px 1440×900及浅20px 640×480工作区布局、两主题对比度。

命令：MARKBRIDGE_EVIDENCE_DIR指向本任务research/baseline，然后运行：

```powershell
pnpm exec playwright test tests/e2e/workspace-layout.spec.ts tests/e2e/appearance.spec.ts --grep 'C03 workspace (light|dark) 14 1440x900|C03 workspace light 20 640x480|C02 (light|dark) contrast uses rendered semantic colors' --workers=1 --reporter=json
```

退出1，测试启动前失败，Node v26.7.0：

```text
Error: Cannot find module 'D:\Documents\Code\Tauri\Markbridge\node_modules\@playwright\test\cli.js'
code: 'MODULE_NOT_FOUND'
```

只读检查：node_modules/@playwright/test是pnpm符号链接，.pnpm存在版本目录；未确定是文件缺失还是环境链接解析限制，不推测根因。未安装依赖或修复链接。

当前截图/视觉基线NOT_RUN，无有效测试报告；新样式、性能、原生/DPI均NOT_RUN。实施前补基线，归档C04只参考方法。
