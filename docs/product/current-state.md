# 当前实现状态

核对日期：2026-11-13。职责：当前实现范围的 canonical owner；产品意图在 [规格](../product-specs/index.md)，历史执行过程在 [progress](../../BilingualAuditor-docs/docs/progress.md)，验证强度在 [QUALITY_SCORE](../QUALITY_SCORE.md)。本页不是人工验收记录。

| 领域 | 本次代码核对结果 | 不应误判 |
| --- | --- | --- |
| TXT 导入与编辑 | 单页面、系统选文件、UTF-8 中文/英文/混合文本、原文编辑、替换确认、读取错误提示 | 输入和大小上限是实现配置；不是所有设备已通过 |
| 翻译 | Android HTTPS 客户端、内存试用配置、原译文显示、请求失效隔离与安全错误提示已有代码；纯英文原样展示免请求；独立 10,000 码点业务限制与超限弹窗 | 2026-11-07 D1 已远端 apply、Worker 已初步 deploy（[证据](../evidence/translation-cloudflare-connection.md)）；原凭证复测已运行，无鉴权/超长/纯英文用例通过，中文上游失败后恢复空 guard（[复测证据](../evidence/translation-live-configuration-audit.md#2026-11-08-原凭证复测结果)）；无本人手机翻译成功证据，D10 仍需实测 |
| Azure 翻译代理与排查工具 | Worker 鉴权、英文 HTML 保护、D1 预算和安全枚举诊断已有实现，诊断有历史部署证据；单次复用与本机直连工具已实现；重定向兼容性修复已本地通过 | Azure 已由用户人工暂停；直连 401 与凭证来源未确认见[主证据](../evidence/translation-live-configuration-audit.md#2026-11-12-并行试验与本机直连)。兼容性修复未成功部署，11-11 双开关恢复不代表 11-12 重新核验；本机工具不属于已部署服务 |
| DeepSeek 手机热点演示 | App 临时电脑模式、leaf DER pin、health 与 1000 码点限制；新本机 HTTPS 代理、SQLite ¥3／20 次及掩码启动器已有代码 | 当前主线，已有自动检查不能代替真机；独立评审已通过；用户真机回报 health 成功、错误 pin 拒绝及恢复成功、一条中文翻译成功且原英文保留；同账本核对累计 1 次／¥0.15 预留。纯英文原样显示且同账本计数不增；自然度未独立评估，其余手机边界待验，见 [计划](../plans/active/deepseek-phone-hotspot-demo.md)／[主证据](../evidence/deepseek-phone-hotspot-demo.md)；不是云部署、多用户或长期服务 |
| DeepSeek 短样本试验 | 独立适配器、原英文保护、四样本/固定 ¥1 预算、私密工具和本地计量证明已有代码或产物，既有 Worker/D1 离线方案独立 preGate 通过 | 当前本机四固定样本真实请求均 HTTP 200、英文恢复检查通过；原账本已认领四次且无剩余额度，工具已退出。本轮不再请求或重置，停在 human_acceptance_required；云端 Worker/D1 未部署或 apply、Key 未上传 Cloudflare。真实输出含保护边界双空格和中文句号，自然度待人工；范围和启用门槛见[独立计划](../plans/active/deepseek-translation-trial.md)，不是通用长文或手机能力已成立 |
| 图标 | Manifest 引用自适应 XML，背景/前景/单色层与生成脚本存在 | 资源、历史 APK 检查与真机显示是不同证据 |
| 草稿/历史/单词本/设置 | 原文、译文和试用配置只在 ViewModel 内存中，无 App 持久化实现 | 保存历史和学习进度的需求仍有效；试用配置不等于文段保存 |
| TTS、词典、推荐词、FSRS、备份恢复 | 未发现对应代码或依赖 | Kotlin/Compose/ViewModel 已使用；Room/DataStore 等仍是候选 |
| 分享/选词菜单/原子岛 | 未注册对应接收逻辑 | 可行性讨论不是已实现入口或厂商适配成功 |

当前可本地检查导入/编辑、翻译长度与状态流，以及两条代理的预算和保护逻辑。当前主线为另行批准的 [DeepSeek 手机热点演示](../plans/active/deepseek-phone-hotspot-demo.md)，停在 human_acceptance_required；旧四样本额度已用完且不重置，其质量判断继续保留。新 ¥3／20 次与旧试验独立；Azure 保持暂停，不因服务配置或旧授权自动恢复请求。后续本人手机验证仍按对应计划与 [开发验收方法](../../BilingualAuditor-docs/docs/development.md) 另行完成；原有 [导入手机清单](../../BilingualAuditor-docs/docs/manual-test-01.md) 的人工缺口继续保留。保存与文件夹不在首轮实现中。

本轮代码核对与验证结果按 [QUALITY_SCORE](../QUALITY_SCORE.md) 分层记录；历史结果及版本关联限制统一查 [verification-history](../evidence/verification-history.md)。D1 远端 apply 与 Worker 初步部署已有直接证据；真实 Azure 翻译、真机功能、人工验收和正式发布均未获得确认。

2026-11-15 用户要求将当前进度提交至 `larlar666/BilingualAuditor`；提交前 `git ls-remote origin` 成功且未返回 refs。用户明确选择只提交主项目，独立上游 `codex-teammode-workflow/` 及其中两处本地修改保留本机并由根 `.gitignore` 排除；已安装的项目工作流文件仍随主项目保存。提交和推送结果以 Git 历史及远程 refs 为准。APK 是开发 debug 产物，不视作正式 release；旧验证不能追溯绑定本次首次提交，后续测试需绑定版本/产物。
