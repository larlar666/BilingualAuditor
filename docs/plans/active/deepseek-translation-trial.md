# DeepSeek 固定短文本翻译试验

更新时间：2026-11-13。本计划是已结束调用的四固定样本试验；Azure 人工暂停。后续另行批准的 [手机热点演示](deepseek-phone-hotspot-demo.md) 使用独立新预算，不重置本计划账本。

状态：**human_acceptance_required（本机四固定样本技术链路通过，本轮额度已认领完毕；自然度与体验仍待人工判断）**。四例均 HTTP 200、原英文恢复检查通过；账本累计认领 4 次、预留 ¥1、无剩余样本。按服务端 usage 和峰值价估算 ¥0.002256，未查询平台账单；预留不等于实际花费。原 Worker/D1 离线 preGate 的通过不覆盖新增本机模式。人工决定见 [D09](../../../BilingualAuditor-docs/docs/decisions.md)，当前执行证据见 [本机试验记录](../../evidence/deepseek-local-trial.md)。

## 已批准范围

本人在本机掩码窗只输入 DeepSeek 官方 API Key，经 stdin 交给 Node 子进程，仅在内存使用。不需要真实个人访问凭证，不上传 Cloudflare；Node 在进程内复用现有 handler，不监听 HTTP 端口。内部固定合成鉴权夹具不是真人凭证，也不用于远端服务。

仅四个固定极短合成样本：中文、混合缩写、原有错拼英文、URL/字面标记。固定官方端点与模型、非思考模式、输出上限 512 token；无重试，首错停止。原英文严格恢复，截断、空内容、非 `stop`、工具调用、异常响应均拒绝。业务一万码点边界不变，本轮不开放通用长文，不代表手机或小范围分享已验收。

## 固定总额与执行归属

- 本轮预算最多 ¥1，只约束本工具发出的试验，不包含同一账户其他客户端消费，不自动充值。
- 固定试验 ID 与样本；沿用原子 SQL，每次外发前预留 ¥0.25，同时认领样本 bit 和 request UUID，最多四次。失败不返还，日期、重启或 proof 续新不重置。
- 本机预算对象为服务目录下 `.local/deepseek-official-translation-trial-v1.sqlite` 及初始化标记，只保存预算聚合、样本位和 UUID，不保存 Key 或原文。首次建账须显式初始化；普通运行缺账本、标记不一致或初始化中断时停止，不自动重建或清除真实账本。
- 本轮 proof 绑定 `executionAuthority: "LOCAL_SQLITE_V1"`；默认生产 Worker 与 Cloudflare 私密工具拒绝该证明。只有本机 runner 内部 factory 参数可选本机归属，不能由请求、headers 或 env 改选。
- 未来迁往远端须另行确认，并承接已消费预算；不能让本机和 D1 各自获得四次。本轮不迁移、不云端部署。
- 唯一计量证明为 `src/token-bound-manifest.mjs`，绑定固定官方资产、完整 payload hash、现行人民币峰值价和最多 24 小时审核窗口；修改、过期或未来证明均停止。详见[预算证据](../../evidence/deepseek-token-budget-audit.md)。本地计数不是托管账单的绝对保证，正式结果仍须核对服务端 usage，异常停止。

## 进度与启用门槛

| 对象 | 当前阶段 |
| --- | --- |
| 既有 adapter、英文保护、Worker/D1 预算 | 既有离线 preGate 已通过，Node 13 项与真实 workerd 本机回环 1 项通过；无外部模型调用 |
| 本机 runner、SQLite 与掩码启动器 | 11-13 本机及输出帧修复的独立 preGate 通过；随后复用原账本完成四个真实固定样本，进程 exit 0 |
| 本机计量证明 | 11-13 已真实离线复算并续核 `LOCAL_SQLITE_V1` metadata，完整请求 hash 不变；审核窗口和边界见预算证据，实际执行前仍核时效 |
| 人民币账户 | 用户已明确确认 CNY；未读取账户金额或调用余额接口 |
| 本机预算与真实试验 | 真实 SQLite 最终只读核验为 attempts=4、reservedMicroCny=1000000、sampleMask=15、remaining=[]；与初始化为同一 ledger ID。四次额度已用完，不再调用或重置；详细结果归本机主证据 |
| 云端资源 | Worker 未部署，D1 ID 仍为占位，云端 migration 未 apply；不是本轮前置，不启用 |
| 手机、长文与分享 | 未验收，不在本轮短样本结论内 |

当前收口：四固定样本已完成，工具已退出并关闭 DB／Key 引用，保留原预算账本。本轮不再启动模型请求，不重复初始化、不重置额度；等待人工核对结果与质量边界。Key 不进入聊天、文件、日志、argv、环境变量、APK 或剪贴板读取流程。

本机 SQLite 是新增预算对象，11-13 已显式初始化并记录四次认领／¥1 预留；无需云端 deploy/apply。既有云端函数／D1 实现保留为后续候选，当前不迁移或重复启用。计划保留在 active，当前停在 human_acceptance_required，不自动 accepted 或移入 completed。自然度／空白标点体验、手机与通用长文后续另核；本轮不得再付费重试。
