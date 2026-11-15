# 项目知识库 Bootstrap 记录

日期：2026-11-03。范围：文档所有权、agent 阅读路径和知识结构，不是 workflow 升级、Team Loop、业务开发或 docs-review skill 执行。未提交、推送或部署。

## 来源与范围

- 三个聊天的分页覆盖、关键人类消息和缺口见 [chat-review](chat-review-2026-11-03.md)。同项目 recent 列表只发现这三个指定聊天；不把列表摘要当作回顾正文。
- 已读根入口、docs 索引、原需求/决定/进度、开发/测试说明、三个 Kotlin 源文件、解析测试、Manifest、自适应图标 XML、图标脚本和 Gradle 配置；未为了本轮重跑构建或改图标。
- 使用 OpenAI Docs 技能获取官方资料；用户给定中文 harness-engineering 页抓取超时，已实际打开同篇英文原文，来源/日期见 [references](../references/README.md)。只参考阅读结构，不复制其产品/架构主张。
- 安装前已有大量未跟踪文件、main 无提交，不能用空 diff 冒充“没有改动”。本次以 64 个已有非构建文件的内容/hash 为临时对照基线；基线存于忽略的 .gradle，仅供本轮检查。

## 结构与所有权适配

采用短入口加专题 docs；受“保留 workflow managed block”约束，压缩的是其外项目约定，不把原 block 换成短摘要。AGENTS/CLAUDE 同步，workflow 正文、上游 checkout 和安装 marker 保持原样。

- 新 ARCHITECTURE 为当前模块/依赖/数据流 owner；原 system-map 转导航，IA/domain-boundaries 填入核实事实。
- 原 product/decisions 保留为规格/人工决定正文；新 product-specs/index 按领域定位，不建立第二份规格。
- 原 docs/product/current-state 接管当前实现状态；progress 保留带日期历史；开发命令/方法仍在 development，测试用例仍在 manual-test-01，质量/历史结果分别集中在 QUALITY_SCORE 与 verification-history。
- 原 docs/plans 承担文章 exec-plans 的角色，不新建平行目录；本次没有虚构活跃或完成的业务计划。tech-debt 填有证据的 harness 机会。
- design-docs、references 和必要的 DESIGN/FRONTEND/PLANS/PRODUCT_SENSE/QUALITY_SCORE/RELIABILITY/SECURITY 均有实际内容；不建无真实来源的 generated/schema/部署文件。
- 原技术初评标明历史时点；“尚无工程/无 AGENTS”等早期观察保留历史含义，避免当成当前状态。原真机清单的固定时间改成由实际待测 APK 填写。

## 静态检查

已执行的检查（不是 Android 功能验证）：

- 全项目（排除上游 package/build）的 47 份 Markdown，293 条本地相对链接可解析，0 条失效；涉及 Kotlin、XML、脚本、原图和预览的导航都指向实际文件。
- AGENTS 与 CLAUDE 去除首行标题后正文逐字符一致；AGENTS 共 64 行。3 个 managed block（含 docs 索引）与本轮前字符串完全一致。
- 本轮前 64 个非构建文件中，20 个既有 Markdown 更新、44 个文件保持 hash 一致；新增 15 个 Markdown。应用代码/测试/资源、构建配置、图标脚本及图像均未改变，没有删除文件或非文档新增项。
- `git diff --check` 返回 0；因项目尚无提交且文件未跟踪，另用基线/空文件对本轮全部 35 个修改/新增 Markdown 逐一 `git diff --no-index --check`，按 Windows CRLF 配置 `cr-at-eol`，0 处空白错误。初次未设 cr-at-eol 的检查把 CR 当尾空格，已用符合本机换行的配置复核，未为此改动 managed block。
- 10 个 replace-workflow 文件、上游 checkout 和原版本 marker 均未变。25 项历史 installed hash 中 13 项有预期漂移，全部属于入口/项目 scaffold（3 mixed + 10 create-if-missing）；它们是本次授权的项目资料维护，不是 kernel 改动。旧 marker 和原安装证据原样保留。
- owner/状态复核：原规格与决定保持权威，旧 progress 明确日期化，早期“无工程”标作历史；单一 current-state/ARCHITECTURE/QUALITY 与证据形成导航。未新造 schema、活跃/完成业务计划、生成资料、服务集成或已验收声明。

上述数值在所有链接及内容调整完成后再次复核；不将空的 tracked diff 当作无改动证明。

## Docs impact

变化：导航、canonical owner、核实过的架构/当前状态、历史证据索引和维护约定；未改变用户决定、产品范围、业务代码或外部状态。不自动持续读取未来聊天，不增加 CI/运行时。

安装 marker 保持 2026-10-23 基线，不重新生成 installed hashes 冒充 workflow 升级。项目侧维护可能让入口及 create-if-missing scaffold 的整文件 hash 漂移；managed blocks 与 kernel 应保持不变，具体校验另记。

没有必须先由用户裁决才能完成本轮资料整理的新产品选择；后续触及服务、备份覆盖/队列安排等需求时再问，嵌套 checkout 归属在首次提交前决定。真机结果、服务开通/部署/许可与正式发布无直接证据，仍不标通过或合规。

状态：知识结构已建立后待人工审阅；不自动继承或宣布原 workflow 安装已 accepted。
