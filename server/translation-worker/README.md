# 首轮私人翻译代理

状态：本地实现及 Wrangler dry-run、本地 D1 migration/binding 检查完成，**2026-11-07 已创建远端 D1、apply schema 并初步部署 Worker；三项凭证绑定均已为 Secret、本人 token 已上传；2026-11-08 原凭证复测已运行，中文用例上游失败后恢复空 guard，生产 100% 已独立核验（见 [复测证据](../../docs/evidence/translation-live-configuration-audit.md#2026-11-08-原凭证复测结果)）**。用户报告已创建 Translator F0 `ba-lar`、区域 `eastasia`，并已明确确认该资源只供本项目使用；这些信息未通过 Azure API 核验，实际免费条件仍待确认。Cloudflare CLI 已登录，截图支持 Workers Free 特征；未升级付费。直接结果及部署 URL/版本见 [连接记录](../../docs/evidence/translation-cloudflare-connection.md)。只供本人首轮验证，不代表小范围分发能力已验收。Android 的完整地址应为 `https://<worker-host>/translate`。

## 合同与边界

`POST /translate`，`Content-Type: application/json`，`Authorization: Bearer <本人访问凭证>`；正文 `{"text":"中文与 English","requestId":"UUID"}`。成功返回同一个 `requestId` 和纯文本 `translation`。失败返回 `error.code` / 安全短文案；不透传上游原始错误，不记录原文、译文或凭证，不自动重试。纯英文原样返回且不调用 Azure；其他语种字母不作为英文处理。

单篇上限为 **10,000 Unicode 码点**，空白、标点、emoji 都参与计数。后端再校验；这与 APK 现有 TXT 导入安全上限、Azure 计费字符口径是不同限制。英文保护使用整段 HTML 与 `notranslate`，严格校验片段、大小写、拼写和标记后才返回；未知 HTML、变更／丢失／重复保护标记返回 `PRESERVATION_FAILED`，不得当成功显示。

极端中英逐字交替会导致 HTML 包装超出 Azure 50,000 字符单请求安全界，返回 **`PROTECTION_LIMIT`**，不谎称原文超过 10,000 字符、不截断或建议拆短。后续如需支持这一情况，应另行设计内部请求分批与整篇一致性；本轮未做。普通自然语言输出质量、真实 Azure HTML 返回兼容及 Workers Free 10 ms CPU 均须部署后验证。

错误码：`INVALID_REQUEST`、`TEXT_TOO_LONG`、`UNAUTHORIZED`、`RATE_LIMITED`、`QUOTA_EXCEEDED`、`SERVICE_UNAVAILABLE`、`UPSTREAM_TIMEOUT`、`UPSTREAM_ERROR`、`PRESERVATION_FAILED`、`PROTECTION_LIMIT`。

上游请求使用 Workers 支持的 `redirect: "manual"`，收到任何 300–399 状态均在解析正文前拒绝，不读取 Location、不跟随或重试。Node 支持的 `redirect: "error"` 在当前固定 workerd 中无法构造请求；本地传输回归专门覆盖这一运行时差异。此修复需要 deploy 才生效，实际部署状态以审计证据为准。

临时上游诊断默认关闭：仅在 `SAFE_UPSTREAM_DIAGNOSTICS="SAFE_ENUMS_V1"` 且已鉴权请求发生上游错误时，附加 `error.diagnostic={stage,httpStatus,azureCode}`。阶段仅为 `transport`、`response_decode`、`http`、`response_shape`；状态与 Azure 错误码仅从代码中的明确白名单返回固定字符串，未知为 `OTHER`。不返回原始正文、message、headers 或异常，不新增 endpoint 或日志，不改变现有错误码/HTTP 合同。分类只描述观察阶段，不能独自证明 Azure 收到请求、计费或密钥无效。此函数改动需 deploy，当前线上是否生效以执行证据为准；不涉及 schema/apply。

## 免费预算与数据库对象

新增 D1 表 **`translation_budget`**（migration `0001_translation_budget.sql`），只保存 UTC 月份、累计预留字符、分钟窗口及请求计数，不保存内容或凭证。Worker 的 `POST /translate` 是新增服务端函数。D1 已远端 apply，Worker 已初步 deploy；二者对象语义未变。当前已上传本人 token，原凭证复测上游失败后恢复空 F0 guard，服务拒绝外发；失败结果及待办见私人启用审计。

首轮只有一个本人凭证，因此同一行的条件 `UPDATE` 原子检查并预留总预算和每分钟请求数；仅 `meta.changes === 1` 才允许外发。窗口不允许倒退。失败的条件更新不放行；D1 不可用、缺配置、未明确确认 F0 时拒绝服务。上游超时或失败也不退回预留字符，避免不确定结果导致超发。

默认每 UTC 月 **1,000,000** 个上游 HTML payload UTF-16 单元、每分钟 **6** 次。这是保守运营默认值，不是服务免费承诺或新的产品决定；配置只允许降低，最高仍为这两个值。字符预留计入 HTML 标记和转义后的实际发送内容，并以 UTF-16 单元作为保守界；不直接以产品码点数冒充计费用量。务必使用专用 F0 资源，否则其他客户端可绕过本代理预算。后台额度应与 Azure 实际用量核对，月窗口采用 UTC 日历月，Azure 实际重置边界仍需账户内确认。

本人访问凭证使用至少 32 位随机 base64url 字符，运行时录入 APK，Worker secret 保存。只需轮换 `ACCESS_TOKEN` 即可撤销旧凭证；该凭证不是 Azure 服务密钥。本轮没有多用户账户／个人配额管理，分享前必须补齐多凭证授权、撤销与个人用量限制，不能直接把本人凭证发给所有人。

## 本地检查

Node 24+；基础单测不依赖 Wrangler：

```powershell
node --test test/*.test.mjs
```

测试用自编材料和假上游；预算并发测试在独立 worker threads / SQLite 连接上执行同一条真实 SQL。它证明本地 SQLite 条件预留行为，**不代替真实 D1 binding、Azure 翻译、免费资源配置或手机网络验证**。

本目录固定开发依赖 Wrangler **4.158.0**，以 `pnpm-lock.yaml` 锁定；运行 `pnpm install --frozen-lockfile --store-dir .wrangler/pnpm-store`。`pnpm-workspace.yaml` 只允许工具依赖 esbuild/workerd 的安装构建；其中精确版本例外与锁中的 Miniflare `5.20261104.0-beta` 来自该 Wrangler 的官方传递依赖，不表示线上兼容性已验证。没有全局升级。

以下均在本目录执行，不需要 Cloudflare 账户或真实 secret：

```powershell
$env:XDG_CONFIG_HOME = Join-Path $PWD '.wrangler/local-config'
$env:WRANGLER_LOG_PATH = Join-Path $PWD '.wrangler/logs'
$env:WRANGLER_SEND_METRICS = 'false'
node node_modules/wrangler/bin/wrangler.js --version
node node_modules/wrangler/bin/wrangler.js --help
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir .wrangler/dry-run
node node_modules/wrangler/bin/wrangler.js d1 migrations apply bilingual-auditor-translation-budget --local --persist-to .wrangler/migration-check
node tools/verify-local-d1.mjs
node tools/verify-local-transport.mjs
```

dry-run 只打包，不部署；`--local` 只应用本地 schema，本地检查不证明远端生效；生产 `database_id` 已在 2026-11-07 创建后替换为实际 ID。绑定检查使用 Wrangler 锁定的 Miniflare/workerd D1 与生产 `createWorker`，只注入假上游和合成混合句，验证实际预留、额度/速率拒绝与缺 binding/表时拒绝外发；真实 Azure 调用为零。handler 仍在 Node 执行，此检查不证明完整 Worker 在远端运行或 CPU 限额通过。受限环境可能阻止 workerd 本地回环，须获得本地进程权限；不能把 `fetch failed` 算通过。局部配置目录避免 Wrangler 默认全局日志路径权限错误；不要在此临时目录进行账户登录。实际结果见 [本地证据](../../docs/evidence/translation-local-validation-2026-11-06.md)。

`verify-local-transport.mjs` 另在固定 Miniflare/workerd 内执行生产 handler 的默认 `fetch` 路径，验证真实 Request 构造、假上游 200，以及 300/301/302/303/307/308/399 均拒绝且重定向目标请求数为零。所有 outbound 请求由本地函数接管，外部网络及真实 Azure 调用为零；预算在此工具中使用合成替身，不代替单独的 D1/SQLite 检查，也不证明真实密钥、Azure 可达性或译文质量。

## 账户与部署操作步骤（当前进度见开头及连接记录）

1. 在 Azure 账户确认专用 Translator **Free F0** 和可用区域；确认订阅续存／免费条件，不选择 S1、自动升级或按量付费路线。先核清文本保存／备份及未来分发适用条款。学生身份可走 [Azure for Students](https://azure.microsoft.com/en-us/free/students/)，仍以账户实际资格为准。
2. 先在 [Cloudflare 官方注册页](https://dash.cloudflare.com/sign-up) 创建账户并验证邮箱，保持 **Workers Free**；不选择付费升级。本轮已完成 Wrangler 登录及 D1 创建/apply；重建环境时先单独登录 Wrangler，创建 D1：`node node_modules/wrangler/bin/wrangler.js d1 create bilingual-auditor-translation-budget`。把返回的数据库 ID 填入 `wrangler.toml`（不是 secret；本轮已填写实际 ID）。下列 `wrangler` 命令均使用本目录固定版本（`node node_modules/wrangler/bin/wrangler.js`），不依赖全局安装。
3. 本地先检查：`wrangler d1 migrations apply bilingual-auditor-translation-budget --local`。正式创建表需执行 `wrangler d1 migrations apply bilingual-auditor-translation-budget --remote`；这是实际远端写入，须在本轮部署范围明确且账户条件通过后执行。
4. 分别交互录入 `wrangler secret put AZURE_TRANSLATOR_KEY`、`wrangler secret put AZURE_TRANSLATOR_REGION`、`wrangler secret put ACCESS_TOKEN`。不要把值写进命令、聊天、Git、日志或截图；`.dev.vars*` / `.env*` 被局部忽略。这里不提供通用口令。
5. 初步部署阶段先以空 guard、无真实 secret 保持拒绝外发；后续首次启用及失败恢复见上方审计。核对专用 F0 并完成 secret 配置后，把 `AZURE_TIER_CONFIRMED` 设为 `F0`，保留／降低两个预算默认值。检查 observability 未启用正文日志、没有其他产品自动收费。执行 `wrangler deploy` 才会使函数代码生效；不因存在配置文件就宣称已部署。
6. APK 运行时录入完整 HTTPS `/translate` 地址和本人访问凭证。只用合成文本验证中文、混合英文／URL／缩写／原有错拼、10k 边界、配额／限流／超时、手机网络；不要通过真实耗尽额度测试错误处理。观测 D1 计数与 Azure 用量，核实 HTML 保护解析兼容和 CPU 限额。

本实现固定调用 Azure 官方公有云 Text Translation endpoint；其他云／私有 endpoint 不接受自由配置，避免凭证被转发到任意地址。不支持用户选一个网页翻译地址替代 API。

## 本机私人首轮启用工具

`tools/enable-private-trial.ps1` 是 Windows PowerShell 7 的一次性启用工具，执行前须完成本轮代码审查 Gate；工具存在不表示已执行或线上已启用。无远端、无真实 token 的自测：`pwsh -NoProfile -File tools/enable-private-trial.ps1 -SelfTest`。正式入口是 `pwsh -NoProfile -STA -File tools/enable-private-trial.ps1`（从本目录执行）；自动化启动须隐藏控制台窗口，但保留供本人交互的配置窗口，不截图。

工具固定账户/Worker，先核当前生产 100% 版本及 Azure 两项 `secret_text`，发现已有 `ACCESS_TOKEN` 则停止，避免意外轮换。随后在单个进程内加密随机生成本人 token，仅由标准输入传给固定官方 Wrangler；CLI 输出只在内存捕获，关闭 Wrangler 磁盘日志和 metrics，不读取 Azure key。上传 token、启用 F0 guard 的部署分别记录版本；保留 D1、1M/6 预算和关闭的 observability，不更改业务代码或 schema。最多四次真实 Azure 合成请求，无自动重试；首次失败即停止并尝试把 guard 恢复为空后部署，输出安全状态与恢复版本，不输出原始错误。恢复未确认时必须人工检查。

已有本人 token 时，仅在本轮授权与代码审查 Gate 通过后，使用显式复用入口（从本目录执行）：

```powershell
pwsh -NoProfile -STA -File tools/enable-private-trial.ps1 -ReuseExistingToken
```

复用模式要求三项凭证均为 `secret_text`，完全跳过随机生成和 Secret 上传。先部署 F0 guard，确认当前生产单版承接 100% 流量；无鉴权合成请求必须返回 401/`UNAUTHORIZED`，之后才打开本机掩码输入窗，由本人输入此前保存的凭证。窗口不提供显示/复制凭证操作，不读取剪贴板；取消、关闭、五分钟超时或格式错误均停止并恢复空 guard。输入只留在进程内存，不放入命令参数、环境变量、日志或文件，也不再打开原生成/复制凭证窗。随后验证原有超长 422、纯英文逐字保留和最多四个 Azure 合成样本，无重试；任何失败均停止，恢复部署后确认生产 100% 版本、三项 Secret 类型及空 guard，无法确认则输出人工核对状态。只有全部通过才保持启用。此流程用于有限复测，不把先前区域空格修正视作根因已完全锁定。

`-SelfTest` 同时以无远端、无真实凭证的 stub 验证复用路径不生成/上传、401 失败不询问凭证且零 Azure、输入取消与各样本失败后关闭确认，以及四次上限和首错停止；自测不代表在线验证完成。

### 已批准的单次安全诊断

离线自检可运行 `pwsh -NoProfile -STA -File tools/enable-private-trial.ps1 -SelfTest -ReuseExistingToken -DiagnosticOnce`。真实单次入口为：

```powershell
pwsh -NoProfile -STA -File tools/enable-private-trial.ps1 -ReuseExistingToken -DiagnosticOnce
```

`-DiagnosticOnce` 必须同时指定复用模式，否则在 GUI/远端操作前拒绝。它不生成或上传凭证；临时部署 F0 与诊断 flag，核对生产单版 100%、三项 Secret 类型和启用 flag，先验证无鉴权 401 后才开启原凭证掩码输入。随后只运行一个既有短中文样本，不运行其他翻译样本、不重试，诊断输出再次按固定白名单筛选。成功、失败、输入取消/超时或启用 deploy 异常均进入关闭流程；恢复空 F0 与空诊断 flag 后 deploy，并核生产 100%、Secret 类型和两个关闭值，无法确认则报人工核对。此模式不保留启用态；普通四样本模式原有行为不变。

离线 stub 另覆盖单次上限、拒绝非复用组合、401 先于输入、成功/失败/取消/启用失败后关闭与诊断投影拒绝恶意字段。它不等于一次真实诊断已执行；线上结果只记入私人启用审计。

本人凭证只在本机配置窗口显示（默认掩码）；用户主动点击复制才修改剪贴板，不预先覆盖现有内容。关闭前须自行转存到密码管理器，工具不持久保存 token；界面不可用时安全失败，不打印或写文件兜底。即使上传后的验证失败，工具也会尝试显示该窗口以便本人保管已尝试上传的凭证；这不代表部署成功。不要启用 PowerShell 调试/跟踪/转录，也不要把窗口截图交给 agent。2026-11-07 首次正式执行结果见 [私人启用审计](../../docs/evidence/translation-live-configuration-audit.md)：已上传 token，启用验证失败后恢复空 guard，当前已有 token，禁止原样重跑覆盖；用户已确认保存凭证并关闭私窗。2026-11-08 复用流程已在线运行并 exit 1，各用例结果及关闭确认见同页 [原凭证复测结果](../../docs/evidence/translation-live-configuration-audit.md#2026-11-08-原凭证复测结果)。

## 慢授权页的本机十分钟等待工具

`tools/login-with-long-wait.mjs` 是经用户批准的临时本机适配，不是 Wrangler 官方参数。先运行 `node tools/login-with-long-wait.mjs --self-test`；独立评审 Gate 通过后，显式运行 `node tools/login-with-long-wait.mjs --login` 才会打开官方授权页。无参数或组合参数均拒绝，不自动开始授权。

工具只接受固定 Wrangler 4.158.0，在其本地安装目录创建独立临时 CLI 副本；完整上下文唯一匹配后，仅将等待授权码的 120 秒改为 600 秒，其余源码字节保持相同。原安装文件不写入，开始和结束核对 SHA-256；成功或失败后清理本次创建的副本。离线自检运行副本的 `--version`，并验证异常清理；不发起授权或翻译请求。强行终止整个进程可能留下仅含程序代码的副本，不能由此推断授权结果。

正式授权仍使用原账户、原 scopes、`localhost:8976` 回调、state/PKCE 校验及官方 token 交换；只延长本机等待，不改变 Cloudflare 服务端有效期或独立的交换超时。日志与 metrics 关闭，代理仅为当前进程的 `127.0.0.1:7897`。此工具不读取登录 profile、Azure 密钥或个人访问凭证，不部署 Worker、不启用翻译开关；成功后仍需安全核验 CLI 登录和生产状态。

## 官方依据（2026-11-06）

- [Translator F0 定价](https://azure.microsoft.com/en-us/pricing/details/translator/)：每月 200 万免费字符，F0 与 S1 区分。
- [Translator 请求与吞吐限制](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)：单请求 50,000 字符；小时吞吐不是每小时重置免费额度。
- [英文保护标记](https://learn.microsoft.com/en-gb/azure/ai-services/translator/text-translation/how-to/prevent-translation)、[字符计数 FAQ](https://learn.microsoft.com/en-us/azure/ai-services/translator/faq)、[状态码](https://learn.microsoft.com/en-gb/azure/ai-services/translator/text-translation/reference/status-response-codes)。
- [Workers Free 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 额度](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 prepared statements / changes](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)、[D1 SQLite 兼容](https://developers.cloudflare.com/d1/sql-api/sql-statements/)。
- [SQLite UPDATE](https://www.sqlite.org/lang_update.html)、[SQLite 自动事务及单写入者](https://www.sqlite.org/lang_transaction.html)。
- [Wrangler 安装](https://developers.cloudflare.com/workers/wrangler/install-and-update/)、[Wrangler 命令与 dry-run](https://developers.cloudflare.com/workers/wrangler/commands/)、[D1 入门与本地 migration](https://developers.cloudflare.com/d1/get-started/)。

上述来源只支持各自公开条件，不能替代账户控制台、实际部署、许可核查或真机验收证据。
