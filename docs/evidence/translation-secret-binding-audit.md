# 翻译 Worker Secret 绑定审计

核对日期：2026-11-07（Asia/Shanghai）。本轮为 docs-only 审计收口；远端结果来自 Leader 裁剪的 Evidence Pack，本文生成者未重复远端查询。仅记录绑定名称、类型与版本，不保存任何凭证值。

## Startup / Read Scope

- 入口与合同：`AGENTS.md`、[docs 索引](../README.md)、[Team Loop core](../workflow/team-loop-core.md)、[generator](../workflow/team-loop-roles/generator.md)、[audit-first](../../workflow/audit-first.md)、[PLANS](../PLANS.md)、[SECURITY](../SECURITY.md)。
- 任务资料：[active plan](../plans/active/translation-integration.md)、[此前连接与初步部署记录](translation-cloudflare-connection.md)、[Worker 说明](../../server/translation-worker/README.md)。连接记录中的“未配置”描述属于此前初步部署阶段，本页记录后续绑定核查。
- 重新读取 current code：[wrangler.toml](../../server/translation-worker/wrangler.toml)、[worker.mjs](../../server/translation-worker/src/worker.mjs)。未读取登录 profile、磁盘日志、密钥值，未使用 GUI、未发起远端写入。
- Leader Evidence Pack：用户完成报告与截图观察、两次 `secret list`、deployment/version 元数据投影、planner 对固定 Wrangler 官方 CLI 源码行为的核查。生成者没有独立复现这些远端观察。

## Repository State Layers

`git status --short` 显示 `docs/`、`server/`、`app/` 等大范围 untracked，是本轮前已有/在途仓库面，不能把整个目录计为本轮产物。本轮候选仅本文件、active plan 的运行时配置进度和证据导航；不混入代码、部署配置、凭证、日志、profile、其他在途文件，不提交 Git。

## Verified Facts

1. 用户报告两项 Secrets 已添加并 Deploy，随后再次确认界面 Type 为 Secret；提供截图仅可见 Production 的 Runtime variables and secrets 标题及 Wrangler 更新提示，未展示绑定类型或值。用户完成报告与生产元数据须分别记录。
2. Leader 在正确账户和 Worker `bilingual-auditor-translation` 下两次执行固定 Wrangler 4.158.0 的 `secret list`，均 exit 0、返回 `[]`。部署列表存在两次 dashboard 版本（`537f8951…`、`a523bf8f…`），因此不能将空 secret 列表解释为变量不存在或用户未部署。
3. Leader 用 `versions view --json` 核查版本 `a523bf8f-306a-4208-b435-2d417509f0ef`，仅输出内存解析后的版本 id、binding name/type；`deployments status --json` 再确认该版本承接当前生产 100% 流量。绑定元数据如下：

   | 名称 | 类型 |
   | --- | --- |
   | `AZURE_TRANSLATOR_KEY` | `plain_text` |
   | `AZURE_TRANSLATOR_REGION` | `plain_text` |
   | `AZURE_TIER_CONFIRMED` | `plain_text` |
   | `DB` | `d1` |
   | `MONTHLY_CHARACTER_BUDGET` | `plain_text` |
   | `REQUESTS_PER_MINUTE` | `plain_text` |

   该投影未列出 `ACCESS_TOKEN`。没有读取或记录上述任何绑定值；guard 当前值未由此次类型投影复核，既有空 guard 记录见连接记录。
4. 元数据足以解释 `secret list []`：生产 KEY 是 `plain_text`，不是该命令列出的 secret 类型。此结论不证明 key 有效，也不证明界面故障。Leader 已指引用户仅将 KEY 改为 Secret／Encrypt 后 Deploy；REGION 非敏感，可保留 `plain_text`。随后用户回复“密钥已改为Secret并部署”；Leader 在正确账户/Worker 下关闭磁盘日志重跑 `secret list`，exit 0，返回 `AZURE_TRANSLATOR_KEY: secret_text` 与 `AZURE_TRANSLATOR_REGION: secret_text`，未读取值。绑定类型门槛已解决；上述 `plain_text` 表格仅对应修正前版本 `a523bf8f…`，不是最新状态。最新修正版本 ID/流量未在本 Evidence Pack 提供，不虚构该信息。
5. 安全核查路径使用 Node 子进程捕获 CLI 输出到内存，`WRANGLER_WRITE_LOGS=false`、`WRANGLER_LOG_SANITIZE=true`、metrics 关闭；只正向投影 id/name/type，解析失败不输出原始 stdout/stderr。此前 `WRANGLER_LOG=error` 抑制 JSON，导致解析失败，该次不算成功证据；调整日志级别并保持禁写磁盘后才成功取得投影。本页不把内存捕获原始响应等同于从未返回潜在敏感字段，但实际值未被检查、打印或保存。
6. 本地 `wrangler.toml` 的 guard 仍为空，observability 关闭。`worker.mjs` 在鉴权和外发前校验 F0 guard、D1、本人 token、Azure key/region 和预算配置；缺配置返回安全 `SERVICE_UNAVAILABLE`。代码接收字符串，不能据此证明远端 KEY 的存储类型符合“长期密钥只存 Worker secret”的合同。

本轮 agent 只做元数据核查，没有修改线上资源；用户自行修正并部署 Secrets。未生成/写入新 token、启用 F0 guard 或调用真实 Azure；此前 D1 apply 与初步 Worker deploy 成功事实仍有效。

## Inferences

- 最初空列表的根因已锁定在修正前生产 KEY 的绑定类型：当时空 secret 列表与 `plain_text` 元数据一致，无需据此重建 Worker/D1 或要求用户重复提交凭证。
- 用户界面实际选择、编辑和部署过程未被观察，不能断言用户手误、未保存，或 Cloudflare 必然存在接口/UI bug。

## Unknowns / HUMAN_CHECK_REQUIRED

- KEY 加密修正已获用户完成报告及最新 `secret list` 的 `secret_text` 证据；最新修正版本 ID/流量未在本轮提供。类型修正不证明密钥有效，不索要 key、密钥截图或原始 JSON。
- Azure key 有效性、F0 实际层级/订阅存续及真实请求未验证；用户此前已确认资源仅供本项目使用，不重复索要该决定。
- 安全的本人凭证生成/交付、guard 启用后的生产版本、真实合成文本翻译、英文保护效果、CPU/预算表现、手机网络及人工验收均未完成。

## Execution Preconditions

1. KEY 的 Secret 类型门槛已由最新 `secret list` 解决，两项现均为 `secret_text`；无需重复要求用户修正或重建资源。后续上线检查绑定最新生产版本，避免把旧 `a523bf8f…` 元数据当作当前状态。
2. 再按已批准本人首轮范围推进安全凭证交付、免费条件核对、guard/deploy 与合成文本测试；服务商 key 不经聊天、命令参数、Git、日志或截图传递。启用服务前继续保留缺配置拒绝外发门槛。
3. Leader 将本页事实/未知裁剪回下一轮 planner/generator 输入，按新生产证据逐项推进；真实 Azure 和手机验收分别记录，不以部署或类型修正代替。

本轮未改变函数或 schema 语义，无 deploy/apply；审计只确认已有生产绑定元数据。docs impact 为新增运行时配置证据并校正 active plan 进度，不改变产品合同、已批准范围或既有部署成功事实。终态仍需人工验收，不能自动 accepted。
