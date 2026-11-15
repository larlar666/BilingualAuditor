# 质量与验证状态

核对日期：2026-11-13。职责：按证据强度记录质量，不编造百分比分数。各行已有检查保留其证据日期，本次文档编辑未重跑 Android 检查；下表手机热点项来自 Leader 提供的本轮检查，历史翻译项仍保留其日期与范围。命令/产物见 [翻译本地验证](evidence/translation-local-validation-2026-11-06.md)，历史结果见 [verification-history](evidence/verification-history.md)，实现范围见 [current-state](product/current-state.md)。

| 领域 | 已有证据 | 缺口/下一验证 |
| --- | --- | --- |
| 手机热点 Android（11-13） | assembleDebug 成功；JUnit 26/26；Lint 0 错误／6 警告；独立 Android review 无 P0/P1；APK 指纹见 [主证据](evidence/deepseek-phone-hotspot-demo.md) | 受限自签 TrustManager 警告需审查；health 的 org.json 非 JVM 实跑，真机 TLS／UI 未验证 |
| 手机热点后端／启动器（11-13） | Leader 报告后端离线 16/16 exit 0、launcher SelfTest 通过，见同一主证据 | fresh 安全独立评审与 STOP 枚举小修复核通过；第二窗口已 READY；用户回报手机 health／错误 pin／恢复及一条中文翻译成功，Root 同账本 check 为 1 次／150000 微元预留；纯英文用户回报原样显示且 Root check 仍 1 次／150000 微元，未增认领。不是平台扣费证明，自然度及其余手机边界待验 |
| TXT 解析 | 本轮 JUnit XML：7 项通过 | 不是 ContentResolver/UI/手机导入链路通过 |
| Android 构建 | 本轮 assembleDebug 成功，APK 指纹见验证记录 | 未绑定提交；不证明其它机器或真机通过 |
| 翻译长度与 ViewModel | 本轮 Policy 5 项、ViewModel 9 项通过；与解析合计 21 项，0 失败/错误/跳过 | fake 客户端，不证明真实 HTTPS/Azure 或触摸交互 |
| Lint | 本轮 XML：0 错误、5 警告 | DataExtractionRules 1 项与 GradleDependency 4 项仍在；不是安全审计 |
| 代理保护、错误与预算 | 本轮 Node 14/14，含独立 SQLite 并发；补充 Wrangler 4.158.0 dry-run、本地 migration 与 Miniflare/workerd 真实本地 D1 binding 预留/拒绝检查，见 [续核证据](evidence/translation-local-validation-2026-11-06.md#2026-11-06-补充部署工具与本地-d1) | 假 Azure；handler 在 Node 执行，不是远端 Cloudflare D1、Worker 部署、完整运行时或 Workers CPU 证明 |
| 临时安全诊断 | 11-08 新增后 Node 17/17、parser 零错误、三种工具 SelfTest exit 0；fresh evaluator preGate pass；11-11 重核 parser 与单次诊断 SelfTest，并执行唯一短中文诊断，见 [诊断证据](evidence/translation-live-configuration-audit.md#2026-11-11-授权恢复与单次诊断结果) | 中文返回 `transport` 分类；双开关关闭、恢复生产 100% 已独立核验，不证明上游具体原因、Azure 到达/计费或真实翻译成功 |
| 慢页面授权辅助 | 临时十分钟等待工具的语法、自测、版本、哈希与清理检查通过，独立 preGate pass；11-11 正式登录 exit 0，临时副本清理且原安装哈希未变，见同一诊断证据 | 只延长本机等待，未改 state/PKCE、权限或官方有效期；浏览器授权成功不是 Worker 到 Azure 传输成功 |
| Workers 重定向兼容性 | `manual` 加正文解析前拒绝 300–399；Node 18/18、真实 workerd 正常假上游 200 与七类 3xx 拒绝/目标调用 0，独立 preGate 通过，见[本地修复证据](evidence/translation-live-configuration-audit.md#2026-11-12-并行试验与本机直连) | 外网/Azure 调用 0；11-12 部署认证失败，不能称修复上线 |
| Azure 本机直连 | 工具 parser 零错误、无网络 SelfTest exit 0、独立 preGate 通过；一次真实短中文取得 HTTP 401，见同一主证据 | 无成功译文，输入凭证来源未确认；Azure 已人工暂停，不自动重试 |
| DeepSeek 固定短样本 | Fresh evaluator 独立 Node 13 项及真实 workerd 回环 1 项合计 14 项通过；工具自测与官方资产 token 只读复算一致，既有 Worker/D1 离线方案 preGate pass；范围见[计划](plans/active/deepseek-translation-trial.md)，计量证据见[预算证据](evidence/deepseek-token-budget-audit.md) | 不涵盖新增本机 SQLite 模式或收费 Gate；未部署/apply、未上传 Key、无付费请求、手机未验 |
| DeepSeek 本机直连 | 11-13 本机及输出帧修复 preGate 通过；四个真实固定样本均 HTTP 200、原英文恢复检查通过，工具 exit 0，独立只读核验同一账本四次认领／无剩余，见[本机记录](evidence/deepseek-local-trial.md) | 本轮额度已用完。峰值价估算不是平台账单；输出存在边界双空格和中文句号，自然度、手机与长文未人工验收，不得重置或追加请求 |
| 导入/编辑/键盘/旋转 | 实现及手机测试清单 | 无收到的真机结果或 UI 自动测试 |
| 图标 | 资源/脚本，历史 clean/build/lint 和 aapt2 检查 | 本次未新看视觉；圆角/圆形/单色主题待真机 |
| 真实翻译与手机网络 | D1 远端 apply 与 Worker 初步 deploy 已有 [证据](evidence/translation-cloudflare-connection.md)；11-08 原凭证复测无鉴权/超长/纯英文通过，中文上游失败后恢复空 guard，见 [复测结果](evidence/translation-live-configuration-audit.md#2026-11-08-原凭证复测结果) | 无成功中文译文，Azure 到达/计费与上游失败原因未知；实际免费条件、真实 D10 和本人手机仍待验证 |
| TTS/查词/FSRS/历史备份 | 已确认规格与候选初评 | 未实现，不能标为通过 |
| 工作流与知识库 | 安装历史证据；本轮文档检查另记 | 不证明用户已验收工作流，不自动启动 Team Loop |
| 发布/人工验收 | 未获得直接确认 | 构建文件不是上架/发布证明 |

解析修改先检查 [TxtReaderTest](../app/src/test/java/com/bilingualauditor/app/TxtReaderTest.kt)，UI/导入状态还需 [手机清单](../BilingualAuditor-docs/docs/manual-test-01.md)。按本机 SDK 设置后使用既有 [development](../BilingualAuditor-docs/docs/development.md) 命令：

```powershell
.\gradlew.bat :app:assembleDebug --console=plain --no-daemon --max-workers=2
.\gradlew.bat :app:testDebugUnitTest --console=plain --no-daemon --max-workers=2
.\gradlew.bat :app:lintDebug --console=plain --no-daemon --max-workers=2
```

每次报告日期、源码/产物版本、命令和退出结果、实际覆盖及未测项。纯文档变更做链接/归属/状态/范围检查，不重复跑全量 Android 构建。通过后仅因新改动、失败或未决风险扩大/重跑相关检查。

提交/发布前核版本、范围、对应版本的自动/真机结果、风险与人工确认。当前多个 debug APK 共用版本号，禁止将一个产物的结果自动套给另一个。
