# 2026-10-17 本地 CI 优化与验证

本轮按用户要求直接排障，不创建 Trellis 任务。对照基线为 `076ba19d0d0388ef856837b1f4a2e541caf442eb`，环境为 Windows x64、Node 26.7.0，使用现有依赖和编译缓存；下列是本机单次对照，不是冷构建基准。

## 原因与修改

`scripts/protocol.test.mjs` 原先生成一次输出，再为五次文件比较分别重新生成。每轮生成对 44 个 schema 分别执行 `cargo run --quiet`，因此一个漂移测试启动 Cargo 264 次。同步调用捕获输出，生成过程没有状态提示，Node 测试又要等整个用例完成才报告结果。本轮原测试最终通过，耗时 267.1 秒；用户提供的中断日志没有断言失败，不能把其中的取消错误当作协议断言失败。

现在每轮生成先执行一次带 `--locked` 的 Cargo build，并从本轮 `compiler-artifact` 消息取得实际导出器路径，再直接运行该程序导出 44 个 schema。编译诊断持续显示，构建静默时提示等待，每个 schema 显示名称。漂移反例共用一次刚生成的内存基线，并保留 LF/CRLF、类型、schema、静态校验器反例，补充缺文件反例。独立 `pnpm protocol:check` 仍重新构建并生成全部输出，没有跨运行缓存，也没有更新已跟踪的生成文件。

`just ci` 由 `scripts/ci.mjs` 顺序调用原有 12 个 recipe，打印阶段编号、开始、结果和耗时。无输出时以 15 秒间隔检查并提示当前阶段仍在等待；提示不表示检查通过。首个失败立即停止并保留非零状态，信号结束也视为失败。回归测试检查本地 recipe 与 `.github/workflows/ci.yml` Windows job 的实际命令和顺序一致。

## 本轮实际结果

相同命令 `node --test --test-reporter=spec scripts/protocol.test.mjs`：修改前 267.142 秒，修改后 3.542 秒，约快 75 倍。修改后的 8 项测试全部通过，包括新增的子用例。

完整 `just ci` 退出 0，12 阶段总耗时 449.1 秒；这是完整 CI 的耗时，不是协议优化的前后比值。

| 阶段 | 结果 | 耗时 |
|---|---|---|
| install | PASS，冻结锁文件安装 | 0.4 秒 |
| lint | PASS | 4.1 秒 |
| typecheck | PASS | 6.2 秒 |
| build | PASS，Web/扩展生产资产扫描 | 2.4 秒 |
| protocol-check | PASS，全部生成内容与跟踪文件一致 | 3.3 秒 |
| test | PASS，272 Vitest、35 Node 测试 | 21.0 秒 |
| fmt | PASS | 1.3 秒 |
| clippy | PASS | 82.6 秒 |
| test-rust | PASS，原有显式 ignored 项保留 | 93.8 秒 |
| build-native | PASS，Windows release 构建与实际产物扫描 | 139.2 秒 |
| playwright-install | PASS | 0.9 秒 |
| test-e2e | PASS，207 项浏览器测试 | 94.0 秒 |

原生产物为 25,627,648 字节，SHA256 为 `0245f42f1b8356b1561e00c187413b903bc3a81526c6e8881599784df0232f81`。这是本地构建扫描与浏览器自动检查结果，不代表托管 CI、原生交互或真实模型验收；原 13/V12、15/V18 门槛不变。
