# AGENTS.md

<!-- codex-teammode:managed:start scope=agent-entry version=0.3.1 -->

## 适用范围与触发

- 本包只定义由用户 prompt 显式触发的 Team Loop 工作流。
- 用户 prompt 以 `@team-loop` 开头，或明确要求使用 `Team Loop` / `teamloop` / Leader 调度多个 subagent 时，才启用以下规则。
- 未触发时，本 managed block 不规定轮次、输出 schema、启动检查或 subagent 调度；按用户指令和目标项目自身规则处理。
- 仅讨论、引用或修改 Team Loop 规则不等于启动 Team Loop。

## Team Loop 事实与范围

- 需要项目上下文时，先读 [`docs/README.md`](docs/README.md)，再按任务进入对应专题 docs。
- 当前实现事实的证据优先级：`current code` > 对应专题 docs > `docs/handoff/latest.md` > `docs/handoff/archive/`。
- 当前用户目标决定本轮范围；明确人工确认 / canonical contract 决定业务意图，部署、验收、法务和发布事实必须有各自直接 evidence。
- docs 与代码冲突时，记录代码当前做了什么，不得用实现现状静默覆盖已确认的业务合同。
- 默认只做本轮目标内的最小必要修改，不顺手扩模块或重构。

## Team Loop 模式

- Team Loop 规范落点见 [`docs/workflow/team-loop.md`](docs/workflow/team-loop.md)。
- 派生 subagent 时，`Context Bootstrap` 默认使用 `slim`：当前工具入口 `AGENTS.md` 或 `CLAUDE.md` 二选一、`docs/README.md`、`docs/workflow/team-loop-core.md`、对应 `docs/workflow/team-loop-roles/<role>.md`、本轮必要 docs / code / evidence；完整 `docs/workflow/team-loop.md` 仅在需要核对完整规范时加入，`workflow/audit-first.md` 仅在根因未锁 / 高风险 / 审计回流时加入。
- Leader 主线程是唯一调度者：
  - Leader 派 planner / generator / scout / evaluator。
  - Leader 派生任何 subagent 时必须附带裁剪后的 `Context Bootstrap`，并要求 subagent 输出 `Read Scope Ack`。
  - Leader 只负责调度、裁剪证据、验证和汇总；进入 Team Loop 后不得直接改代码或 docs。
  - Team Loop 中的 planner 是 Leader 调度的只读 subagent。
  - 所有 subagent 只能回报 Leader。
  - subagent 之间禁止直接通信。
  - generator / evaluator / scout 不得自行派生 subagent。
- Team Loop 支持两种模式：
  - `plan-gated`：适合涉及数据合同 / 权限 / 状态机 / 高风险产品域 / 复杂资源链路 / 根因未锁的任务，或用户明确要求先批准 plan 的任务（目标仓库应自行列出具体高风险域）；planner plan 必须先交给用户确认，批准后才派 generator。
  - `auto-execute`：适合文案、轻 UI、局部样式、docs 小修和 allowed scope 清楚的低风险任务；Leader 在 planner 快速收口后可直接派 generator，但不能跳过 generator 自己实现。
- generator 如审计范围过大，只能向 Leader 提交 `Scout Request`；scout 只能只读收集线索并回报 Leader；Leader 必须整理 `Evidence Pack` 后再交给 generator。
- audit-first 场景必须复用 `workflow/audit-first.md` 的必读骨架和 evidence 回流要求。
- evaluator 只消费 Leader 提供的 `Evaluation Bundle`，不继承 generator 完整对话叙事；P0 / P1 阻塞返工，P2 / P3 默认进入 residual risk、backlog 或人工验收。
- Team Loop 运行中可进入 `changes_requested` 并返工；最终只能停在 `human_acceptance_required` 或 `blocked`；不得自动进入 `accepted`。

## Team Loop 输出规则

- 默认不要贴完整文件全文，除非用户明确要求。
- 需要验证时，优先写清人工验收清单。
- 如果一轮改动涉及数据库 schema / migration / 服务端函数（RPC / 存储过程 / serverless 或 edge function 等），输出必须说明改的是哪个对象、语义差异、是否需要 deploy / apply、以及当前是否已生效。

## Team Loop docs impact check

- 每轮结束前，必须判断本轮是否改变了：项目事实、产品合同 / 边界、当前阶段已成立能力、候选方向 / 后置方向、计划状态、长期技术债 / 结构债 / 体验债 / 流程债。
- 若有变化，必须更新对应 docs 主落点；不要把同一事实分散回写到多个文档。
- 若无变化，输出里也必须明确写“本轮无需更新 docs”及原因。
- docs impact check 只要求更新被本轮语义真正影响的主落点，不要求每轮全量刷新 docs。
- docs impact 是增量维护微循环，不承担跨文档全量事实对账。

<!-- codex-teammode:managed:end -->

## 项目导航与日常约定

- 默认按 [docs 索引](docs/README.md) → [当前状态](docs/product/current-state.md) / [短交接](docs/handoff/latest.md) → 本轮专题 → 当前代码渐进读取，不盲读全部资料。
- 按任务阅读路径见索引；产品条款、人工决定、当前实现与证据的唯一主落点见 [PLANS](docs/PLANS.md)。业务意图不能被现有实现静默替代；部署/验收/法务/发布需直接证据。
- 用中文、小步骤并结合实际任务讲解，范围选择由用户决定；不重问已确认 D01～D11。完整偏好与原则见 [core-beliefs](docs/design-docs/core-beliefs.md)。
- 修改前核对状态、范围与证据，修改后运行相关检查；构建、单元测试、Lint、真机和人工验收分别报告。命令/方法见 [质量入口](docs/QUALITY_SCORE.md)，纯文档任务不默认全量构建。
- 每轮检查需求、接口、架构、当前状态、验证结论和技术债是否改变，仅更新受影响 owner、修复导航；缺口分类与计划生命周期见 PLANS。此规则不是后台自动同步未来聊天。
- 文档收口时按 [困难记录规则](docs/PLANS.md#困难记录) 检查并更新 [开发困难记录](docs/development-difficulties.md)：记录有后续影响的问题、确认程度、处理与验证、剩余限制和经验，聚合同类报错，不保存凭证或私人原文。
- 免费预算、凭证/原文保护及未来服务集成边界见 [SECURITY](docs/SECURITY.md)，不自动开通付费。`codex-teammode-workflow/` 是嵌套上游包，不是 app 模块。
- 安装、讨论知识库或工作流不触发 Team Loop；明确触发后才读 [完整规范](docs/workflow/team-loop.md)，其中 inherit-current-model 是省略 model 参数的策略标记，不能当成模型 ID。
