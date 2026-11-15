# DeepSeek 手机热点演示主证据

核对日期：2026-11-13。范围与授权归 [独立计划](../plans/active/deepseek-phone-hotspot-demo.md)，操作归 [指南](../guides/deepseek-phone-hotspot-demo.md)。本页记录证据强度；状态 **human_acceptance_required**，不是 accepted。

## Android 自动检查

以下为 Leader 提供的本轮直接检查摘要，本 docs generator 未重跑构建：

| 项目 | 结果与边界 |
| --- | --- |
| 构建 | `:app:assembleDebug` 成功；仅开发 debug 产物 |
| JVM 单测 | 26/26 通过；不含 Android 实际 `org.json` health 解析运行路径，不替代真机 TLS／UI |
| Lint | 0 errors、6 warnings：1 项受限自签证书 `CustomX509TrustManager` 需审查，1 项旧 `DataExtractionRules`，4 项旧 `GradleDependency` |
| 独立 Android review | Leader 报告无 P0/P1；不代表真机通过 |
| APK | `app/build/outputs/apk/debug/app-debug.apk`，8,921,049 bytes；SHA-256 `E3F3985341B79870A59604F5D48FBBFD9EA5951907AA43F00F032762CB11997E` |

Android 当前代码核对：临时模式要求私有 IPv4／leaf DER pin，仍保留系统 hostname verifier，并检查证书有效期、服务端 EKU、digitalSignature 和精确 IP SAN；不是全局信任任意证书。配置、health 与翻译结果代次隔离，取消不撤回已外发费用。

## 后端与启动器

代码主落点：[代理 README](../../server/deepseek-phone-proxy/README.md)、[policy](../../server/deepseek-phone-proxy/src/policy-proof.json)、[SQLite migration](../../server/deepseek-phone-proxy/migrations/0001_phone_budget.sql)、[Windows 启动器](../../server/deepseek-phone-proxy/tools/start-phone-proxy.ps1)。Leader 提供本轮后端离线检查 16/16、exit 0，launcher SelfTest 通过；fresh 独立安全评审通过，无 P0/P1；STOP 枚举小修已复核通过。P2：busy 锁仅每 handler／进程，换端口双开仍可并发；同账本 SQLite 总 ¥3／20 次上限仍原子，操作只开一个窗口。不借用旧 fixed4 的通过结论，离线隔离账本／假上游不证明热点真机或官方模型。

已只读核对 policy 固定 `deepseek-flash`／`DeepSeek-V4.1-Flash-1017`，输入峰值 2、输出 8 CNY／百万 token；代码审核快照与 Leader 本轮直接复核的[官方价表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)一致；文档作者未自行再查价。输入上界 32768、输出 4096，最坏估价 ¥0.098304，低于每次 ¥0.15 预留。价格、模型资产和 24 小时证明失效时拒绝，不靠改日期恢复。账本表及本机初始化生效边界见计划；不需要云端 deploy/apply。

## 初始阶段：网络、正式运行与人工验收（后续进展见下）

- 用户已确认电脑连接这部手机热点；Leader 提供实际 WLAN `10.251.239.59/24`，网关 `10.251.239.220`。这是观察记录，不是互通测试。
- ADB 当前 0 device；用户不方便 USB，选择手动安装，现已报告 APK 安装并打开；这不是 USB 已连接或 health 成功。
- Root 已以 reviewed launcher 的 `-STA -RunProxy -CnyAccountConfirmed -InitializePhoneLedger` 正式启动；会话 47841 输出 `PHONE_PROXY_PRIVATE_INPUT_READY NO_MODEL_REQUEST_STARTED`。可证明热点选择／确认与 preflight 已通过，正式新账本显式创建，当前等待用户掩码输入。尚无 `PHONE_PROXY_READY`，不声称实际网卡监听或手机互通；无新模型调用，正式 check exit 0，只读复核 attempts=0、reservedMicroCny=0、remainingAttempts=20、remainingReserveMicroCny=3000000。旧 ¥1 四样本账本与结果保持原样。正式 ledger ID `b626fab9-a8ae-45dc-9a8a-8c5fa1986998`；policy SHA-256 `b80648a5ff6e65689a372c1b8d0af49d924063602720a03635d6585fd9c4283a`，有效期至 `2026-11-14T05:11:56Z`。本次 check 的 `ledgerInitialized=false` 表示此 check 没有新建账，不表示已存在的库缺失。
- 待人工：正确／错误 pin、health 与预算不增、热点来源／防火墙、首个短文翻译、原英文及自然度、断连／关闭窗口、新证书重新配对、同账本跨次延续。
- 离线 16/16 与独立评审摘要已收；细项包括：1000／1001 Unicode 边界、20 次／¥3 拒绝、失败／重试不退、并发认领、初始化不重置、TLS 与 launcher 输出帧。不能为了验上限消耗正式 20 次。

## 历史阶段：监听就绪与凭证待找回

- 同一会话 47841 后续输出 `PHONE_PROXY_READY URL=https://10.251.239.59:8765/translate`；当次公开 leaf DER SHA-256 指纹为 `68c24c42641a5d69c381e4a10bdc6d5c46dc2c34a5c4ef6cf0a4e969cc242e1a`。这更新了前述“尚未 READY”的阶段，可证明本机代理就绪，不能证明手机 health、官方 Key 或 Bearer 填写正确，也不是模型成功。
- 用户随后表示找不到个人访问凭证。Leader 已请用户先关闭代理窗口，再在原密码管理器查找已有凭证；明确不重新生成或更换。当前等待关闭及找回结果，**尚未确认代理停止**；后续预算仍需同账本 check 核验，不以先前 0／0 冒充后续状态。
- 当前没有手机 health 或新模型调用成功证据；不得称手机已接通。文档独立 review 无 P0/P1；证书建议时长与实际生成时长差异为 P3，不影响每次重新配对及两小时会话边界。

## 历史阶段：原凭证找回与同账本重开

用户已找回原个人访问凭证，并确认关闭旧代理窗口。原会话 47841 exit 0；Root 通过只读 `.NET GetActiveTcpListeners` 核对端口 8765 活动监听为 0，无残留监听。随后正式 check 核对同一 ledger ID，仍为 attempts=0、reservedMicroCny=0，未增加认领。

Root 使用 `-STA -RunProxy -CnyAccountConfirmed` 重开，**未带 `-InitializePhoneLedger`**；新会话 67510 输出 `PHONE_PROXY_PRIVATE_INPUT_READY NO_MODEL_REQUEST_STARTED`。随后第二窗口输出 `PHONE_PROXY_READY`，地址仍为 `https://10.251.239.59:8765/translate`；Root stdout 与用户回报一致，已生成新的证书指纹，旧窗口指纹不能沿用。会话有效期至 `2026-11-13T07:35:38.971Z`，就绪帧预算为 0／20 次、0 预留。没有自动生成或更换 Bearer，没有模型请求证据。已指导手机选择临时电脑 DeepSeek 模式，填写本次 URL／新 pin／原 Bearer（不是供应商 API Key），先点击不调用模型的 health 检查；当前手机 health 待测。两次 READY 只证明相应临时监听，不证明 token／Key 有效或手机已接通。短交接暂保留上一阶段入口，实际执行状态以本主证据的后续记录为准。

## 同轮真机回报：health 成功

用户明确回报：手机填写第二窗口的新 URL／新指纹／原 Bearer 后，点击“检查连接（不调用模型）”成功，显示预算及剩余次数。这是**用户本人手机实际操作回报**，不是 ADB 自动观察；可确认本次手机 health 路径成功，不能据此认定供应商 Key、官方网络或模型翻译通过。

当前已引导将新 pin 首位从 `c` 改成 `d`，确认连接检查失败，再恢复正确首位 `c` 确认成功。这两次仅 health、不请求模型，错误 pin 的拒绝及恢复结果仍等待用户回报。真实短文翻译与模型质量也尚无结果；此前“手机 health 待测”是早于本段的阶段记录。

## 同轮真机回报：错误 pin 拒绝与首次中文翻译

- 用户回报：将新 pin 首位 `c` 改为 `d` 后连接检查失败，恢复 `c` 后成功。结合此前 health 成功回报，本次本人手机的正确／错误指纹路径得到人工验证；不是 ADB 自动观察。
- 随后只提交一次 Leader 提供的公开合成短文：“今天我坐在窗边读书，想把这个小工具慢慢做好。Keep it simple.”。用户明确回报“翻译成功，原英文保留”。未取得完整译文，不能宣称自然度或全文质量已独立评估。
- Root 随后正式 check exit 0，核对同一 ledger：attempts=1、reservedMicroCny=150000、remainingAttempts=19、remainingReserveMicroCny=2850000。用户手机回报与电脑持久账本共同支持本次真实中文翻译链路累计一次尝试；¥0.15 是预留，**不是平台实际扣费**。
- 当前正在引导纯英文 `Keep it simple.` 本地原样展示，等待用户回报及同账本计数不增的复核。1001 码点手机提示、断网、双击／取消及完整质量仍未测；此前“无模型成功结果”是更早阶段记录。
- 服务会话 67510 当前仍运行，截止 `2026-11-13T07:35:38.971Z`（北京时间 15:35:38）；仍仅本人临时演示。本轮未修改防火墙、系统证书库、Cloudflare 或 Azure。状态继续 **human_acceptance_required**，不是 accepted。

## 同轮收口：纯英文本地旁路

用户回报纯英文 `Keep it simple.` 原样显示；Root 随后正式 check 再核对同一账本，仍为 attempts=1、reservedMicroCny=150000、remainingAttempts=19、remainingReserveMicroCny=2850000，计数及预留均未增加。本次纯英文的本地展示与零新增认领已获用户回报＋电脑账本复核支持。

本轮成立范围：本人手机 health、错误 pin 拒绝／恢复、一条中文真实翻译及原英文保留（用户回报）、纯英文本地旁路不增预算。尚未完成自然度独立评估、1001 码点手机提示、断网、双击／取消及全流程人工验收。窗口仍运行，不写成已停止；保留账本，后续关闭、到期或继续须按原有限额，不新增额度。最终状态 **human_acceptance_required**。用户要求最小任务完成即停止工作；本次最小功能验证已完成，不再新增改动、测试或请求。代理窗口按本人试用保持运行，最多两小时自动截止。

## 文档检查

本轮做受影响文档的内部链接、owner 归属、授权与状态检查；最终 16 份受影响文档相对链接目标检查 0 缺失。构建、单元测试、Lint、真机与人工验收分开记录。后续实际评审／网络结果追加此页，不覆盖旧试验记录。
