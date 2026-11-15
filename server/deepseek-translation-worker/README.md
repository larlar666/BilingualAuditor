# DeepSeek 固定短文本翻译试验

本轮已批准改为**本机直连＋持久 SQLite 预算**，账户由本人确认以人民币计费。不依赖 Cloudflare、不上传 Key、不需要真实个人访问凭证，也不监听 HTTP 端口。原独立 Worker／D1 实现保留为后续候选，本轮不启用。当前实施与执行状态见[本机记录](../../docs/evidence/deepseek-local-trial.md)。

本目录为本轮最多 ¥1 的**固定四样本试验**。不是通用长文翻译服务，也未取得真实翻译/手机验收证明。业务 10,000 Unicode 码点上限仍保留；带汉字输入还必须逐字匹配 `src/trial.mjs` 的四个合成样本。纯英文在已配置、已鉴权时原样返回，不调用模型或预留费用。

## 接口及保护

`POST /translate`，HTTPS、JSON `{text, requestId}`、`Authorization: Bearer <本人凭证>`；成功 `{requestId, translation}`；失败 `{error:{code,message}}`，均 `no-store`。服务商 key 不是本人凭证。原文、译文、key、上游正文/headers/异常不写日志。observability 默认关闭。

上游固定 `https://api.deepseek.com/chat/completions`，模型固定 `deepseek-flash`，显式 `thinking:disabled`、`stream:false`、`max_tokens:512`、JSON 输出；没有工具、搜索、重试或自动后备服务。使用 Workers 支持的 `redirect:manual`，在读取任何 3xx 正文/Location 前拒绝，不跟随。

英文片段由固定占位符保护并原字节恢复；缺失、重复、未知占位符、无效 JSON、截断、非 `stop`、空内容、工具调用及异常 usage 均拒绝。提示词要求自然、忠实，但只有真实样本人工评判后才能主张翻译质量通过。

## 预算与证据闸门

官方中文峰值价格核对入口：[价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[Token 说明](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/)。本轮上界为输入 32,768 token、输出 512 token，按输入 ¥2/百万、输出 ¥8/百万，每次最坏 ¥0.069632；四次 ¥0.278528。这个结论**以当前模型完整消息模板的离线 token 上界可验证为前提**，字数估算不能代替证明。

上述金额是固定公开模板及现行峰值价下的本地推导，不是托管账单的绝对保证；正式试验仍须核对服务端 `usage`，异常即停止，详见预算证据的适用边界。

生产唯一证据源 `src/token-bound-manifest.mjs` 已生成本地计量 metadata；具体资产、计数、生成时刻与有效期见[预算证据](../../docs/evidence/deepseek-token-budget-audit.md)。这不是独立评审、部署或收费许可，过期时必须重新离线核验。证据绑定官方 DeepSeek-V4.1-Flash-1017 仓库固定 commit、tokenizer 与完整非思考模式消息编码器的 SHA-256；模板/模型适配、完整请求 hash 或时效不符合时，付费路径返回 503，不预留、不调用。测试中的合成 proof 仅为测试实例注入，不能用于正式启用。不得为联网试验填造 `verified`。

验证后 manifest 必须为以下固定形状；每个 case 的 `payloadSha256` 对应 `JSON.stringify(buildTrialRequest(text))` 的 UTF-8 SHA-256。prompt、模型、采样配置、样本或消息封装改变后必须重新验证。

```js
{
  schema: "deepseek-token-proof-v1", status: "verified",
  executionAuthority: "LOCAL_SQLITE_V1", // 本轮仅本机；远端默认拒绝
  reviewedAt: "<review time as Date.toISOString() UTC>",
  expiresAt: "<expiry as Date.toISOString() UTC, at most 24h after review>",
  verifiedWithOfficialChatTemplate: true,
  modelRepositoryCommit: "08c8657f02291e11b6f6b63e0e16014f8e748518",
  tokenizerUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/08c8657f02291e11b6f6b63e0e16014f8e748518/tokenizer.json",
  encoderUrl: "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/08c8657f02291e11b6f6b63e0e16014f8e748518/encoding/encoding.py",
  tokenizerSha256: "<64 lower-case hexadecimal characters>",
  encoderSha256: "<64 lower-case hexadecimal characters>",
  trialId: "deepseek-official-translation-trial-v1", model: "deepseek-flash",
  maxInputTokens: 32768, maxOutputTokens: 512, currency: "CNY",
  inputPricePerMillion: 2, outputPricePerMillion: 8,
  reservationMicroCny: 250000, totalMicroCny: 1000000, maxAttempts: 4,
  cases: [/* four {id, inputTokensUpperBound, payloadSha256} entries in TRIAL_CASES order */]
}
```

证明只在 UTC 审核时刻至过期时刻内有效，有效期最多 24 小时；未来审核、到期、格式异常均停止付费路径。续新证明不会创建新试验 ID，也不会重置预算、请求去重或样本认领。

`0001_deepseek_trial_budget.sql` 只建立一次固定试验行。每次外发前以**单个条件 UPDATE** 原子预留 ¥0.25，连同样本 bit 与 request UUID 一起认领。四样本各最多一次，累计最多四次/¥1；失败、超时、上游拒绝不退款/不释放。没有日期字段、运行期 INSERT 或自动重置。D1 缺表/缺行/失败/不可确认写入时拒绝外发。此限额只约束本代理，不覆盖同一官方账户中其他客户端的消费；不充值、不自动扩大预算。

## 本地验证与部署边界

Node >=24：在本目录运行 `node --test test/*.test.mjs`。测试包括真实 SQLite 多连接并发与重启持久、模型/完整消息 hash 变更拒绝、英文保护、畸形响应、固定样本、失败不退及超时不重试。`runtime.test.mjs` 复用相邻 Azure 开发目录中已经固定的 Wrangler 4.158.0 / Miniflare / workerd，只作开发测试依赖，不添加服务运行时依赖。真实 workerd 使用生产默认 fetcher、本地 D1；所有外联由本地假上游接管，不连接 DeepSeek。

## 后续远端执行（本轮不启用）

以下是保留的 Worker/D1 候选说明，不是本轮本机验证前置或启用许可。迁移须另行确认并承接已消费预算，不得重新获得四次额度。

当前 `database_id` 为全零占位，必须先创建**独立** D1 并填实际 ID，再 apply 此目录 migration；不能绑定 Azure 数据库。服务端函数与新表都需 deploy/apply 才生效；本轮本地代码本身不代表已部署或验证收费路径。

默认 `DEEPSEEK_TRIAL_ENABLED=""`，关闭态部署。正式试验仍须：有效 token 证明 → 独立评审 → 关闭态资源部署/schema → 通过已审查本机掩码工具，将用户输入的原个人凭证和新官方 `DEEPSEEK_API_KEY` 分别写入新 Worker 的加密 Secret → 临时启用 → 最多四样本、首错停止 → 无论结果关闭并核验生产。不得从 Azure Secret 读取或新生成本人凭证；服务 key 不进入聊天、本机 argv/进程环境变量、项目文件、日志、APK 或剪贴板读取流程，只由用户本机输入并交付 Worker Secret。若账户仅提供 USD 计费，须停止并另核费用边界，不套用本页人民币最坏费用。

## 本机私密工具

离线检查可在本目录执行 `node tools/read-trial-contract.mjs --self-test` 和 `pwsh -NoProfile -File tools/enable-private-trial.ps1 -SelfTest`；不会打开输入窗口、上传 Secret 或调用模型。

正式工具需要独立评审、有效 proof、人民币账户确认，以及独立资源/schema 和关闭态部署均已有证据。满足门槛并取得具体目标授权后，才使用 `-InitializeTrialSecrets -CnyAccountConfirmed`；明确复用已存在两项 Secret 时改用 `-ReuseExistingSecrets -CnyAccountConfirmed`。两者均通过 `pwsh -NoProfile -STA -File tools/enable-private-trial.ps1` 调用，不要在参数中提供 Key 或本人凭证。初始化不生成个人凭证；所有实际值只在本机掩码窗口输入。

当前远端未部署、未上传密钥或执行试验；本机四固定样本结果见本机主证据。上述远端命令不是执行 Gate；本轮本机执行归属的 proof 应在这些工具的 GUI／Secret 上传前被拒绝，不能借两套路径重置预算。

## 本轮本机执行

本机模式及输出帧修复已通过 11-13 独立 preGate；四个真实固定样本均 HTTP 200、原英文恢复检查通过，工具 exit 0。本轮四次认领额度已用完，**不能继续请求或重置账本**。下列命令说明不能替代局部独立评审或执行 Gate。固定 SQLite 与初始化标记仅记录预算聚合、样本及 UUID；首次显式建账，普通运行缺失或异常即停，不自动重建。最多四个固定样本、首错停止、总额 ¥1；退出进程后保留账本。无云端 deploy/apply；真实本机账本已累计认领四次／预留 ¥1，无剩余样本。预留不是实际花费，usage 与峰值估价见本机主证据。

离线检查：

```powershell
node tools/run-local-trial.mjs --self-test
pwsh -NoProfile -File tools/start-local-trial.ps1 -SelfTest
```

只有取得 fresh evaluator 的本机模式结论、有效 proof 与 Leader 执行 Gate 后，才可显式首次建账并打开掩码窗口：

```powershell
pwsh -NoProfile -STA -File tools/start-local-trial.ps1 -RunTrial -CnyAccountConfirmed -InitializeLocalLedger
```

**当前真实账本已初始化，不能再次执行上面的首次初始化命令。** 它不是重置命令，重复初始化应拒绝。以下是此前沿已有账本执行的命令形状；**本轮已经完成并耗尽认领额度，不是再次执行许可**：

```powershell
pwsh -NoProfile -STA -File tools/start-local-trial.ps1 -RunTrial -CnyAccountConfirmed
```

Key 不放入命令行，按窗口提示由本人输入。窗口取消／五分钟超时不发模型请求；初始化若已完成，累计账本仍保留。当前四样本均已认领，不能通过重开窗口或续 proof 恢复额度。普通只读预检为 `node tools/run-local-trial.mjs --check --cny-account-confirmed`，缺账本或 proof 无效时预期拒绝，不会自动建账。

实际执行、累计认领、剩余样本及任何未确认项统一记在[本机主证据](../../docs/evidence/deepseek-local-trial.md)，不能从进程退出或计量 metadata 推断真实翻译成功。
