# BilingualAuditor Workflow Bootstrap 安装记录

日期：2026-10-23。状态：`human_acceptance_required`。本次为安装，不是 Team Loop 执行轮；未派生 planner/generator/scout/evaluator，未启动可选 `$docs-review`。

## 读取与来源

- `freshly_read`：本地包 `README.md`、`MANIFEST.md`、`LICENSE`、`workflow-kernel/VERSION`；全部必读入口与核心文档：`workflow-kernel/AGENTS.md`、`CLAUDE.md`、`docs/README.md`、`docs/workflow/team-loop-core.md`、`team-loop.md`、五个 `team-loop-roles/*.md`、`docs-maintenance.md`、`workflow/audit-first.md`。另读 `docs/workflow/update-policy.md`、版本 marker 格式和 docs-structure-template 全部 12 份模板。
- `freshly_read`（目标）：根 README、Gradle 配置、源文件列表、MainActivity / ReaderViewModel / TxtReader，既有 progress / decisions 最新记录及 development 中验证命令。未为安装全面审计全部产品资料或二进制图标。
- `satisfied_from_verified_cache`：无。本次安装所需来源重新读取；历史聊天只作线索，不据此声明新验证结果。
- Package：`C:\Users\a1234\Documents\BilingualAuditor\codex-teammode-workflow`，上游 `https://github.com/gdl1605/codex-teammode-workflow.git`。
- Commit：`521c6331c13c65dac0c7f6112d4c70b833f0770d`；kernel version `0.3.1`。本地 checkout 原样保留，不在包内代替安装。

## 安装前现状与合并方式

目标根目录没有 AGENTS.md、CLAUDE.md、docs/ 或 workflow/。已有 37 个非构建项目文件已做本轮 hash 基线，包含原有文档、应用源代码、配置、示例、图标和生成工具；基线为临时校验材料，不是产品验收证据。

唯一修改的既有文件是根 README.md：追加新文档地图与 handoff 链接，原文不删改。原有 `BilingualAuditor-docs/docs/` 未迁移、未覆盖，仍承载已确认需求、决定和既有进度；新 scaffold 不自动接管事实主落点。

## 新建文件清单

```text
AGENTS.md
CLAUDE.md
docs/README.md
docs/workflow/team-loop-core.md
docs/workflow/team-loop.md
docs/workflow/team-loop-roles/leader.md
docs/workflow/team-loop-roles/planner.md
docs/workflow/team-loop-roles/generator.md
docs/workflow/team-loop-roles/scout.md
docs/workflow/team-loop-roles/evaluator.md
docs/workflow/docs-maintenance.md
docs/workflow/update-policy.md
docs/workflow/LICENSE.codex-teammode.txt
docs/workflow/.codex-teammode-version
workflow/audit-first.md
docs/product/current-state.md
docs/product/active-directions.md
docs/architecture/system-map.md
docs/architecture/ia-and-navigation.md
docs/architecture/domain-boundaries.md
docs/handoff/latest.md
docs/handoff/archive/README.md
docs/plans/tech-debt.md
docs/plans/active/README.md
docs/plans/completed/README.md
docs/evidence/README.md
docs/evidence/workflow-bootstrap-install.md
```

共 27 个新文件；另合并根 README.md 一处入口。没有覆盖既有入口文件，因为安装前这些入口不存在。

## 项目适配与路径

- 采用 `docs/handoff/latest.md` 为新短交接路径；不把原 progress 改名或搬走。
- `AGENTS.md` 与 `CLAUDE.md` 共用相同 managed block 和项目约定，仅首行标题不同。保留用户中文教学、小步推进、范围选择权、免费预算、凭证保护、区分计划/实现/验证等偏好。
- 包内默认模型名未沿用为本环境可用承诺：安装后的 Team Loop 主规范和 evaluator 胶囊统一使用 `inherit-current-model` 标记，实际派生调用省略 `model`；保留角色建议 effort。不改变触发边界、角色通信、freshness、独立评估及人工验收停点。
- docs-maintenance 中的源码/数据层例子适配为本项目的 `app/src/**`、Gradle、资源、图标工具；没有把上游数据库/后端示例写成已存在的项目设施。
- 新架构、产品、计划 scaffold 的未知项使用 `TBD after target code audit`；保留模板的职责，不生成假架构、假计划或假验收。
- 保留上游 MIT 许可于 docs/workflow，适用本次复制的工作流材料，不据此给 Android 产品设定许可证。
- 本地包是嵌套 Git checkout，后续提交前需要决定忽略、外置或依赖管理方式；本次未暂存或提交，也未改 .gitignore。

## 验证命令与边界

已发现并在 docs/README.md 写入：

```powershell
.\gradlew.bat :app:assembleDebug --console=plain --no-daemon --max-workers=2
.\gradlew.bat :app:testDebugUnitTest --console=plain --no-daemon --max-workers=2
.\gradlew.bat :app:lintDebug --console=plain --no-daemon --max-workers=2
```

SDK 依实际机器用 ANDROID_HOME 或 local.properties 设置。上述是项目已存在的命令，不是本轮执行结果；本次没有重跑 Android 构建/测试、安装 APK、执行真机或服务部署。

`HUMAN_CHECK_REQUIRED`：手机验收、服务账户/部署命令、词典授权、FSRS 选库分别需要独立任务；云端命令保留 `TBD after target code audit`。可选 docs-review 只保留在 package，未安装或覆盖个人 skill。

## 安装静态检查

本轮 PowerShell 静态校验实际完成：

- 27 个必需新文件全部存在，实际新增文件数也为 27，没有额外业务文件。
- AGENTS.md / CLAUDE.md 去除各自首行标题后正文逐字符一致（包含 managed block 和项目约定）。
- 41 条本地 Markdown 相对链接均可解析，0 条失效。
- 版本 marker 使用 JSON（亦为 YAML 1.2 兼容语法），版本 0.3.1 / schema 1；25 个条目的 installed_sha256 与当前文件逐一一致。
- 安装前 37 个项目文件中 36 个 hash 未变，仅根 README.md 按授权追加入口；应用源码、配置、测试、图标、工具、旧资料均未变。
- 上游 package checkout 的 `git status --porcelain` 为空，本次没有修改该 checkout。
- 本轮未执行应用构建/测试、真机检查或服务部署，未触发 Team Loop，未调用子代理，也没有个人 skill 安装。

检查仅针对安装完整性，不表示工作流已被用户验收。本记录不纳入 managed kernel hash，以便追加实际证据；它属于项目 evidence，不应被工作流升级覆盖。

## Docs impact check

- 改变：项目协作入口、文档路由与新流程 scaffold；未改变业务合同、应用能力、计划验收或外部部署状态。
- 主落点：docs/README.md（文档地图）、同步入口、workflow kernel、本记录与版本 marker；根 README 只追加链接。旧产品事实不复制到新 scaffold。
- `reconciliation_recommended: no`：安装范围未发现需要本轮跨文档清理的必然冲突；旧资料的全面事实对账未执行，也不因此自动运行 docs-review。
- 余项：人类确认工作流入口与触发方式；后续有实际架构/产品审计时逐项填 scaffold，先确定与旧文档的唯一主落点；决定嵌套 package 的版本控制策略。

最终状态：`human_acceptance_required`。不写 accepted，不把安装当作启动 Team Loop。
