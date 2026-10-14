# 独立 diff 检查方法修正

复核者尝试 `git -c core.autocrlf=false diff --check` 来抑制既有 LF/CRLF 提示。该调用禁用本次读取的换行规范化，把既有 CRLF 的 CR 当作 trailing whitespace，产生大量无关反例；该输出不作为产品源码失败或修改理由。没有写入 Git 配置、改动源码或转换换行。

随后恢复仓库正常配置执行 `git diff --check`，实际退出 0，输出保存在 [正常检查日志](current-independent-diff-check.log)。保留这次失败的检查方法，避免把工具视图变化当作产品回归。
