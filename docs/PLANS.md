# 计划、文档所有权与每轮维护

更新时间：2026-11-12。职责：普通开发与知识库维护约定，兼容可选 [Team Loop](workflow/team-loop.md)，不规定未触发时的轮次/schema/子代理调度。

| 内容 | Canonical owner | 其他页面的处理 |
| --- | --- | --- |
| 应有功能/验收标准 | [原 product](../BilingualAuditor-docs/docs/product.md) | [规格索引](product-specs/index.md) 按领域定位，不复刻条款 |
| 人工决定与建议 | [decisions](../BilingualAuditor-docs/docs/decisions.md) | 聊天出处保留在 evidence，不重问已确认决定 |
| 稳定原则/协作偏好 | [core-beliefs](design-docs/core-beliefs.md) | 短入口链接引用 |
| 候选比较与核查日期 | [technical-evaluation](../BilingualAuditor-docs/docs/technical-evaluation.md) | 时间敏感条件实施前复核，不当成已接入 |
| 当前实现/阶段 | [current-state](product/current-state.md) | 原 progress 保留有日期历史，不再维护平行当前清单 |
| 模块/依赖/数据流 | [ARCHITECTURE](../ARCHITECTURE.md) | system-map 保留兼容导航，UI/边界补专题 |
| UI/视觉、失败、安全约束 | [FRONTEND](FRONTEND.md)、[DESIGN](DESIGN.md)、[RELIABILITY](RELIABILITY.md)、[SECURITY](SECURITY.md) | 各写职责内说明，产品选择引用规格/决定 |
| 验证结论及出处 | [QUALITY_SCORE](QUALITY_SCORE.md)、[历史证据](evidence/verification-history.md) | development 保留命令/方法；不将历史成功当成本轮成功 |
| 方向/计划/长期差距 | [active-directions](product/active-directions.md)、[active](plans/active/README.md)、[completed](plans/completed/README.md)、[tech-debt](plans/tech-debt.md) | 复用 plans，不另建平行 exec-plans |
| 开发困难、处理经验与证据索引 | [development-difficulties](development-difficulties.md) | 详细证据仍归专题，执行步骤归计划；不复制报错流水账 |
| 新会话短导读 | [handoff/latest](handoff/latest.md) | 只放下一跳，不复制专题正文 |

## 每轮微循环

1. 检查需求、接口/架构、当前状态、验证结论、技术债是否变化；仅更新受影响 owner 并修导航。没有语义变化时说明无需更新 docs 的原因。
2. 小任务记录目标、修改、验收即可。复杂多轮任务在 active plan 写范围/非目标、证据、步骤、进度、决定、完成条件、未测项；达到完成条件并取得所需人工确认后才移入 completed，不以生成文件或停止工作代替完成。
3. 实现查代码、意图查人工/合同、部署/法务/验收/发布查各自证据。冲突先分类，不能静默改变需求或无限追加互相矛盾的“纠正”。
4. 缺信息分为：代码可核实（直接查）、可后补（标缺口继续）、必须用户裁决（提前问短而具体的问题，继续无关工作）。不把所有未知都当作阻塞。
5. 聊天只记录必要标题、thread/turn/消息 ID、日期和信息类别，不存敏感或无关全文。未来会话从仓库恢复，无需重读全部聊天。

## 困难记录

本节适用于普通开发及文档撰写，也适用于已显式触发的 Team Loop；不因记录困难而启动工作流。记录文件为 [开发困难记录](development-difficulties.md)，沿用其中的编号、状态和模板。

1. **何时记录**：遇到阻挡进度或反复出现的问题、环境／平台兼容差异、改变方案的重要限制、值得复用的排查经验，或会影响费用、凭证保护、验证可信度的困难时，应新增或更新条目。没有后续影响的一次性小错误不必逐条登记。
2. **记录内容**：写明发现／核对日期、现象与影响、状态及范围、事实和证据、根因是否确认、有价值的尝试与结果、处理和验证、剩余限制及下一步。未知根因明确标未知，不把猜测写成结论。
3. **更新时机**：当轮收口前检查是否有新困难，或根因、处理、验证、暂停／恢复状态发生变化；有变化就更新原条目。没有变化无需机械追加记录，也不承诺后台同步未来聊天。
4. **事实归属**：本文件是规则主落点；困难记录是摘要与证据索引。详细运行证据归专题，人工选择归 decisions，执行步骤归 active plan，长期债务归 tech-debt。新增入口只链接，不重复长段事实；主证据未同步时明确标注缺口。
5. **状态与关闭**：区分待定位、处理中、已缓解、已解决、人工暂停。本地通过不能代替部署或真机通过；只有声明范围内的验证完成才标已解决，并保留经验和证据。暂停不是解决；复发时更新原编号。
6. **写作与安全**：聚合同一问题的重复报错，保留有意义的差异，不复制聊天全文、原始日志、私人原文、Key、token、验证码、有效授权链接或敏感截图。文档任务不顺手修业务代码，也不据条目自动发起重试、部署或收费调用。

## 更新边界

这是后续会话执行时落实的规则，不是后台持续同步/读取未来聊天的承诺。本轮不新增 CI、运行时、自动 agent 或个人 skill。Team Loop/docs-review 仅由明确触发进入协议。

workflow managed blocks 和 docs/workflow 是上游所有；项目导航放 block 外。本次不升级工作流，不改版本 marker；旧 installed hash 是安装时基线，后续项目维护的 drift 见 [本轮证据](evidence/knowledge-bootstrap-2026-11-03.md)。
