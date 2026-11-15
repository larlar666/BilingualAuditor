# 技术可行性初评

核查日期：2026-10-21。状态：公开资料核查及本机环境盘点；没有创建云资源、注册付费服务、接入 SDK 或完成设备测试。本文推荐是技术建议，不新增用户决策，也不改变 D01～D08。

时效说明（2026-11-03）：§1～§5 为当时的初评快照，费用/许可/版本条件不自动沿用。§1 的“无工程/无入口”等已被后续开发取代；当前实现查 [current-state](../../docs/product/current-state.md) 和 [ARCHITECTURE](../../ARCHITECTURE.md)，历史构建查 [verification-history](../../docs/evidence/verification-history.md)。下方新增 [2026-11-06 翻译接入复核](#2026-11-06-翻译接入复核)；未重核领域仍保留历史状态，本文不作为法务批准证明。

## 2026-11-06 翻译接入复核

核查范围：Leader 本轮读取的官方公开资料。用户已批准优先验证 Azure Translator F0＋Cloudflare Workers Free，决定见 [D09](decisions.md)，实施与待测进度见 [active plan](../../docs/plans/active/translation-integration.md)。这不是账户开通、部署或真实翻译成功证明；§1～§5 仍是 2026-10-21 历史快照。

| 项目 | 本轮公开证据 | 接入边界 |
| --- | --- | --- |
| Azure Translator F0 | [定价](https://azure.microsoft.com/en-us/pricing/details/translator/)：每月 200 万字符；[服务限制](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)：文本请求合计最多 50,000 字符，F0 每小时 200 万为吞吐限制 | 月免费额度与小时吞吐不混同；只验证 F0，不自动改 S1 |
| 字符计数 | [FAQ](https://learn.microsoft.com/en-us/azure/ai-services/translator/faq)：空白、标点、markup 和重复提交均计入；页面同时描述 Unicode 码点及代理对例外 | 产品 10,000 码点与计费预算分开；预算按实际 payload 保守估算，包含保护标记并核对请求上限 |
| 原英文保护 | [官方防翻译说明](https://learn.microsoft.com/en-gb/azure/ai-services/translator/text-translation/how-to/prevent-translation)：`textType=html` 可使用 `notranslate`/`translate="no"` | 标记能力不证明已完整满足 D10；需转义、解析、还原/核验及真实样本，失败应明确报错 |
| 错误 | [响应码](https://learn.microsoft.com/en-gb/azure/ai-services/translator/text-translation/reference/status-response-codes)：403001 为免费额度耗尽，429 为请求限流 | 区分额度、频率、授权、超时与上游失败；不通过真实耗尽额度测试 |
| Workers Free | [限制](https://developers.cloudflare.com/workers/platform/limits/)：每日 100,000 请求、每次 10 ms CPU；[产品页](https://www.cloudflare.com/products/workers/)：免费起步无需信用卡 | 账户实际计划与手机到部署域名的可达性仍需核验；这是代理托管，不是翻译服务 |
| D1 Free | [定价](https://developers.cloudflare.com/d1/platform/pricing/)：每日读 500 万行、写 100,000 行、总存储 5 GB；超限停止对应查询 | 免费层仍有独立限制；条件更新的原子性与并发预留必须按实际存储测试，不能靠 pricing 页面推导实现正确 |
| Azure 账户 | [学生计划](https://azure.microsoft.com/en-us/free/students/)：有全日制大学生资格要求、无需信用卡并按资格续期；[普通账户说明](https://azure.microsoft.com/en-us/free/free-account-faq/) 跳转到账户选项，普通免费试用涉及 30 天/$200 及后续转按量计费条件 | 用户表示可验证学生身份；实际订阅、F0 可创建及续期未证实，不自动启用按量付费 |
| 隐私与保存 | [No Trace](https://www.microsoft.com/en-us/translator/business/notrace/)：文本翻译输入不写入持久存储、不用于训练，翻译不改变原有知识产权归属 | 不代表代理日志天然无文本，也不代表保存、备份及分发的全部适用条款已核验 |
| DeepL 比较项 | [现行 API 计划](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans)：API Free 不再供新购，Developer 为合计 100 万字符试用额度 | 不把旧每月 50 万的 Free 条件推荐给新账户；本轮不作为首选 |

本轮批准先做本人试用的受控链路：运行时访问凭证、服务密钥仅后端 secret、服务端校验、持久原子预算和明确失败。账户、免费计划、手机网络、真实译文效果及 D10 尚须直接验证；保存/文件夹后置，多用户分享前再验证个人配额与授权撤销边界。本轮复核未重新评估词典或 FSRS，也未批准发布。

## 1. 首次检查快照（2026-10-21，非当前状态）

- 实际工作区为 `C:\Users\a1234\Documents\BilingualAuditor`，不是交接中的 Linux 路径。
- 三份原文档位于 `BilingualAuditor-docs/docs/`，已逐一阅读。保留原位置，根 README 提供入口。
- 本地 `main` 尚无提交；配置了 `origin` 指向 `larlar666/BilingualAuditor`。本地跟踪显示 `origin/main [gone]`，本次没有 fetch，不能据此断言当前远程仍为空。
- 当前工作区未发现 AGENTS.md、应用代码、Gradle 构建脚本或 wrapper。
- `java -version` 成功：Liberica OpenJDK 21.0.6；javac 命令存在，但未编译项目。
- 默认 SDK 目录存在，包含 platform-tools、cmdline-tools/latest、platforms/android-35、build-tools/35.0.1 和 licenses。目录存在不等于组件完整或许可证已核验。
- 用户 Gradle 缓存有 8.10.2 分发目录，尚未运行或验证依赖缓存。没有 PATH 中的 gradle/adb；JAVA_HOME 已设置，ANDROID_HOME 未设置。
- 常见路径 `C:\Program Files\Android\Android Studio` 不存在；没有做全盘安装搜索，不能断言未安装 Android Studio。
- 使用 SDK 内 adb 执行 `devices -l` 失败：`Cannot mkdir '\.android': Permission denied`。没有获得设备列表，不能判断手机是否连接。下次先检查 adb 用户目录与进程环境，再重试；本次没有改系统环境变量。

## 2. 在线翻译与后端

### 候选对比

| 候选 | 官方资料确认的条件 | 本项目建议 |
| --- | --- | --- |
| Azure Translator F0 | 每月 200 万字符；免费额度耗尽有专门错误码 403001；另有速率限制 | 优先做账户与网络可用性验证；只选择明确的 F0 资源，不自动改 S1 |
| Google Cloud Translation NMT | 每月前 50 万字符通过抵扣额度免费；使用 API 必须启用 billing，超出部分计费 | 当前不作为默认方案，免费抵扣不等于硬性零费用 |
| Cloudflare Workers Free（后端候选） | 每日 10 万请求，UTC 零点重置，CPU 每次 10 ms；超过日请求上限报 1027 | 适合优先验证轻量翻译代理，但不是翻译服务本身；附加存储另核额度 |

Azure 月额度和每小时吞吐限制是两个概念：每月 200 万字符免费，不是每小时都能重新获得免费字符。仅发送中文到英文一个目标语言；重复提交、空格和字符统计规则应在接入时按服务文档确认。

来源：[Azure 定价](https://azure.microsoft.com/en-us/pricing/details/translator/)、[Azure 限流](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)、[Azure 错误码](https://learn.microsoft.com/en-gb/azure/ai-services/translator/text-translation/reference/status-response-codes)、[Google 定价](https://cloud.google.com/products/translate/pricing)、[Google billing 前提](https://docs.cloud.google.com/translate/docs/setup)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)。

### 建议验证结构

`Android → HTTPS 受控后端 → Translator`。后端保护服务商密钥，调用者仍需单独授权，不能把后端 URL 当成访问控制。

- 服务商长期密钥仅保存为后端 secret；不进 APK、Git、备份或日志。
- 小范围分享可先采用逐人发放、可撤销的访问凭证，运行时录入并保存在设备私有存储；不使用所有 APK 通用的硬编码口令。具体授权方式在实现时确定。
- 后端校验输入长度，限制每个凭证的请求频率和字符数，并设置全局字符预算；必须在调用上游前预留额度，防止并发突破总量。
- 全局预算不能只依赖进程内计数或最终一致的缓存。若采用 D1 等持久计数，需单独核免费配额及事务行为，当前尚未完成这部分设计。
- 不记录原文、译文或凭证；不默认在后端保留阅读历史。错误需区分额度耗尽、请求过快、授权失败、断网和服务故障。
- 费用警报不是硬限额。部署前核对实际账户的 Workers Free 与 Translator F0、附加产品及账单配置；不自动升级付费计划。

### 尚未核实，作为接入前门槛

- 用户账户是否能开通对应 F0、地区可用性、订阅存续条件、实名认证/绑卡要求；本次没有进入账户控制台。
- vivo 及其他试用者网络能否稳定连接部署域名，不能根据可使用 Google Play 推断。
- Azure 翻译结果长期保存在历史、随用户备份及小范围分发应用的适用条款；价格表不能替代数据使用条款核查。
- 实测 10 段不同长度中文的译文质量与响应时间；模拟 403001、429、超时、断网时保留原文；不通过真实耗尽额度来测试。

因此：Azure F0 + Workers Free 是优先验证组合，不是已经开通或已确定可用于发布的方案。

## 3. 词典与数据许可

| 数据源 | 查到的证据 | 结论与下一步 |
| --- | --- | --- |
| Oxford Dictionaries API | 官方 FAQ：缓存、保存及离线使用仅允许 Enterprise 许可；Sandbox 为 500 次、限首字母范围 | 不适合当前免费额度与离线保存需求，暂不接入；本次未验证英中覆盖 |
| ECDICT | 提供英中/英英释义与词频等字段；仓库 LICENSE 为 MIT，但 README 说明混合了多个来源及抓取资料 | 可作为本地词库候选；尚未确认所有上游数据的许可链，不直接打包发布 |

来源：[Oxford FAQ](https://developer.oxforddictionaries.com/faq)、[ECDICT README](https://github.com/skywind3000/ECDICT)、[ECDICT LICENSE](https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE)。

许可证核查需分别覆盖：词典程序、释义数据、例句、音频、词频及词形表。仓库有 MIT 标签不自动证明第三方资料都可重新授权。当前没有选定可发布词库，也没有下载或分发数据。

下一步按候选具体版本记录来源和署名要求，核实本地保存、提取到词卡、APK 分发、用户导出备份和未来商业使用；再抽查常见词、变形词、多义词及专有词。验证阶段可用自编释义的小样本完成存储流程，清楚标为测试数据，不伪装成词典结果。

## 4. FSRS 库

| 候选 | 公开证据 | 当前判断 |
| --- | --- | --- |
| open-spaced-repetition/FSRS-Kotlin | README 声明 FSRS-6、MIT；源码引用 `app.arteh.flashcard.db.FlashCard` 等业务类，并依赖 Android/Compose | 组织收录不等于可直接添加的成熟依赖；需补齐模型、构建与参考向量验证，暂不选定 |
| open-spaced-repetition/rs-fsrs-java | Rust 调度器的 Java binding；官方实现清单将其归为 v5 | 不能因为 Java 可被 Kotlin 调用就假定兼容 Android；需查 native 装载、ABI、许可证与打包，暂作备选 |
| TheRockYT/FsrsKt | Kotlin Multiplatform、声明 FSRS-6，仓库标注 GPL-3.0 | 后续须核查分发义务与项目许可证选择，不静默引入 |
| jwbargsten/fsrs4s | Scala 3 FSRS-6、Apache-2.0，README 提供依赖和测试命令 | 增加 Scala 运行库与 Android 兼容验证成本，暂作备选 |

来源：[实现清单](https://github.com/open-spaced-repetition/awesome-fsrs)、[FSRS-Kotlin](https://github.com/open-spaced-repetition/FSRS-Kotlin)、[实际源码](https://raw.githubusercontent.com/open-spaced-repetition/FSRS-Kotlin/main/FSRS.kt)、[Java binding](https://github.com/open-spaced-repetition/rs-fsrs-java)、[FsrsKt](https://github.com/TheRockYT/FsrsKt)、[fsrs4s](https://github.com/jwbargsten/fsrs4s)。

本轮完成候选筛选，未完成成熟库选定。尚未固定 commit/release、解析依赖、运行库测试或验证 Android，因此不能声称 FSRS 已可用。后续优先寻找独立 JVM/Kotlin 调度库；不为追求最新版本而直接重写公式。

选库门槛：固定版本与许可证；独立构建；四档评分；新卡、同日复习、遗忘/重学、长间隔参考向量；固定时钟、关闭或固定随机扰动进行可复现对照；持久化后恢复得到一致调度；Android 构建与设备离线调用通过。可对照 [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) 的匹配算法版本，不能跨版本直接比较预期值。

保存内容由库的数据模型最终确定，至少覆盖稳定性、难度、卡片阶段、到期与上次复习时间、学习步骤等库所需状态，以及全部评分事件、算法/库版本、参数、目标保留率和调度选项。时间以明确时区语义保存，界面再换算本地时间。不要只保存 due。

## 5. 下一个小任务：输入与系统 TTS 最小工程

不依赖云账户或词典先启动此任务。Kotlin + Compose 作为工程默认方向；先核对 AGP/Kotlin/Gradle/JDK 兼容矩阵并固定版本，不根据缓存猜可用。Room、DataStore、FSRS 分后续步骤接入。

验收分层：

1. 工程层：Gradle wrapper、最小应用、多行中文输入与独立英文试听样例；无翻译服务时明确标记样例，避免误以为是译文。
2. 构建层：实际执行 assembleDebug 和适当静态检查，记录命令、版本和结果；失败如实报告。
3. 功能层：TTS 初始化期间禁用播放；检测中/英语言及美/英可用声音；停止、切换文本、离开页面释放资源；没有匹配声音时明确提示，不静默换口音。
4. 设备层：先修复 adb 环境再检测手机，分别试中/美/英、长文本及停止；记录引擎和 voice 标识。断网测试仅在本地语音数据就绪后进行，不承诺所有引擎离线。

当前以上均为计划，应用实现、构建与真机验收均未开始。
