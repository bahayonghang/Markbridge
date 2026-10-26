# 锁定验证环境恢复

2026-10-25：关联聊天用npm恢复普通目录依赖，直接依赖版本与项目一致，但本会话审计发现16个实际安装的传递依赖版本不在pnpm锁文件内。G01与G02早期恢复环境结果保留；最终集成需在修复后的环境重测，滚动比较的旧代码也须同环境补跑。

- 从项目四份package.json合并直接依赖（跳过workspace项），对超出锁文件的版本按同major锁定候选建立npm overrides；不修改项目manifest或pnpm锁。
- 临时manifest保存为`locked-runtime-package.json`；执行`npm install --prefix runs/airy-glass-locked-runtime --ignore-scripts --no-audit --no-fund`。
- 读取pnpm锁的全部YAML文档（首段只含包管理器），把每个实际安装包的version和npm integrity与冻结resolution.integrity逐一比较。217个包均匹配，见`locked-runtime-audit.json`。未安装的其他平台optional记录不当成当前运行包。
- 运行环境保持普通目录，禁止为恢复验证修复系统或managed target链接。切换根node_modules时先等待现有测试结束，将恢复环境目录完整移动保存到runs，再把锁定目录移动至根，补复制workspace协议包；只使用显式CLI入口，避免pnpm自动修复链接。
- Rust使用1.99工具链bin和普通`CARGO_TARGET_DIR`。最终收据须区分本环境与先前恢复环境，不将早期计数冒充锁定集成结果。

安装脚本禁用，没有安装Markbridge或更改日常Chrome资料。
