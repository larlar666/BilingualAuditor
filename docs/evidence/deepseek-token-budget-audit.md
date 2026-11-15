# DeepSeek 固定试验的离线 token 与预算证据

核对日期：2026-11-13。仅记录公开资产、四份固定合成请求及本地验证；没有读取 Key、调用模型、部署资源或产生接口费用。

## Startup / Read Scope

读取 AGENTS、docs 索引、Team Loop core/generator、audit-first、SECURITY，以及新服务 `trial.mjs`、canonical manifest、私密工具合同校验器和 README。重新审读固定版本官方 encoder 的文本执行路径及 tokenizer JSON，未运行旧 ZIP 示例或 `trust_remote_code`。

项目有其他并行在途文件；本轮写入范围仅 `server/deepseek-translation-worker/src/token-bound-manifest.mjs`、两份 `tools/verify-token-budget.*` 和本页。不修改试验预算行、Azure、客户端、凭证或部署配置。

## Verified Facts

### 固定模型与公开资产

[官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 在本日将 `deepseek-flash` 对应为 DeepSeek-V4.1-Flash-1017；人民币峰值输入缓存未命中 ¥2/百万 token、输出 ¥8/百万 token。此次按峰值价核算，不使用缓存或空闲折扣。

[官方模型仓库](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017) 的固定提交为 `08c8657f02291e11b6f6b63e0e16014f8e748518`。以下公开缓存由前置 Scout 下载，本轮重新核验 SHA-256 后才加载：

| 原文件路径 | SHA-256 |
| --- | --- |
| `tokenizer.json` | `c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b` |
| `tokenizer_config.json` | `6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547` |
| `encoding/encoding.py` | `13231c592e958fb39e2af6001dae69d90e7a36b265702b9b390236fb387599e2` |
| `encoding/README.md` | `a34a5ca98c65e5b5b2bedd693cc2e18e732fe50192723fb6937ae07219c23739` |
| `LICENSE` | `f2c6c602815669d292889e5be8c802f2ed950653b77999b1584e8e6aed25d040` |

下载来源形如 `https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/<固定提交>/<原文件路径>`，不使用可变 `main`。资产保留在本机临时缓存，没有将其复制进项目。上游许可证为 MIT；若今后复制其代码或资产，应保留许可说明。

实际 tokenizer 配置是无操作的空 normalizer Sequence、三个隔离 Split 后接 ByteLevel 的 pre-tokenizer、BPE 与关闭的 truncation；不是直接 `normalizer=null`。ByteLevel 不添加前缀空格。模型配置的长度为 1,048,576。

编码器仅导入 `typing`、`copy`、`json`、`re`。已审读 `encode_messages`、文本预处理和 `render_message` 路径：本轮只传两个字符串内容的 system/user 消息，没有图像、工具、文件用例加载或网络调用。固定哈希之外另做 AST 导入/模块顶层检查。用 Python 隔离模式与禁止字节码写入加载该经审读文件，不执行其文件用例函数。

### 完整请求与计数

唯一请求来源为 [trial.mjs](../../server/deepseek-translation-worker/src/trial.mjs) 的 `TRIAL_CASES`、`buildTrialRequest`；包括 system 提示、占位符和只读英文上下文。固定 `thinking:disabled`、`stream:false`、`max_tokens:512`、`response_format:json_object`，没有工具或搜索。

调用固定 encoder 的 `encode_messages(messages, thinking_mode="chat")`，再用同提交 tokenizer 的 `encode(prompt, add_special_tokens=False)`。完整 prompt 已含 BOS、角色和非思考 assistant 前缀。额外计数官方 encoder 将 response_format 放入首个消息时的渲染变体，作为公开模板内的保守对照；没有因此改变真实请求 JSON。

本机 `tokenizers` 版本为 **0.22.2**。

| 样本 | 原始完整模板 token | 含 response-format 渲染变体 token | 两者最大 UTF-8 字节数 | 采用的输入边界 |
| --- | ---: | ---: | ---: | ---: |
| chinese | 122 | 144 | 780 | 32,768 |
| mixed | 187 | 209 | 924 | 32,768 |
| spelling | 146 | 168 | 824 | 32,768 |
| literal | 185 | 207 | 903 | 32,768 |

全部计数和字节数均小于采用的边界；这不是按中文/英文字符比例估算。四个 canonical payload SHA-256 分别为：

| 样本 | 完整 `JSON.stringify(payload)` UTF-8 SHA-256 |
| --- | --- |
| chinese | `8bc1a56b397c19bf5d5539d2559791f84b3907d6fa023409d2b99a69b56590c3` |
| mixed | `58d42e59469365ffba626eb78c20a609144fc0b7b0486e1de221810e014362c0` |
| spelling | `d837766b7449bad6c74196f7985227f94ea51aba551f01256d69541205cc6472` |
| literal | `94b8a6f39b65b31c1df452ca9c83252727e15cfbfd63ede1706f0a3a149163d7` |

按公开模板输入边界 32,768、输出硬限 512 和当日峰值价，单次保守核算为 `32768×2/1000000 + 512×8/1000000 = ¥0.069632`，四次为 ¥0.278528。D1 的每次 ¥0.25 预留、最多四次和固定总额 ¥1 是另一个更保守的代理放行政策，失败也不退回；本轮没有创建或重置预算记录。

### 生成与检查

[验证入口](../../server/deepseek-translation-worker/tools/verify-token-budget.mjs) 默认只核验，显式 `--write-manifest` 才写入 canonical [manifest](../../server/deepseek-translation-worker/src/token-bound-manifest.mjs)。它不下载资产、不接受 Key、不调用 API，也不改变固定 trial ID、D1 状态或启用开关。重新生成前仍需重新核对当时官方模型映射、价格及公开模板，不能把脚本本身当作自动价格更新。

在新服务目录运行：

```powershell
node tools/verify-token-budget.mjs --asset-dir '<已下载并核定的资产缓存目录>' --authority LOCAL_SQLITE_V1
node tools/verify-token-budget.mjs --asset-dir '<同一目录>' --authority LOCAL_SQLITE_V1 --write-manifest
```

11-12 初次 manifest 的 `reviewedAt` 为 `2026-11-12T06:08:18.935Z`，`expiresAt` 为 `2026-11-13T06:08:18.935Z`；这是历史生成结果。当前本机归属的最新审核窗口见下节；`read-trial-contract.mjs --read` 是远端合同入口，默认必须拒绝本机 proof，不能将拒绝当作分词证明失败或据此切回远端归属。

检查结果：Node 语法及离线计数/manifest 写入入口 exit 0，私密合同读取 exit 0。新服务测试中 13 项非回环检查通过；真实 workerd 的回环测试第一次受 sandbox `EACCES 127.0.0.1` 阻止，随后仅为本机回环重新执行该测试，**1/1 通过**。未以此声称远端部署或真实模型调用通过。

### 2026-11-13 本机证明真实离线刷新

刷新前重新核对[官方中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：`deepseek-flash` 仍对应 DeepSeek-V4.1-Flash-1017，人民币峰值输入缓存未命中 ¥2/百万 token、输出 ¥8/百万 token。固定公开资产的 SHA-256、文本执行路径、完整四份请求及 `LOCAL_SQLITE_V1` 归属均重新检查；没有只修改审核时间来延长证明。

先运行只读验证，再运行上述显式 `--write-manifest` 命令，两次均 exit 0。本轮重新得到四份完整模板 token 数 **122／187／146／185**，response-format 渲染变体 **144／209／168／207**，UTF-8 字节边界 **780／924／824／903**；payload hash 与前表一致。Python `tokenizers` 仍为 **0.22.2**，采用输入边界和费用推导保持不变。

新 canonical manifest 的 `reviewedAt` 为 **`2026-11-13T02:54:44.958Z`**，`expiresAt` 为 **`2026-11-14T02:54:44.958Z`**，有效期 24 小时。显式本机 authority 的逐样本后端／合同校验全部接受；生产默认 authority 逐样本拒绝，远端 `read-trial-contract.mjs --read` 按预期 exit 1。manifest 语法检查通过。该结果不代替本机执行器、SQLite 和掩码启动器的独立 preGate。

刷新前后项目 `.local` 均不存在；未创建、打开或重置实际预算账本，固定试验 ID、样本认领和预留政策未变。本轮验证工具报告外部网络及模型 API 调用均为 **0**；另有一次不带凭证的官方公开价格页读取。没有 Key、GUI、云端 CLI、部署、Secret 上传或真实费用。

## Inferences and Limits

该 manifest 证明固定请求在固定公开模型模板下的本地计数与采用边界，**不是托管服务账单的绝对保证**。API 服务端未公开的额外处理、模型别名或价格后续变化，不能仅靠本地 encoder 排除。[官方 Token 说明](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/) 指明实际 token 用量以响应 `usage` 为准；正式试验应继续核对该字段，异常即停。不能将字数估算、当前短样本或本地计数推广为任意一万码点长文的计费证明。

计数验证当时未核账户币种或余额；用户随后已确认人民币 CNY，未提供金额或调用余额接口。正式工具仍须执行相应币种门槛；本页离线刷新阶段尚无付费请求，随后本机真实执行结果由[本机主证据](deepseek-local-trial.md#2026-11-13-四固定样本真实结果)维护。代理固定 ¥1 预留政策不约束同一账户中其他客户端消费。本地 verified 元数据也不等于 Leader 已准许部署、上传 Secret 或发起收费请求；本机模式的独立 evaluator、显式持久建账及本人私密输入等门槛仍需逐项满足；本轮远端不启用。

## 本轮执行归属调整（2026-11-12 已批准）

用户已批准本机直连并确认人民币账户。本轮证明新增 `executionAuthority: "LOCAL_SQLITE_V1"` 的排他归属要求：只有本机 runner 内部 factory 可选择本机，默认生产 Worker 与远端私密工具必须拒绝；不能通过请求或 env 改选。新增字段不改变上述历史分词计数、payload hash、资产来源或原审核时刻，不为续新预算提供依据。代码一致性和本机模式评审另见[本机记录](deepseek-local-trial.md)。

固定本机 SQLite 保存原子预留与样本认领；首次初始化须明确，缺失或不一致不自动重建。未来迁往 D1 须另行确认并承接已消费预算，不能双账本各取得一轮额度。本轮不上传 Key、不云端部署。

## Execution Preconditions / Docs Impact

进入真实试验前，由 Leader 将本页、canonical manifest、生成工具与测试输出交给 fresh evaluator；确认模型/人民币价格、排他执行归属与短期证明仍有效，显式初始化本机持久账本后，再沿已批准的最多四个固定样本范围执行。证明到期或任何输入变动时重新离线核验；不得重置固定试验预算。

本轮仅改变本地预算证据与公开 metadata，未改变产品合同、数据库 schema、已部署能力或真实费用事实。原远端服务仍未部署或 apply；本轮改为本机执行，须另有本机代码评审、显式建账与直接执行证据，本页离线刷新阶段当时无 API 调用或密钥交付；其后的本机执行及预算终态见[本机主证据](deepseek-local-trial.md#2026-11-13-四固定样本真实结果)。
