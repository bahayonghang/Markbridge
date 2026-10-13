# 05 独立检查

日期：2026-10-11。HEAD：`7efbca317bcce0d2c2e178c6c5b27dc32c2bc8c3`。工作树未提交。没有提交、推送或归档。没有修改父任务目录、其他任务目录、`.gitignore`、`AGENTS.md`、`.trellis/spec` 或 `.trellis/workspace`。没有改 03 的证据 PNG。没有改 `AppliedDPI`。

## 证据核对

`evidence/profile-search.json` 与脚本百分位函数一致。冷启动 659、646、675 ms。后 29 次暖态 p50 4.2000000001862645 ms，p95 5.2000000001862645 ms，max 5.7000000001862645 ms。`cacheNodes` 11004。`AppliedDPI` 前后都是 120。`Markbridge.Pairing` 前后都是 0，`Markbridge.Task05` 前后都是 1。

已加载资料搜索在输入当次过滤深度 0 的同步缓存。`library.test.tsx` 的 `shows a synced cache bookmark outside the open folder on the input turn` 把节点放在文件夹 `2`，打开的文件夹不是它的父级；输入当次出现选项，此时还没有调用 `cache_search`。

## 可见性谓词

原先的 `textContent.includes(needle)` 仍有歧义。当前 B10K 没有 `https://example.com/item/60`（索引 60 是重复网址）。`https://example.com/item/6` 仍会命中 `item/61` 等 999 行。样本过滤把针选在 `item/1001` 到 `item/1083`，这 75 个网址的行文本没有互相包含，但谓词本身仍是子串。

`profile-live.mjs` 改为只在 `.library-title` 或 `.library-url` 与针全文相等时算可见。短网址不能让另一行通过。子串结果 `503a3fe1-527e-4e17-9de1-6ee3fecb681d` 不作为 AC05-3 / V03 的证据。谓词改完后重跑了同一脚本。

新运行 `cf9c03cf-e252-439c-b524-bdd281d42c52`，进程退出码 0，`status` PASS。100 条样本，25 创建、25 修改、25 移动、25 删除，没有超时。p50 62 ms，p95 245 ms，max 246 ms。分类：创建 p50 218 / p95 246 / max 246；修改 243 / 245 / 245；移动 31 / 60 / 61；删除 30 / 62 / 62。树相等，11004 对 11004。`AppliedDPI` 前后 120。`Markbridge.Pairing` 前后 0，`Markbridge.Task05` 前后 1。`revoked` true。Chrome/155.0.8059.39。监听端口 3186。

AC05-3 与 V03 仍是 PASS，依据是这次精确相等运行。150% DPI 仍是 UNVERIFIED。

## sync.rs

成功路径仍是先核对父级和位置，再移除、移位、写回。冲突在移除前返回 `Conflict`。调用方在 `apply_event` 返回错误时丢掉这份克隆，已提交缓存不变。移除分支只改了借用写法，条件相同。`cargo fmt` 只把这个 `if` 拆成两行。

## 命令

| 命令 | 退出码 | 状态 |
| --- | --- | --- |
| 第一次 `cargo fmt --all -- --check` | 1 | FAIL。`sync.rs` 的 `if` 换行 |
| `cargo fmt --all` | 0 | 已写回上述换行 |
| 第二次 `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | PASS |
| `cargo test --workspace --locked` | 0 | PASS。43 项通过 |
| `pnpm typecheck` | 0 | PASS |
| `pnpm protocol:check` | 0 | PASS |
| `node .trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/evidence/profile-live.mjs` | 0 | PASS。精确相等谓词，见上 |
