# 首轮翻译本地验证记录

日期：2026-11-06。来源：Leader 实际执行的命令输出、JUnit/Lint XML 和 APK 属性；本页记录本地自动检查，不是部署、真实翻译、手机或人工验收证明。代码仍未绑定 Git 提交，APK 指纹用于区分本轮产物。

## 环境与命令

Windows、BellSoft JDK 21.0.6、Gradle 8.10.2、Android SDK 35。显式设置 `ANDROID_HOME=C:\Users\a1234\AppData\Local\Android\Sdk`；受限进程的 LOCALAPPDATA 被重定向。初始受限环境的 Gradle 版本检查遇到锁文件/原生 DLL 权限失败，经允许使用本机缓存后正常，不计作源码编译失败。

```powershell
$env:ANDROID_HOME = 'C:\Users\a1234\AppData\Local\Android\Sdk'
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --console=plain --no-daemon --max-workers=2
```

退出码 0，`BUILD SUCCESSFUL`，耗时约 1 分 11 秒。Leader 独立读取报告：

- JUnit 21 项：ReaderViewModel 9、TranslationPolicy 5、TxtReader 7；失败/错误/跳过均为 0。
- Lint 0 错误、5 警告：DataExtractionRules 1、GradleDependency 4。
- 测试覆盖码点边界/emoji、纯英文免请求、超限告警、请求失效和错误保留；不等于真实网络客户端或 UI 事件完整通过。

在 `server/translation-worker` 运行：

```powershell
node --test test/*.test.mjs
```

Node v24.22.1，退出码 0，14/14 通过。使用自编文本和假 Azure 响应；预算并发由 12 个独立 worker threads/SQLite 连接执行实际条件更新，覆盖额度与速率竞争、时间窗不倒退、存储失败不外发、保护标记校验及注入超时。该证据不替代 Cloudflare D1 binding 或远端并发验证。

## 产物与部署对象

- [debug APK](../../app/build/outputs/apk/debug/app-debug.apk)：8,873,285 字节。
- SHA-256：`56B95BA244FC91065878B8CE5F2A164BF52DD53A27648E24754E6005E18444F9`。
- 新增 Worker `bilingual-auditor-translation` 的 `POST /translate`：鉴权、业务校验与持久预算预留后代理 Azure。需 deploy；当前无远端生效证据。
- D1 数据库名 `bilingual-auditor-translation-budget`；migration `0001_translation_budget.sql` 新建表 `translation_budget`。只保存月份、预留字符及分钟请求计数，不含原文、译文或 secret。需创建数据库并 apply；当前未执行远端操作。

## 仍待验证

账户学生资格/F0 实际可用、Workers Free 配置、远端 D1、secret 配置与 deploy、专用资源和预算重置口径、真实 Azure HTML 保护兼容与译文质量、Workers CPU、本人网络与手机交互、人工验收和发布均未成立。本地 Wrangler/D1 补充结果见下节。

极端中英逐字交替可使保护 HTML 包装超过上游单请求安全界；当前明确返回 `PROTECTION_LIMIT` 并保留原文，不误报业务长度超限、不自动截断。后续内部批处理需另行设计整篇一致性。

## 2026-11-06 补充：部署工具与本地 D1

来源：generator 在本机实际运行的命令输出；仅本地工具证据。用户报告已创建 Translator F0 `ba-lar`、区域 `eastasia`，未经 API 核验；Cloudflare 尚待注册。未读取或写入真实凭证，未请求 Azure。

- 本机 Node v24.22.1，固定安装开发依赖 Wrangler 4.158.0 并生成 pnpm lock。首次 pnpm add 下载成功但退出 1：pnpm 默认阻止 esbuild/workerd 安装构建；随后只允许这两个工具依赖并 `pnpm rebuild esbuild workerd --store-dir .wrangler/pnpm-store`，退出 0。Miniflare `5.20261104.0-beta` 为该 Wrangler 的传递依赖，非独立选择的线上组件。
- `pnpm install --frozen-lockfile --store-dir .wrangler/pnpm-store` 在允许联网的工具环境退出 0，锁定 91 项供应链检查通过、无需重新解析；受限环境的额外 offline 检查因元数据缓存不在同一目录而失败（`ERR_PNPM_NO_OFFLINE_META`），不作为锁文件问题或通过证据。基础 `node --test test/*.test.mjs` 重新运行退出 0，14/14，无跳过。
- 初次 `--version` 虽打印 4.158.0/退出 0，但默认全局日志目录遭 EPERM，不能记为完全正常；初次本地 migration 在受限环境中 `fetch failed`/退出 1，未算通过。将 XDG_CONFIG_HOME、WRANGLER_LOG_PATH 指向本项目 `.wrangler`，禁用工具 metrics 后，version/help 正常；dry-run 退出 0。执行命令见 [代理 README](../../server/translation-worker/README.md#本地检查)。
- `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir .wrangler/dry-run`：退出 0，13.74 KiB / gzip 4.77 KiB，输出 `--dry-run: exiting now.`；并非部署。
- `node node_modules/wrangler/bin/wrangler.js d1 migrations apply bilingual-auditor-translation-budget --local --persist-to .wrangler/migration-check`：获得本地 workerd 回环进程权限后退出 0，`0001_translation_budget.sql` 成功，本地执行 2 条命令。生产 `database_id` 占位保持原样，无远端创建/apply。
- `node tools/verify-local-d1.mjs`：退出 0；使用 Wrangler 锁定 Miniflare 的真实 workerd D1 binding 执行 schema、生产预算 SQL 与 `createWorker`。合成混合句获得预留后调用假上游一次；月预算不足、分钟限制、缺 DB binding、删除真实本地表后均拒绝，假上游调用总数仍为 1；真实 Azure 调用为 0。handler 在 Node 中执行，不证明远端完整 Worker、CPU 或真实 Azure 兼容；本入口不包含远端 D1 并发测试。初版入口遇到 Miniflare 5 constructor 格式错误，使用该版本导出的兼容转换函数修正后才成功。

本轮无生产 schema/函数语义变更；既有 `translation_budget` migration 仅应用至隔离本地数据库。Worker 仍须 deploy、远端 D1 仍须创建并 apply 后才生效；目前均未执行。

Leader 独立复核：同样的局部目录环境下 dry-run 退出 0，体积一致；D1 binding 检查在受限环境因 `EACCES 127.0.0.1` 失败，允许本地回环后退出 0；`wrangler d1 execute bilingual-auditor-translation-budget --local --persist-to .wrangler/migration-check --command "PRAGMA table_info(translation_budget)"` 退出 0，核实 `month TEXT` 主键及 `characters/minute/requests INTEGER` 列。仍没有远端或 Azure 验证结论。
