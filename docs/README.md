# BilingualAuditor 文档地图

更新时间：2026-11-03。先按任务找材料，再逐步读取。入口不复制产品正文，也不启动工作流。

<!-- codex-teammode:managed:start scope=docs-index version=0.3.1 -->

## 工作流入口

仅在用户明确要求 `@team-loop`、Team Loop / teamloop 或 Leader 调度子代理时启用 Team Loop。安装、讨论或编辑规则不构成触发；未触发时不增加轮次、schema、启动检查或子代理调度。

- 完整规范：[team-loop.md](workflow/team-loop.md)
- 子代理核心合同：[team-loop-core.md](workflow/team-loop-core.md)
- 角色：[Leader](workflow/team-loop-roles/leader.md)、[Planner](workflow/team-loop-roles/planner.md)、[Generator](workflow/team-loop-roles/generator.md)、[Scout](workflow/team-loop-roles/scout.md)、[Evaluator](workflow/team-loop-roles/evaluator.md)
- 触发后的根因审计：[audit-first.md](../workflow/audit-first.md)
- 文档增量维护：[docs-maintenance.md](workflow/docs-maintenance.md)
- 后续升级：[update-policy.md](workflow/update-policy.md)

实现事实以 current code 为先；业务意图以明确人工决定或 canonical contract 为准；部署、人工验收、法务和发布分别需要直接证据。handoff 是短导读，不能替代专题资料。每条事实保留一个主落点，其余位置链接引用。

<!-- codex-teammode:managed:end -->

## 默认阅读与事实权限

新会话：[AGENTS](../AGENTS.md) → 本索引 → [当前状态](product/current-state.md) / [短交接](handoff/latest.md) → 本轮专题 → 当前代码。只读当前任务必需内容，不先跑全量 docs 或重读全部聊天。

[PLANS](PLANS.md) 的 owner 表区分“应该怎样、为何如此、实际怎样、准备怎么做、怎么知道”。当前实现核代码，人工决定核 [decisions](../BilingualAuditor-docs/docs/decisions.md)，部署/法务/人工验收/发布必须另有直接证据。日期较早的观察和技术初评不自动代表现在。

## 按任务阅读路径

| 任务 | 渐进式路径（先合同/设计，再代码/证据） |
| --- | --- |
| 恢复上下文 | [current-state](product/current-state.md) → [handoff](handoff/latest.md) → 本轮专题；历史过程按需看 [progress](../BilingualAuditor-docs/docs/progress.md) |
| TXT 导入/编辑 | [规格索引](product-specs/index.md) → [ARCHITECTURE](../ARCHITECTURE.md) / [FRONTEND](FRONTEND.md) / [边界](architecture/domain-boundaries.md) → [MainActivity](../app/src/main/java/com/bilingualauditor/app/MainActivity.kt)、[ViewModel](../app/src/main/java/com/bilingualauditor/app/ReaderViewModel.kt)、[TxtReader](../app/src/main/java/com/bilingualauditor/app/TxtReader.kt)、[解析测试](../app/src/test/java/com/bilingualauditor/app/TxtReaderTest.kt) → [手机清单](../BilingualAuditor-docs/docs/manual-test-01.md) |
| 接翻译/TTS/查词/复习 | [规格索引](product-specs/index.md) → [设计索引](design-docs/index.md) / [决定](../BilingualAuditor-docs/docs/decisions.md) / [历史初评](../BilingualAuditor-docs/docs/technical-evaluation.md) → [SECURITY](SECURITY.md) / [RELIABILITY](RELIABILITY.md) → [active plans](plans/active/README.md) → 对应代码（尚无集成模块时先核现状） |
| 修改应用图标 | [DESIGN](DESIGN.md) → [生成脚本](../tools/generate-app-icon.ps1)、[原图](../output/imagegen/bilingual-app-icon-refined.png)、[Manifest](../app/src/main/AndroidManifest.xml)、[adaptive XML](../app/src/main/res/mipmap-anydpi/ic_launcher.xml) → [历史证据](evidence/verification-history.md) / [QUALITY_SCORE](QUALITY_SCORE.md) 中真机缺口 |
| 修 bug | [可靠性/复现格式](RELIABILITY.md) → [规格](product-specs/index.md) / [架构](../ARCHITECTURE.md) → 相关实现 → [验证方法](QUALITY_SCORE.md)；明确触发 Team Loop 且根因未锁时才进入其 audit-first 协议 |
| 发布/验收 | [已实现范围](product/current-state.md) → [质量状态](QUALITY_SCORE.md) / [版本证据](evidence/verification-history.md) → [遗留风险](plans/tech-debt.md) / [安全](SECURITY.md) → 人工确认；当前没有发布/真机通过证明 |
| 普通文档/计划维护 | [PLANS](PLANS.md) → 对应 owner；[active](plans/active/README.md) / [completed](plans/completed/README.md) / [tech-debt](plans/tech-debt.md) |
| 开发困难／排查经验 | [困难记录](development-difficulties.md) → 条目链接的专题证据；新增和更新按 [记录规则](PLANS.md#困难记录) |
| 产品取舍 | [PRODUCT_SENSE](PRODUCT_SENSE.md) → [规格](../BilingualAuditor-docs/docs/product.md) / [决定](../BilingualAuditor-docs/docs/decisions.md)；不要把候选或代码现状当作用户决定 |
| 显式 Team Loop / workflow 升级 | 上方 managed block 中的工作流入口；本次知识库 bootstrap 不启动或升级它 |

## 目录映射与不适用项

| 文章示例职责 | 本项目实际落点 | 所有权说明 |
| --- | --- | --- |
| 短入口/架构 | AGENTS / CLAUDE 与根 ARCHITECTURE | managed block 原样保留；只压缩项目外层规则；[旧 system-map](architecture/system-map.md) 保留为兼容入口 |
| design-docs | [design-docs/index](design-docs/index.md)、[core-beliefs](design-docs/core-beliefs.md)、原 decisions | 原则/决定与实现分离 |
| product-specs | [product-specs/index](product-specs/index.md) → 原 product | 保留已有规格正文，不复制或强行搬迁 |
| exec-plans | 现有 docs/plans/active、completed、tech-debt | 不再建 exec-plans 双轨；未虚构活跃/完成业务计划 |
| generated | 暂不创建该目录 | 尚无数据库/schema/部署描述的真实生成源；已有图标生成物在 output/imagegen 和 app/res |
| references | [references](references/README.md) | 真实来源、版本和核查时点；外部费用/许可实施前复核 |
| 状态/证据/交接 | [current-state](product/current-state.md)、[evidence](evidence/README.md)、[latest](handoff/latest.md) | 原 progress 保留带日期历史，不作为并行当前状态 owner |
| UI/质量/安全等指南 | DESIGN、FRONTEND、PLANS、PRODUCT_SENSE、QUALITY_SCORE、RELIABILITY、SECURITY | 有实际内容，未接入领域明确边界，不堆假 schema/部署文件 |

原 `BilingualAuditor-docs/docs/` 原位保留。完整 owner 和维护触发见 [PLANS](PLANS.md)，技术候选当前状态见 [active-directions](product/active-directions.md)。知识维护由后续任务执行，不承诺后台自动读取未来聊天。

## 验证与来源

项目命令/环境方法保留在 [development](../BilingualAuditor-docs/docs/development.md)，检查层次见 [QUALITY_SCORE](QUALITY_SCORE.md)。本次只做文档静态检查，不把 2026-10-21 历史结果写成本轮通过。

[本轮知识库记录](evidence/knowledge-bootstrap-2026-11-03.md) · [三个聊天回顾](evidence/chat-review-2026-11-03.md) · [历史验证](evidence/verification-history.md) · [参考来源](references/README.md)。工作流版本出处仍为 [原安装记录](evidence/workflow-bootstrap-install.md) 和 [原 marker](workflow/.codex-teammode-version)；本次不刷新安装基线，可选 docs-review skill 未运行。

本轮本人手机热点演示：[已批准计划](plans/active/deepseek-phone-hotspot-demo.md) → [逐步操作指南](guides/deepseek-phone-hotspot-demo.md) → [主证据](evidence/deepseek-phone-hotspot-demo.md)。旧四样本预算已用完且不重置，Azure 仍暂停。
