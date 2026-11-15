# 手机热点临时 DeepSeek 代理

仅供本轮本人手机短文演示：手机 App → 电脑 HTTPS 临时代理 → 固定 DeepSeek 官方端点。Azure 暂停；不依赖 Cloudflare、不部署云服务、不开放批量／后台／多用户功能。正式 Key、真实网卡监听、真实模型调用仍须本轮独立评审及网络参数执行门槛；以下说明不是已经完成真实执行的证据。

## 固定边界

- 每次至多 1000 Unicode 码点，空白、标点和 emoji 都计入；不截断、不拆段。纯英文原样返回，health 不请求模型。
- 固定 `deepseek-flash` / `DeepSeek-V4.1-Flash-1017`，非思考，JSON 输出，最多 4096 输出 token；无自动重试或重定向跟随。
- 新试验 `deepseek-phone-hotspot-demo-v1`，归属 `PHONE_HOTSPOT_DEMO_V1`。与旧四样本 ¥1 账本完全独立，绝不重置或访问旧账本。
- 本轮最多 20 次上游尝试或 ¥3 预留先到停止；每次外发前原子认领 UUID 并预留 150000 微元（¥0.15）。超时、失败和手动重试均计数，不返还；重放 UUID 不重新外发。日期、程序重启、证明续核不重置。
- 预算仅约束此工具，不能约束账户其他客户端；预留不是实际平台扣费。validated usage 仅按峰值价估算。
- 同一代理进程最多一个上游请求；本人仅开一个窗口，不保证跨进程互斥，已认领尝试间隔至少 3 秒；鉴权、长度、本地格式、计量、纯英文及 health 拒绝均不认领。

## 动态输入计量与证明

每个实际完整请求先经本机无 Key Python 子进程，stdin 传 payload，使用官方固定 commit 的五份已 pin 资产、官方非思考 chat template，分别计入普通模板与 JSON response-format 变体。不使用旧四 payload hash 证明。所有资产每次核 SHA-256，tokenizers 固定 0.22.2；只返回 payload hash 和四个整数，不保存原文、完整 payload、Key 或译文。

当前官方资产缓存：当前用户 `AppData/Local/Temp/bilingual-deepseek-tokenizer-audit`。桌面受限环境的系统临时目录可能指向包内隔离目录，故不使用 `os.tmpdir()` 寻找已有资产。工具不自动下载或复制资产、不安装依赖、不执行远程代码加载器。Python 独立模式、禁 bytecode、10 秒超时、64 KiB 输入／4 KiB 合计输出上界；五资产 hash 与 AST 审计在 Python 内完成。

固定空 normalizer 和 ByteLevel BPE 的完整 rendered UTF-8 字节数作为保守输入上界，实际 token 数也一并核对。chat framing、非思考 assistant 后缀及 response-format 变体均纳入；上界超过 32768 时外发前返回 `PROTECTION_LIMIT`。输入最大 32768、输出 4096，按人民币峰值输入 2／输出 8 元每百万 token，最坏估价为 **98304 微元（¥0.098304）< ¥0.15**。

`src/policy-proof.json` 记录此次官方中文[价表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、模型和资产 pins、24 小时审核窗口；过期、未来、字段变化或启动前后 SHA 不同即停止。每次中文请求在计量前后重新核 policy；不自动续期或通过修改日期重领预算。公开 tokenizer 与托管服务版本对应不构成托管账单的绝对保证；响应 usage 越界、缺失、非整数时拒绝结果。

## 英文保留

仅新层处理 1000 码点输入；只读复用旧 trial 的 system prompt 与严格恢复函数，旧 fixed4 入口及证明未改动。保留英文内部字符、拼写、大小写、URL 和字面标记。保护片段排除边界空白，中文标点留在可翻译上下文；只在恢复前规范模型生成的 marker 周围空白，不改片段内部。marker 冲突、重复、丢失、未知 marker、遗留中文、空输出、截断、工具调用和 reasoning 均拒绝。自然度与标点仍需手机人工对照。

## 账本对象与生效边界

新增本机 SQLite 表 `phone_budget`（预算聚合、UUID）及 `local_trial_authority`（试验／归属／ledger UUID）。迁移 `migrations/0001_phone_budget.sql` 仅由显式首次初始化执行，不需要云端 deploy/apply；本目录正式 `.local/phone-demo-v1.sqlite` 及 `phone-demo-v1.initialized.json` **未由离线开发测试初始化**。测试仅写独立临时目录。标记、库文件、归属、版本或聚合不一致时 fail closed；初始化中断保留残留，普通运行不自动建账或修复。

## 本机控制协议

启动器负责掩码输入本人已有 Bearer 和官方 Key、生成仅内存临时证书／私钥、确定电脑私有 IPv4 与手机来源 IPv4，并在人工执行门槛满足后调用：

```
node --disable-warning=ExperimentalWarning tools/run-phone-proxy.mjs --check --cny-account-confirmed
node --disable-warning=ExperimentalWarning tools/run-phone-proxy.mjs --check --cny-account-confirmed --initialize-ledger
node --disable-warning=ExperimentalWarning --use-env-proxy tools/run-phone-proxy.mjs --serve --cny-account-confirmed
```

首次初始化参数只用于未建账的新试验，不能重放。production 无自定义账本路径、模型端点、假上游或 loopback 开关。普通网络代理变量只用于 Node 固定官方请求，不放任何 Key；无失败 fallback/retry。

serve 首个 stdin JSONL 为 `START_PHONE_PROXY`，精确字段：`event,apiKey,accessToken,bindAddress,allowedClientAddress,port,certificatePem,privateKeyPem,policySha256,ledgerId`。Key、token、私钥均不进入 argv、环境、日志或文件。后续仅接受 `{"event":"STOP_PHONE_PROXY"}`；EOF／SIGINT／SIGTERM／2 小时到期均停止监听、销毁 sockets、abort 上游及清除凭证引用／关闭 DB。普通完整上传不会误判断连；手机在响应前断开才取消上游，已预留额度不退。

仅绑定指定 RFC1918 IPv4，不绑定 wildcard/public/loopback；仅允许指定手机源 IPv4。默认端口由启动器取 8765。TLS 至少 1.2，证书 SAN 必须精确包含 bind IP，有效期须覆盖 2 小时会话（建议生成 3 小时临时证书）。手机 pin 为证书 DER 的 SHA-256 小写 64 hex，不采用 PEM 文本 hash。服务最多 8 个 sockets、16 个 headers、4 KiB headers、16 KiB request body 且严格 UTF-8；请求和 TLS socket 均有超时。无原文、译文、headers 或 Key 日志。

安全 JSONL 契约（精确字段）：

- `PHONE_PROXY_CHECK_OK`：`event,policySha256,policyExpiresAt,ledgerId,ledgerInitialized,limits,budget`。
- `PHONE_PROXY_READY`：`event,endpoint,certificateSha256,bindAddress,allowedClientAddress,port,sessionId,sessionExpiresAt,policyExpiresAt,limits,budget,ledgerId`；endpoint 含 `/translate`。
- `PHONE_PROXY_BUDGET`：`event,ledgerId,budget`；只有响应 usage 通过验证且恢复成功后，额外包含 `usage:{promptTokens,completionTokens},estimatedPeakCostMicroCny`。一次正常请求有认领／有效 usage 两帧。
- `PHONE_PROXY_STOPPED`：`event,reason`，白名单见 `src/contract.mjs` 的 `STOP_REASONS`。
- `PHONE_PROXY_FAILED`：`event,reason`，仅 `GATE_FAILED|INPUT_OR_START_FAILED`。不输出原异常。

`limits` 恰为 `{maxInputCodePoints:1000,maxAttempts:20,maxBudgetMicroCny:3000000}`；`budget` 恰为 `{attempts,reservedMicroCny,remainingAttempts,remainingReserveMicroCny}`。时间使用 Node `Date.toISOString()`。

## 手机 HTTP 契约

两路均需同一 `Authorization: Bearer …`，hash 后常量时间比较。

- `POST /translate` JSON `{text,requestId}` → `{requestId,translation}`。失败 `{error:{code,message}}`，白名单 code/message 见 `src/contract.mjs`。
- `GET /health` → `{status:'ok',service:'bilingual-auditor-phone-proxy',translationReady,limits,budget,policyExpiresAt,sessionExpiresAt}`。`translationReady` 仅表示本地 policy／预算可用，**不证明 Key 有效、官方连通或翻译质量**。health 零模型请求、零预算认领。

## 离线验证

`npm test` 使用真实临时 SQLite、26 连接竞争、动态官方计量和本机 TLS 假上游；TLS 回环需本机回环网络权限。测试证书由 PowerShell/.NET 在内存创建，不写证书库。测试不是正式 `--serve`，无真实 Key、模型、热点或云资源。真机热点互通、Android pin、输入过长提示、断连／关闭窗口体验、译文自然度与平台账单仍须后续人工验收。
