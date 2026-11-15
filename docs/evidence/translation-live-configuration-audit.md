# 翻译私人启用与运行时配置审计

核对日期：2026-11-12（Asia/Shanghai）。本页保留首次私人启用、原凭证复测及诊断续接证据；在线事实来自 Leader Evidence Pack，docs generator 未重复远端查询。不保存任何凭证值，未宣称在线验收完成。

## Startup / Read Scope

- 入口与合同：`AGENTS.md`、[索引](../README.md)、[core](../workflow/team-loop-core.md)、[generator](../workflow/team-loop-roles/generator.md)、[PLANS](../PLANS.md)、[audit-first](../../workflow/audit-first.md)。
- 专题：[SECURITY](../SECURITY.md)、[当前状态](../product/current-state.md)、[active plan](../plans/active/translation-integration.md)、[Worker 说明](../../server/translation-worker/README.md)、[此前 Secret 绑定审计](translation-secret-binding-audit.md)、[短交接](../handoff/latest.md)。
- 重读 current code：[worker.mjs](../../server/translation-worker/src/worker.mjs)、[wrangler.toml](../../server/translation-worker/wrangler.toml)、[私人启用工具](../../server/translation-worker/tools/enable-private-trial.ps1)。
- Leader 提供正式执行的安全输出、只投影元数据的独立核对及 evaluator 门槛复核；生成者只读本地代码与 docs。未读取真实 secret、登录 profile、磁盘日志或私窗，GUI/截图/远端请求为零。

## Repository State Layers

`git status --short` 显示项目目录大范围 untracked，是已有/在途仓库面。本轮候选仅本页、active plan、安全/当前状态/Worker 说明/质量/短交接的阶段句；不混入 runtime code、部署配置、日志、凭证或其他在途文件，不提交 Git。

## Verified Facts

本节记录首次私人启用时的事实，后续当前结果见下方原凭证复测章节；本节“当前”均指该次历史执行时点。

1. 第一次正式工具启动被自动审批以“现有授权未明确生成凭证外发”为由拒绝，尚未执行。Leader 向用户明确说明生成本人 token、写入目标 Worker 加密 Secret、启用 F0/deploy、最多四次合成 Azure 请求、仅本机私窗展示的具体动作；用户回复“明确授权上述操作”后，同一路径重提获批。Azure key 未经聊天、日志或项目文件读取/上传。
2. 工具 PowerShell parser 检查和无远端、无真实 token 的 SelfTest 均 exit 0，fresh evaluator 预审无 P0/P1。这些工具检查不证明在线配置可用。
3. 正式执行 precheck 版本为 `946134f5…`、`SECRET_TYPES=OK`；随后已生成本人 token 并写入 `ACCESS_TOKEN` Secret，上传后版本为 `107fa1ea-7685-4215-93d3-890ee33affc7`。F0 guard 启用 deploy 版本为 `e35a4625-59af-4728-be6e-5b6736ede402`。
4. 首个 `unauthorized` 合成请求预期 401/`UNAUTHORIZED`，实际为 **503/`SERVICE_UNAVAILABLE`**。工具立即停止；`too_long`、`english` 及四个真实 Azure 样本均未执行，**真实 Azure 调用为零**。没有中文或混合文本翻译成功证据。
5. 失败后已自动恢复空 guard 并 deploy，版本为 `31d5f48b-b99d-464c-b174-7bcd8d23b029`。本地配置仍为空 guard、1,000,000/月、6/分钟、observability=false，D1 绑定未变。此轮没有 schema/migration/apply；服务端函数业务语义未修改。实际远端写入为 token Secret 与启用/恢复 guard 的 deploy，Leader 随后独立以 deployments status 元数据确认恢复版承接当前生产 100% 流量。
6. Leader 独立核对启用版与恢复版元数据，仅正向投影：两版 `ACCESS_TOKEN`、`AZURE_TRANSLATOR_KEY`、`AZURE_TRANSLATOR_REGION` 均为 `secret_text`，`DB` 为 `d1`；启用版公开 guard 为 `F0`，恢复版为空，预算均为 1,000,000/6。未检查 secret 值。类型与公开配置核对不能证明 secret 的运行时内容正确。
7. 工具已输出 `PRIVATE_CONFIGURATION_WINDOW_READY`。本人 token 已存在于 Worker Secret，且仅进入工具进程内存/本人本机私窗，未写入聊天、日志或项目文件。用户随后明确回复“已保存凭证并关闭窗口”；此为用户确认，agent 未查看私窗。工具进程最终退出结果仍待取得，不宣称整个验证完成。
8. 当前 `settings(env)` 位于鉴权之前，检查 guard、DB.prepare、token 字符串及长度 32–256/base64url、KEY 非空、REGION 小写字母/数字/连字符且长 1–40、月/分钟整数及上下界。`unauthorized` 请求在预算预留之前，本次响应不能证明 D1 SQL 或 Azure 请求失败。

## Inferences

- 结合当前代码，首个无鉴权请求的 503 支持“运行时配置门槛未过”的调查方向；仍未锁定具体绑定或内容。元数据能排除已核对公开 guard/预算及绑定类型问题，不能推导 KEY 非空、REGION 内容或 token 的运行时内容。
- 不能据此断言 Azure key 无效：本次未向 Azure 发请求。工具通过 stdin 写 token 并关闭流；不能仅因没有附加换行就认定 Wrangler 上传了错误值。
- 空 guard 恢复后保持拒绝外发；恢复不撤销已上传 token，不应把当前状态说成“本人 token 尚未生成”。

## 2026-11-08 修正报告与复测准备

本节为正式复测之前的阶段记录；“未执行/调用为零”只描述当时，后续结果以下节为准。

- 用户针对 `REGION= eastasia` 明确回复“一开始可能有空格。已删除空格”。这是用户报告，已回应区域空格检查；不再将其列为完全未答，也不证明远端运行时内容或唯一根因。
- 当前 helper 新增显式 `-ReuseExistingToken`：默认入口仍拒绝已有 token；复用入口只核三项 Secret 类型，跳过生成与上传。先启用 guard 并确认生产单版 100%，无鉴权用例返回 401/`UNAUTHORIZED` 后，才由用户在本机掩码窗口输入原已保存凭证；不读剪贴板，不经 argv/env/file/log，不打开原生成/复制窗口。取消、超时、格式或用例失败均停止并恢复空 guard，再核生产 100%/Secret 类型/空 guard；最多四个 Azure 合成样本、无重试。实现与步骤见 [工具说明](../../server/translation-worker/README.md#本机私人首轮启用工具)。
- Leader 独立 parser 检查为零错误、无远端/无真实凭证 SelfTest exit 0；fresh evaluator 预审无 P0/P1。这些仅证明本地工具门槛，不证明远端配置或翻译成功。
- 此前本日首次生产元数据查询因 CLI 认证失败未取得新生产状态；安全分类为 refresh/expired/loginRequired/authentication 命中、network 未命中，原始输出未展示。随后官方 PKCE 重新授权（同 scopes）等待授权码超时、exit 1，当时未取得登录成功。尚未正式执行复用流程、未生成或覆盖 token、未远程启用 guard，未取得本日 deploy 或真实 Azure 结果。
- 此前连接排查阶段未取得 CLI 登录成功证据；浏览器回到控制台 Home 只能证明控制台会话可用。首次查询中的 network 未命中仅描述该次查询，不能排除后续连接问题；授权链路根因仍未锁定。不逐次追加失效链接、设备码或错误时间线。旧授权等待会话现已无法取得，不据此宣称该旧进程已退出；该历史状态由下条新的成功证据更新当前认证结论。
- **本次 CLI OAuth 恢复直接证据**：当前进程使用代理 `127.0.0.1:7897`、`NO_PROXY=localhost,127.0.0.1,::1`，OAuth 采用默认 callback host `localhost`，保持 `account:read user:read workers_scripts:write d1:write` scopes（自动附加 `offline_access`）。Wrangler 4.158.0 输出 `Successfully logged in`，会话 `11331` 随后 exit 0，用户亦确认已完成；独立 `whoami --json` 安全过滤结果为 authentication OK、`targetAccountPresent=true`。随后只读核生产单版本 `6f5e4afd-b7d3-44e5-90ba-6d52e4abcf71` 占 100%；`versions view` 仅内存投影确认三项凭证绑定均为 `secret_text`、`DB` 为 `d1`、guard 为空、月预算 1,000,000、分钟限制 6，未读取 secret 值。默认 `localhost` 与固定 redirect 一致是本次具体差异，尚不足以锁定 IPv4/IPv6 唯一根因。API Token 未采用；未生成或覆盖本人 token，未改线上配置、未正式执行复用流程、真实 Azure 调用仍为零，手机待验收。本次无 schema/migration、服务端函数修改或 deploy。

## 2026-11-08 原凭证复测结果

用户明确要求继续已审查流程并复用原已保存凭证，不生成或覆盖 token。正式命令为 `pwsh -NoProfile -STA -File tools/enable-private-trial.ps1 -ReuseExistingToken`，工具会话 `79995`，最终 **exit 1**；以下执行事实由 Leader 提供，生成者另核 helper 与 Worker 当前代码。

- 预检生产版 `6f5e4afd-b7d3-44e5-90ba-6d52e4abcf71` 承接 100%，三项凭证均为 `secret_text`、`DB` 为 `d1`、guard 空、预算 1,000,000/月与 6/分钟。复用流程未生成或上传 token。
- 启用 F0 guard 版本为 `ffaa1a2f-a984-4d65-9d18-f795ac983488`。无鉴权用例通过后才打开本机掩码窗口，用户确认输入原凭证；agent 未查看窗口或凭证。

| 用例 | 安全结果 | 证据边界 |
| --- | --- | --- |
| `unauthorized` | 401 / `UNAUTHORIZED`，通过 | 本轮配置门槛已通过；不证明 Azure key 有效 |
| `too_long` | 422 / `TEXT_TOO_LONG`，通过 | 10,001 码点合成输入被拒绝 |
| `english` | 200，逐字一致，通过 | 纯英文原样返回；当前代码不调用 Azure |
| `chinese` | 502 / `UPSTREAM_ERROR`，失败 | 当前 Worker 路径支持一次 Azure 上游尝试；是否到达 Azure、是否计费未知，成功译文为零 |
| `mixed` / `spelling` / `literal` | 均未执行 | 首错即停，无重试；没有混合英文保护的真实成功证据 |

- 失败后工具自动恢复空 guard 并 deploy，恢复版 `3416f756-bdb3-4a3e-843a-db9eb0507ca9`。Leader 随后独立以 deployments status / versions view 安全投影核对：恢复版单版承接生产 100%，三项凭证仍为 `secret_text`、`DB` 为 `d1`、guard 空、月预算 1,000,000、分钟限制 6；未读取 secret 值。本地 `wrangler.toml` 仍为空 guard、相同预算及 observability=false。
- 本轮服务端对象仍为 Worker `bilingual-auditor-translation`；只进行了 guard 启用与恢复 deploy，恢复已生效。业务函数代码及数据库 schema 未改，无 migration/apply。此前“真实 Azure 调用为零”“复用未执行”均是对应历史阶段的结论，不能套用为本轮当前状态。
- **该轮阻塞已转到上游阶段**。`UPSTREAM_ERROR` 可覆盖网络/读取/JSON 解析异常、非成功上游状态或响应结构不符，安全结果不足以确定具体原因，也不能认定 Azure key 无效或原区域空格是唯一根因。用户随后批准临时安全枚举诊断：先离线实现与独立评审，再最多一次短中文真实请求，结束无论成败均关闭 guard。该轮未追加在线重试；诊断后续阶段见下节。

## 2026-11-11 单次诊断实现与续接

- 已实现鉴权后上游错误的临时固定枚举诊断，默认关闭；只区分连接、响应解析、HTTP 与响应结构阶段，状态和 Azure 错误码严格白名单，未知为 `OTHER`，不返回原始正文、异常或 headers。工具显式入口为 `-ReuseExistingToken -DiagnosticOnce`：401 后才掩码输入原凭证，仅一个短中文样本、无重试，成功、失败或取消均关闭 F0 guard 与诊断 flag，再核生产状态。不新增 endpoint，不生成或上传本人凭证。
- 11-08 离线检查为 Node 17/17、PowerShell parser 零错误、默认/复用/单次诊断三种 SelfTest exit 0；fresh evaluator preGate pass，无 P0/P1，并独立复跑 Node 17/17 与单次诊断 SelfTest。11-11 恢复审计重核 parser 零错误及单次诊断 SelfTest exit 0。这些只证明本地检查，不证明线上生效或真实翻译成功。
- 旧诊断执行仅取得预检生产版 `3416f756-bdb3-4a3e-843a-db9eb0507ca9` 与 Secret 类型通过，随后执行 agent 中断，未取得启用、用例、恢复或最终退出结果。11-11 原会话不可获取；仅查询进程 ID/启动时间，未发现 11-09 前启动的 `pwsh`，不能据此替代远端恢复核验。
- 用户明确确认未在第二个单次诊断掩码窗输入凭证并继续；结合当前工具必须输入后才发中文请求的路径，可支持该旧诊断未发上游请求。此前原凭证复测的一次上游尝试仍保留，不混同为总尝试零。
- 11-11 续接初始检查时 CLI 未登录，当时未取得新的生产元数据；这一阶段不能沿用 11-08 的恢复证据。后续认证、生产核验和单次诊断结果见下节，不追加逐次授权页面或报错时间线。
- 服务端对象为 Worker `bilingual-auditor-translation` 的既有 `/translate`，新增可选安全诊断需 deploy 才生效；没有数据库 schema/migration/apply。最终部署与双开关状态以下节的直接证据为准。

## 2026-11-11 授权恢复与单次诊断结果

- 用户批准本机临时授权辅助工具后，已实现 [十分钟等待工具](../../server/translation-worker/tools/login-with-long-wait.mjs)：固定 Wrangler 4.158.0，临时同目录独立副本仅将唯一授权等待计时从 120 秒改为 600 秒；原安装文件不写入，state、PKCE、scopes、redirect 和官方服务端有效期不改。离线语法检查、自测、副本版本及成功/异常清理检查通过，fresh evaluator preGate pass，无 P0/P1；不把本机适配当作官方配置参数。
- 正式授权会话 `11041` 输出 `Successfully logged in`，exit 0，并确认临时副本已删除、原安装文件 SHA-256 未变。只读检查发现当时 Windows 系统代理关闭，而本机代理服务与命令行进程代理可用；用户确认开启系统代理并完成授权。该差异支持浏览器连接排查，不能据此认定 Worker 到 Azure 的传输失败原因。Leader 随后独立安全投影 `whoami`，确认认证有效且目标账户匹配。
- 诊断前独立核验生产版 `eed812c7-d58c-4b85-99f1-3fe25022083d` 占 100%，三项凭证均为 `secret_text`、`DB` 为 `d1`，F0 guard 与诊断 flag 均为空，预算仍为 1,000,000/月、6/分钟。用户确认旧诊断第二窗未输入后，只续接原已批准的一次请求，没有追加请求额度。
- 正式执行 `-ReuseExistingToken -DiagnosticOnce`，会话 `94594` 最终 exit 1。启用版为 `dd3409a8-a78e-4a76-bb1f-ed0f1528bebf`；`unauthorized` 返回 401/`UNAUTHORIZED` 后才打开掩码输入，用户确认输入原保存凭证。唯一短中文样本返回 **502/`UPSTREAM_ERROR`**，固定安全分类为 **`stage=transport`、`httpStatus=OTHER`、`azureCode=OTHER`**；无重试。agent 未读取原始上游响应或凭证，诊断输出不返回上游正文、异常或 headers。
- 当前代码及安全结果支持一次本轮 `fetch` 尝试，但未取得可归类的上游 HTTP 状态或 Azure 错误码；请求是否到达 Azure、是否计费未知，成功译文为零。不能据此认定 Azure key 无效，也不能把 `transport` 简化为已证实的网络阻断。与 11-08 原凭证复测合计为两次上游尝试路径证据，成功中文译文仍为零；旧中断诊断不另计一次。
- 工具无论结果均关闭双开关，恢复版为 `8cbb0bde-b13e-44ff-b2ab-f5c3861fee6d`。Leader 独立以 deployments status / versions view 安全投影核对：该版承接生产 100%，三项凭证仍为 `secret_text`、`DB` 为 `d1`，`AZURE_TIER_CONFIRMED` 与 `SAFE_UPSTREAM_DIAGNOSTICS` 均为空，预算 1,000,000/月、6/分钟；本地 observability=false。未生成、覆盖或上传本人凭证。
- 本轮 Worker 的可选安全诊断已通过 deploy 生效，当前默认关闭；实际进行了启用与恢复 deploy，没有 schema/migration/apply。下一步仅只读核对请求构造、headers 及 Worker 到固定 Azure 端点的传输路径；没有新增真实请求授权，不自动重试。真实翻译、D10 和手机验收仍未完成。

## 2026-11-12 并行试验与本机直连

本节仅保留新的决定、实现与执行边界，不追加逐次授权页面或错误时间线。新人工授权以 [D09](../../BilingualAuditor-docs/docs/decisions.md) 为主落点。

- 已锁定一个 Workers 运行时兼容性缺陷：原 `redirect:"error"` 在真实 workerd 构造请求时抛 TypeError。固定 Wrangler 4.158.0、Miniflare 5.20261104.0-beta、workerd 1.20261104.1、compatibility date 2026-11-06 的纯本地复现支持该缺陷；不是据此直接读取或判定 Azure Key 无效。[Cloudflare Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)说明只支持 `follow`/`manual`。
- 当前代码已改 `manual`，解析正文前拒绝全部 300–399，不读 Location、不跟随、不重试。Node 18/18 与真实 workerd 生产默认 fetcher/本地假上游检查通过：正常 200、七类 3xx 拒绝、跳转目标调用 0、外网及 Azure 0；fresh evaluator preGate pass。该兼容性修复不改变原不跟随合同，但需成功 deploy 才在线生效。
- 11-12 关闭态部署因 CLI 认证失败停止，未取得新版本 UUID；后续十分钟本机授权等待超时、exit 1，临时副本清理且原安装哈希未变。本日没有新部署成功或生产元数据核验，不能把 11-11 `8cbb…` 恢复版视作本日重新核验，也不能称修复已上线。
- 用户批准调整排查顺序：先本机直连专用 `ba-lar` F0/`eastasia` 验证一个极短中文样本，不经 Cloudflare。新增 [本机工具](../../server/translation-worker/tools/verify-azure-direct.ps1) 显式 `-RunTrial` 才显示五分钟掩码 Azure 服务 Key 窗口；Key 仅内存、固定官方 plain 端点、最多一次、40 秒全程期限、禁止重定向、1 MB 流式响应界；安全输出白名单与转义合成译文，无原始错误或 Key。parser 零错误、无 GUI/网络/真实 Key 的 SelfTest exit 0，fresh evaluator preGate pass。
- 首次本机入口取得输入窗口就绪后，原会话结果不可取；用户报告未及时输入、窗口已消失。结合工具必须完成输入才进入请求的路径，可支持该次未发送请求，但不据此补造进程退出码。
- Leader 随后重新执行同一固定短中文入口，取得 **exit 1** 及安全结果：`STAGE=http`、`HTTP=401`、`AZURE=OTHER`、`ATTEMPTS=1`、`RESPONSE_RECEIVED=True`。这次已取得 HTTP 响应，未取得成功译文；不将 401 归因为某个具体 Key、资源绑定或区域配置。未自动重试，没有新生成或更换个人凭证。
- 用户随后明确表示不确定输入 Key 的来源。Leader 只引导本人核对 Azure 门户 `ba-lar` 的 KEY 1/KEY 2，没有接收值或截图；用户最终选择“先暂停 Azure，继续 DeepSeek”。**Azure 当前人工暂停**，不再打开输入窗口、部署或发送请求；后续恢复须重新确认范围。
- Azure Functions 仅为本机验证后再评估的手机长期代理候选。免费执行额度不代表存储等免费；未获创建收费资源、升级或充值授权，[微软费用说明](https://learn.microsoft.com/en-us/azure/azure-functions/functions-consumption-costs)仍需结合具体资源核对。没有 Functions 资源创建或部署。
- 用户另批准独立 DeepSeek 官方 API 固定短样本试验，最多四次/总计 ¥1，不取消其余免费边界；详细范围归 [独立计划](../plans/active/deepseek-translation-trial.md)，计量证明归独立证据，不在本页复制。尚未上传新 Key、部署或执行 DeepSeek 付费请求。

## Unknowns / HUMAN_CHECK_REQUIRED

- 用户已确认首次生成凭证后保存并关闭窗口；首次工具的最终退出结果仍无新增证据。本轮复用工具已取得 exit 1，二者不可混同；agent 未读取或截图私窗。
- 用户已报告删除区域前导空格；11-11 恢复生产版、绑定类型及双开关已取得新核验，远端 secret 实际内容仍未读取或验证。本人可按新批准在本机掩码窗口输入服务 Key，agent 不读取聊天、profile 或远端 Secret 值；不重复询问已确认专用 F0 资源的决定。
- 首次运行时配置失败的唯一根因仍未锁定；11-11 的无鉴权 401 只证明该次 Worker 复测通过配置门槛，不能与 11-12 本机直连的认证失败 401 混同。Workers 重定向兼容性缺陷已有本地复现与修复，线上修复和 Azure 凭证有效性仍待各自证据。secret 类型不证明其内容有效，禁止通过诊断 endpoint、原始响应或日志泄露内容。
- 实际 F0/订阅状态、Azure key 有效性、Azure 到达与计费用量、真实中文翻译和混合英文保护、CPU/预算表现、手机网络与人工验收均待验证；纯英文原样返回已取得本轮在线证据。用户报告专用 F0 `ba-lar`/`eastasia` 不替代上述直接证据。

## Execution Preconditions

1. Azure 已人工暂停；本机直连 401 与凭证来源未确认是恢复前的待核事项，不自动再次打开窗口、部署或调用。Cloudflare 兼容性修复虽本地通过，仍未取得成功 deploy 证据；不把 11-11 的恢复状态套为当前核验。
2. Azure 服务 Key 与原个人访问凭证不同：本机工具只由本人掩码提供服务 Key、仅进程内使用；原个人凭证不重新生成或覆盖。任何值不进聊天、日志、文件、argv、APK 或截图。
3. DeepSeek 严格按独立计划：证明有效、独立评审、独立资源/schema 与人民币确认之后，才可通过私密工具配置和进行最多四固定样本；费用总额不得自动重置，所有结果均关闭并核验。
4. Functions 收费资源或其他新增费用先提供具体边界并取得确认；不把免费执行、模拟检查、本机翻译或部署存在自动当作手机/发布/人工验收。

本轮 docs impact：补充本机直连的 HTTP 401、凭证来源未知及人工暂停，将执行主线转至 DeepSeek；兼容性修复仍只取得本地证据。产品授权归 D09、安全例外归 SECURITY、DeepSeek 预算归独立计划/证据。未改既有手机密钥保护要求；Azure 计划保留在 active 并明确暂停，不自动 accepted。
