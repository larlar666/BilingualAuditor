# DeepSeek 本机直连试验记录

核对日期：2026-11-13。**本机四个固定合成样本的真实请求及原英文保留检查已通过，本轮额度已认领完毕，等待人工接受质量边界。** 不代表通用文章、自然度或手机已验收。

## 授权与范围

用户批准本机直连并确认账户以人民币 CNY 计费。最多四个固定极短合成样本、无重试、首错停止，固定总预算 ¥1；Azure 保持人工暂停。完整人工决定归 [D09](../../BilingualAuditor-docs/docs/decisions.md)，步骤归[试验计划](../plans/active/deepseek-translation-trial.md)。

Key 只在本人本机掩码窗输入，经 stdin 进入 Node 子进程内存，不上传 Cloudflare；不需要真人个人访问凭证，不监听 HTTP 端口。预算聚合保存在固定 SQLite 及初始化标记，显式首次建账，缺失或不一致时停止，任何失败不返还额度，日期／重启／proof 续新不重置。

本轮执行归属为 `LOCAL_SQLITE_V1`，普通 Worker 与 Cloudflare 工具须拒绝本机证明，避免双账本各领一轮额度；未来迁移需另行确认并承接已花预算。

## 当前证据与未知

既有 Worker/D1 离线 preGate 通过及固定请求 token 计数见[预算证据](deepseek-token-budget-audit.md)。它们不能代替新增本机模式的测试、独立评审或真实计费结论。

本机 core、SQLite 适配与掩码启动器已有代码，11-13 的新增本机模式独立离线 preGate 已通过；不能将其等同真实模型或手机验收。真实账本已显式初始化；首次 preflight 的输出帧污染修复通过 delta 复核后，沿同一账本完成四个真实固定样本。最终累计认领 4 次、预留 ¥1、无剩余样本，进程 exit 0；按返回 usage 和峰值全未命中价估算 ¥0.002256，未读取平台账单。未部署或 apply 云端资源。

## 2026-11-13 恢复核对

- 恢复初始阶段，Leader 只读检查服务目录 `.local` 不存在；这是首次正式启动前的观察。随后初始化结果见下节，不能沿用为当前未建账。本文档生成者未创建账本、运行 GUI 或调用模型。
- 重读当前代码：本机 runner 使用内部 factory 选择执行归属；普通 Worker／远端合同入口默认 D1。SQLite 首次初始化带 nonce 标记，普通运行缺失、损坏或部分初始化时拒绝，不自动重建。
- 掩码启动器先检查 proof 和账本，输入后再次比对 proof SHA-256、ledger ID、累计认领与剩余样本；Key 只随 stdin 进入子进程。runner 不监听端口，只执行固定样本，输出固定 JSONL 及转义后的合成译文／有效 usage，不输出原始上游错误。
- 本日 fresh evaluator 的本机离线 preGate 已通过：Node 合计 21 项、PowerShell parser／SelfTest 及本机／远端合同工具自测通过；未用真实 Key 或模型。计量证明经真实离线复算后续核，payload hash 不变；审核窗口与计数只引用[预算证据](deepseek-token-budget-audit.md)。
- 本机新增对象为固定 SQLite 预算库及初始化标记，无云端 deploy/apply；初始化的当前生效状态如下。Azure 保持人工暂停。

## 2026-11-13 离线评审与首次启动

以下运行事实采用 Leader 的直接安全 Evidence Pack，本文档生成者未重复执行启动器、读取 Key 或操作真实账本。

- fresh evaluator 对新增本机模式给出正式 preGate pass：21 项测试通过，PowerShell parser／SelfTest 及合同自测通过。此结论不证明 API Key 有效、模型可达或翻译成功。
- Leader 按已批准参数启动 `-RunTrial -CnyAccountConfirmed -InitializeLocalLedger`，进程 exit 1，安全结果为 `DEEPSEEK_LOCAL_STOPPED PHASE=preflight SAFE_FAILURE NO_MODEL_REQUEST_STARTED`。未打开 Key 输入窗口，未发出模型请求；此次启动失败不计为一次模型尝试。
- 随后普通 Node `--check --cny-account-confirmed` 成功，确认真实账本已完成初始化：`ledgerId=3b4358a5-5aac-4657-b454-9b6314df523b`、`attempts=0`、`reservedMicroCny=0`、`sampleMask=0`，四个固定样本均剩余，执行归属为 `LOCAL_SQLITE_V1`。
- 首次预检停止时，新增本机预算对象**已初始化生效但尚无额度认领**；初始化不得重复、不得重建、删除或重置。它不是云端 migration/apply 或服务部署。
- 只读审计已确认启动器的输出帧污染根因：当前 PowerShell/.NET 中，`$errorDrain.GetAwaiter().GetResult()` 将 `VoidTaskResult` 写入成功管道，使检查函数返回 `VoidTaskResult` 与 `OrderedHashtable` 两个对象；调用方因此得到数组并在 preflight 拒绝。纯合成检查帧在 `ledgerInitialized=true/false` 两种状态均可通过，不是初始化标记、预算或 proof 损坏。最小修复已在异步 drain 结果前加 `$null =` 显式抑制返回，并补真实 Node synthetic check-existing／check-init 两分支“恰好一个字典”及 run 输出全为字符串的回归。生成者红绿检查：原源码带新增回归 exit 1，修后 parser 零错误、SelfTest exit 0；实际已有账本普通 `--check` 不带初始化参数时，管道对象数为 1 且为字典，原 ledger ID 与零认领／零预留／四剩余不变。随后 fresh delta evaluator 给出正式 preGate pass、无 P0/P1：独立 parser／SelfTest exit 0，已有账本普通检查确认为单个字典、原 ledger ID 及零认领状态保持。此结论不代表真实模型调用或翻译成功。该失败未涉及 Key、模型或账户，也不能以普通预检成功越过启动器评审。后续须沿已有账本继续，不再使用 `-InitializeLocalLedger`。
- Leader 按不带初始化参数的 `-RunTrial -CnyAccountConfirmed` 重新正式启动，取得 `DEEPSEEK_LOCAL_KEY_INPUT_READY`；复用原账本，未重新初始化或重置额度。该阶段等待本人掩码输入，尚未取得模型输出；后续四样本最终结果如下。


## 2026-11-13 四固定样本真实结果

以下为 Leader 取得的真实工具安全输出与随后独立只读账本核验；本文档生成者未读取 Key、原始上游响应、账户余额或真实账本。

- delta 独立 preGate 通过后，Leader 以 `-RunTrial -CnyAccountConfirmed` 启动，**没有**传初始化参数，复用原预算。用户确认在掩码窗口输入并开始；工具会话 `38872` 最终 **exit 0**。
- 仅发送已批准的四个固定极短合成样本，四例本机与上游状态均为 HTTP 200，原英文保护检查通过，无重试。下表只保留合成译文；代码样式中的双空格和中文句号是实际观察，未替模型修正文案。

| 样本 | 合成译文 | 输入／输出 token | 按峰值全未命中价估算（微元） |
| --- | --- | ---: | ---: |
| chinese | `The weather is very nice today; let's go for a walk in the park together.` | 144／23 | 472 |
| mixed | `Today, use  NASA API  to test  iPhone  and  OpenAI。` | 209／32 | 674 |
| spelling | `Please keep  I has a apple.  this sentence as it is.` | 168／20 | 496 |
| literal | `Links  https://example.com/Aa?x=One&b=2  and  <b>Hello</b>  are literal text.` | 207／25 | 614 |

返回 usage 合计为 **输入 728、输出 100 token**；四份输入数恰与离线 response-format 渲染变体计数一致。按人民币峰值价、假设全部输入未命中缓存，估算为 `728×2/1000000 + 100×8/1000000 = ¥0.002256`（2,256 微元）。**这是价表估算，不是平台账单；没有查询余额或实际扣费。**

### 最终账本与停止边界

工具终态为 `LOCAL_TRIAL_COMPLETE`，本轮上游尝试 4 次。Leader 随后以普通只读 `--check --cny-account-confirmed` 核验：

| 字段 | 最终只读结果 |
| --- | --- |
| executionAuthority | `LOCAL_SQLITE_V1` |
| ledgerId | `3b4358a5-5aac-4657-b454-9b6314df523b`（与初始化一致） |
| proofSha256 | `4ed75e86d017c12e2c99dc815a712d1d310a45efc175727657995238912c1d83` |
| attempts | `4` |
| reservedMicroCny | `1000000`（¥1 预留） |
| sampleMask | `15` |
| remainingCaseIds | `[]` |
| ledgerInitialized | `false`（本次只读核验没有初始化） |

**¥1 预留不是实际花费 ¥1。本轮四次认领额度已用完，不再请求、不退款回领、不重置账本。** 证明续新、窗口重开或以后迁移远端均不能再获得四次额度。真实本机预算对象已初始化并记录消费，保留原账本；无需云端 deploy/apply。

Key 只由本人在本机掩码输入，经 stdin 留在子进程内存并用于固定官方 API 鉴权；未写项目／日志／argv／环境变量，不上传 Cloudflare，不生成或更换真实个人凭证。工具已退出并关闭 DB／Key 引用；这不是对物理内存清零的额外保证。Azure 保持暂停。

### 质量与人工验收

固定样本的技术链路、响应结构、usage 上界及原英文恢复已取得本轮真实证据；不能因此宣称自然英文质量已人工验收。观察到保护边界的双空格以及 `OpenAI。` 的中文句号原样带出，后续应在不破坏原英保留合同的前提下离线梳理空白／标点归属并人工对照，见[体验债](../plans/tech-debt.md)。本轮不为此追加付费调用。

本轮停在 **human_acceptance_required**，不自动 accepted。手机、通用长文、持久化文段和对外分享不在这次四样本结果范围内；继续真实请求须另有明确范围与预算，不能重置本试验来复用额度。
