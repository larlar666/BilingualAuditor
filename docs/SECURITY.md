# 安全、隐私与费用边界

核对日期：2026-11-13。职责：记录当前暴露面、明确约束及未验证项；不是安全或法律合规结论。来源为 [人工决定](../BilingualAuditor-docs/docs/decisions.md)、[产品规格](product-specs/index.md) 和当前代码。

## 当前可核对状态

- [Manifest](../app/src/main/AndroidManifest.xml) 已声明 INTERNET，禁止明文流量；未声明广泛存储权限。TXT 仍由系统 OpenDocument 选择后读取。中文/混合文段经用户运行时配置的 HTTPS 代理发送；Azure 当前暂停，另行批准的 [手机热点模式](plans/active/deepseek-phone-hotspot-demo.md) 经电脑发送至 DeepSeek。纯英文原样展示不请求翻译。
- 原文、译文与本人服务配置仅在内存中；个人凭证不进入 rememberSaveable、日志、文件或备份。配置界面明确区分个人访问凭证与 Azure 服务密钥。未实现后台剪贴板读取、App 数据库或手动备份。
- [代理](../server/translation-worker/README.md) 使用单个可轮换本人凭证；长期 Azure 密钥只读 Worker secret。鉴权、长度、分钟频率和 D1 持久原子预算预留均在外发前完成；缺配置、存储故障或额度不足时拒绝调用，不透传上游原始错误。无原文、译文或凭证日志语句，observability 默认关闭；真实部署日志配置仍需核对。
- 2026-11-07 已完成 D1 远端 apply 与 Worker 初步 deploy（见 [连接记录](evidence/translation-cloudflare-connection.md)）；三项凭证绑定为 Secret、本人 token 已上传。11-11 复用原凭证的单次中文诊断取得 `transport` 分类后，F0 与诊断双开关均关闭，生产 100% 已独立核验（见 [单次诊断结果](evidence/translation-live-configuration-audit.md#2026-11-11-授权恢复与单次诊断结果)）。诊断只输出固定白名单，不返回原始上游响应；未生成、覆盖或上传本人凭证。没有成功中文译文，Azure 到达/计费与具体原因未知。首轮单凭证不等于多用户授权或个人配额体系完成；分享前仍须补齐相应门槛。预算的保守计数、默认值与资源专用要求见代理说明，不把提醒当硬限额。
- DeepSeek 本机已完成四个固定合成样本的真实技术验证，Key 未上传 Cloudflare 或写入文件；原预算账本认领额度已用完，不再请求或重置。原英文保留通过不代表自然度、手机或长文验收；实际 usage、峰值估价及独立账本核验归[本机主证据](evidence/deepseek-local-trial.md#2026-11-13-四固定样本真实结果)，预留不冒充平台账单。
- Activity 为 launcher 导出，尚无分享/选词接收逻辑。未来增加外部 Intent 或文件格式时，按不可信输入处理并重新核对权限、长度和错误边界。
- `allowBackup=false` 已写入 Manifest，但 Android 12+ 数据提取规则曾有 Lint 警告。接入持久化前补齐并验证平台行为，不能因此承诺所有厂商绝不备份/迁移数据。

## 后续必须遵守的产品约束

通用预算仍仅免费额度，不自动升级或启用超额付费。2026-11-12 用户仅为本轮 [DeepSeek 官方短样本试验](plans/active/deepseek-translation-trial.md) 批准最多 ¥1：独立持久预留、最多四次、失败不返还、不按日期或 proof 更新重置；不自动充值、不扩大为长期付费许可。F0/Workers Free、订阅存续及实际账户条件分别核实；本人单凭证的代理预算不能替代真实账户用量核对，也不能约束绕过代理的其他客户端。

2026-11-12 已批准的本机 Azure 直连验证是排查例外：本人在掩码窗口输入 Azure 服务 Key，仅进程内直连固定官方端点，最多一个短合成请求；不读 Cloudflare Secret、不新生成个人凭证，也不是把 Key 放进手机。一次直连收到 401 后，用户因 Key 来源未确认选择暂停 Azure；当前不再输入或调用。工具、结果及边界见 [私人启用审计](evidence/translation-live-configuration-audit.md#2026-11-12-并行试验与本机直连)。用户随后批准 DeepSeek 本轮也改为本机直连，并确认人民币账户：API Key 仅本机掩码输入，经 stdin 进入子进程内存，不上传 Cloudflare，不需真实个人凭证；缺有效证明或新增本机模式独立评审时不得调用。固定 SQLite 账本显式首次初始化，缺失／异常不自动重建；预算不因日期、重启或 proof 更新重置。`LOCAL_SQLITE_V1` 证明只能由本机 runner 内部执行归属使用，默认 Worker 与远端工具拒绝，后续迁移不得再领一轮额度。实施／执行阶段见 [本机试验记录](evidence/deepseek-local-trial.md)。

Azure Functions 暂为本机验证后再评估的候选。执行免费额度与存储、网络等费用分别核对；未获创建收费资源、升级或充值授权。[微软费用说明](https://learn.microsoft.com/en-us/azure/azure-functions/functions-consumption-costs)不能替代实际账户/资源报价。

服务商长期密钥不进入 APK、Git、文档、日志或用户备份；共享后端 URL 不能当作访问控制。测试日志和截图用合成文本，不记录私人原文或凭证；在线发送内容与服务方须清楚告知。

词典代码许可、释义/例句/音频数据许可、可缓存/离线/再分发/商业使用及导出备份分别核查。[技术评估](../BilingualAuditor-docs/docs/technical-evaluation.md) 已区分旧快照与本轮翻译公开条件复核；公开条件和 No Trace 不代表实际账户、所有适用条款或发布许可已通过。

导入备份的覆盖/合并、加密、恢复格式和复习状态兼容仍需对应功能决策与验证；本次不擅自要求账号或加密新功能。验收、发布和上架需直接人工/外部证据，不能由 Lint 或代码存在推导。

## 本人手机热点临时模式

这是另行批准的新独立 ¥3／20 次试验，不重置旧 ¥1 账本；准确预算、SQLite 对象、生效与未执行项归 [独立计划](plans/active/deepseek-phone-hotspot-demo.md)，验证归 [主证据](evidence/deepseek-phone-hotspot-demo.md)。限公开或自写短文、本人单手机；Key 仅电脑进程内，已有 Bearer 只供代理鉴权，不当供应商 Key。临时证书不进入系统证书库；Android 自定义信任仅限配置的私有 IP 与精确 leaf DER 指纹，并核有效期、IP SAN、EKU、keyUsage，保留系统 hostname verifier。此局部例外需结合 Lint 审查，不是允许任意自签证书。

绑定与来源仅为当次已确认热点电脑私有 IPv4／手机精确网关 IP，不开放 wildcard、公网或所有来源；不自动修改防火墙。新证书每次重新配对，临时窗口关闭／父进程 EOF／两小时到期停止，不安装后台服务。取消／停止不能撤回已外发计费；预算账本继续保留。指南见 [逐步操作](guides/deepseek-phone-hotspot-demo.md)。
