# Android DeepSeek BYOK 第一阶段实施证据

日期：2026-11-16；状态：**human_acceptance_required / r2离线自动检查与独立评审通过，待设备人工验收**。

## Startup / Read Scope

Generator 已读 AGENTS、docs/README、Team Loop core/generator、audit-first、批准的 phase1 计划、SECURITY、handoff，以及 TranslationPolicy/Client、ReaderViewModel、MainActivity、PinnedTls、ProxyHealth、Manifest、Gradle、现有 ViewModel 测试和旧 phone-text/trial 保护实现；docs owner ARCHITECTURE、RELIABILITY、QUALITY_SCORE、PLANS、困难记录、current-state、decisions、DESIGN 在写入前读取。

## Repository State Layers

app 起始干净。已有 docs、decisions、development、product、product-specs、D12 与 UI 偏好文段是历史/并行修改，只增量维护本轮语义；两份 BYOK plan 起始未跟踪。旧 server、.local、凭证、账本、私人原文均不写、不读取真实秘密，不发真实请求，不提交推送。

## Verified Facts

现有 TranslationSettings 明确永不持有供应商 Key；请求代次可防迟到结果，但 blocking HTTPS 的 finally disconnect 无法即时中断上传/等待读取。旧保护按 Han/中文标点分段、按 JS trim 去片段边界，保留内部原英文；旧 JSONObject 路径不能作为严格重复键解析证据。系统 minSdk26，可用 Android Keystore AES-GCM 与 noBackupFilesDir。

官方字段由 Leader 本轮只读核查：[chat](https://api-docs.deepseek.com/api/create-chat-completion/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)；deepseek-flash、thinking disabled、JSON object；402 余额不足，403 不推断余额。

## Inferences

独立直连配置、严格纯 Kotlin JSON、可注入 HTTPS 连接和串行凭证仓库能够隔离旧代理合同；离线测试只能证明相应逻辑，不能证明设备与真实服务成功。

## Unknowns / HUMAN_CHECK_REQUIRED

Keystore 厂商行为、进程恢复、备份/迁移实际排除、手机网络、交互、自然度与实际费用均未验证。无新收费请求预算；不复用旧账本结论。

## Execution Preconditions

用户已批准第一阶段计划并明确要求 Team Loop 开发；允许本轮代码与必要 docs。无真实 Key 也可完成开发和离线检查；真实请求另等新预算。自动检查和 independent evaluator 结果由 Leader 记录，不能以代码存在宣称人工接受。

## r1 Implementation / 离线验证（历史版本，Generator，2026-11-17）

- 已实现独立官方模式/Key类型、保护与StrictJson、串行凭证仓库、官方客户端、ViewModel与UI；旧代理协议/server/账本未改，无新增依赖。Key不进ReaderState/saved state，保存文件仅版本/IV/密文；同目录临时文件fd.sync后atomic move，不支持原子移动则失败保留旧记录。删除文件失败保留旧配置；alias失败明确内存/密文已清而系统清理待重试。
- 合成保护fixture通过只读导入旧preparePhone1000Text生成expected；包括补充Han、emoji、BOM/NBSP、内部双空格/换行、URL、标签，未导入四固定样本门禁。输出严格拒绝重复键、畸形marker/未知marker、残余Han、截断/工具/意外reasoning与空白content。
- 固定域名、无重定向/重发、128KiB响应/16Ki字符content限制；取消覆盖实际上传、等header、读取，以及handle创建/参数配置/outputStream获得后的发送前竞态。disconnect从状态锁/单deadline调度器分离到IO清理，单次清理挂起不阻塞后续deadline调度。
- 凭证load不再依赖正文generation：加载期禁止配置变化，正文编辑不会丢弃已恢复配置；离线回归覆盖该路径。保存/替换/关闭记住/删除由同一Mutex串行处理，失败不虚报成功；新apply成功清除旧cleanupPending。

Generator命令：`$env:JAVA_HOME='C:\Program Files\BellSoft\LibericaJDK-21'`、`$env:ANDROID_HOME='C:\Users\a1234\AppData\Local\Android\Sdk'` 后运行 `.\gradlew.bat :app:testDebugUnitTest --console=plain --no-daemon --max-workers=2`。最终运行 exit 0 / BUILD SUCCESSFUL；XML合计 **43 tests，0 failures，0 errors，0 skipped**（原26+新增17）。compileDebugKotlin/compileDebugUnitTestKotlin随该任务成功，不冒充assembleDebug或Lint已通过。

最初sandbox写用户.gradle wrapper lock被拒绝，按工具审批后使用已有缓存成功执行；未改系统配置。一次编译发现协程internal tryResume API，改用稳定resumeWith及AtomicBoolean完成门后重跑成功；无需引入依赖。`git diff --check`无空白错误，现有CRLF提示不作为测试失败。

r1 Leader独立检查：assembleDebug、testDebugUnitTest（UP-TO-DATE）、lintDebug均成功；实际测试XML 43/0失败/0错误/0跳过。Lint 0 errors、5 warnings（4 GradleDependency、旧CustomX509TrustManager），另1 Information AutoboxingStateCreation。r1 APK SHA256 `C08B8531C85BC6E1B8E4677397BE0B863A521999F391502CBC7492A795E77BDB`，仅绑定修复前版本。独立evaluator判定 changes_requested：唯一P1为已记住官方Key→主动切代理→杀进程后无条件恢复直连，违背绝不自动启用/回退模式合同。无真实Key、模型请求、收费、部署或apply；未读旧账本。运行版本为本轮工作区（未提交）。

## HUMAN_CHECK_REQUIRED / 设备清单

1. 手机无电脑时配置官方Key，检查只GET models；仅本次进程终止失效，最后应用为直连且记住后重启只显示“已配置”，不回填明文。分别切两种代理/清除代理后杀进程：应保留该模式、未配置、零官方调用；主动切回可复用保留Key。旧无mode记录首次不自动启用。
2. 记住/关闭记住/替换/删除（含损坏、旧版本、alias失效）与Android Keystore行为；确认no-backup与旧/新版备份、迁移实际排除。原子移动不支持时保持旧配置并准确失败。
3. 1000/1001补充字符边界、纯英文断网旁路、原文编辑/换TXT/换Key/换模式/删除后迟到结果无效；连续点击不重复。
4. 断网/TLS/超时/取消、读取与上传中的取消反馈、长文本滚动/键盘/旋转/大字体、局部shake/emoji与可访问性。
5. 新收费验收预算明确后，才验证中文/混合/错误英文/URL标签自然度和实际费用；取消不保证零扣费，App不承担账户总预算硬上限。旧额度不重置。

## Docs Impact / 终态

受影响owner已增量更新：人工批准、阶段计划/方向、架构、当前状态、安全、可靠性、前端/导航/边界、质量与本证据、困难与交接；并行D12和UI偏好保留。DIF-007只标离线缓解，不记设备已解决。无数据库schema/migration、服务端函数、云资源变更，不需要deploy/apply。状态 **human_acceptance_required**，不能自动accepted。

## r2 P1审计与修复语义（2026-11-17）

current code确认根因为模式只留内存，初始化load仅依据Key存在就设置serviceConfigured，无法辨认用户最后选择。采用原凭证原子文件内版本化封装，将非敏感mode与可选密文作为单一事务；不保存代理URL/token/pin。切换代理只更新mode并保留用户已记住密文；清除代理保留该mode且未配置。重启恢复mode，代理凭证失效必须未配置，绝不调用官方。旧无mode密文允许解密供显式复用，但首次不自动启用。关闭记住/删除原子去除密文但保留mode，不以删除Key绕过模式合同；alias清理仍明确中间状态。保存模式失败不发布配置成功。初始化显式重抛CancellationException。下方r2验证按实际运行回填，独立复核已通过，设备/人工验收仍待完成。

### r2 Generator离线验证

新增 `DeepSeekModeRecoveryTest` 六项，实际连同原43项运行 **49 tests / 0 failures / 0 errors / 0 skipped**。同环境JDK21/Android SDK，运行`:app:testDebugUnitTest --console=plain --no-daemon --max-workers=2`两次均BUILD SUCCESSFUL（50s、34s）；最后一次包括Key未启用提示UI编译。覆盖两种代理重启零官方调用、主动切回保留Key、clear/delete重启、写mode失败不发布/不关闭UI、仅本次不留密文、legacy显式启用与保存busy期间编辑/竞争配置。旧Repository事务测试改为原子写无密文记录的语义，未删除原测试；加载期间编辑/拒绝配置回归仍保留。`git diff --check`成功（已有CRLF提示）。使用已获审批的现有.gradle缓存，没有真实网络调用或账本操作。r2 Leader检查结果见下；独立evaluator结论继续按直接回报记录，设备与费用仍未测。

### r2 Leader独立自动检查 / 最终产物

冻结代码后：`:app:assembleDebug` exit0 / BUILD SUCCESSFUL 23s（3 executed / 32 up-to-date）；`:app:testDebugUnitTest` exit0 / BUILD SUCCESSFUL 17s（UP-TO-DATE，Leader重核XML **49 tests / 0 failures / 0 errors / 0 skipped**）；`:app:lintDebug` exit0 / BUILD SUCCESSFUL 46s，0 Error/Fatal、5 Warning（4 GradleDependency + 旧CustomX509TrustManager）、1 Information AutoboxingStateCreation。`git diff --check`通过。

最终debug APK SHA256 **`3388C946EF415FDDB140C9ACC9CEFCE039C50495FDEA94B4EC850CA310C0C021`**，Leader两次核对一致；绑定本轮未提交工作区r2 Android产物。r1旧哈希只供历史区分，不用于r2验收。无安装/真机/真实Key/API/费用或发布证据。

Team Loop运行记录：rounds 2 / attempts 2，implementation_owner generator；fresh generator和fresh evaluator各2，不复用session。Leader已核全部Read Scope Ack；r2启动回执偏迟，但必读材料实现前已读且最终覆盖，无实质缺项。终态保留 **human_acceptance_required**，不能自动accepted。

### r2 Fresh evaluator最终结论 / 残留

Leader提供fresh evaluator最终verdict **pass**：无P0/P1，r1唯一P1已关闭；49/0/0/0、三项检查与APK哈希一致，read scope / diff / docs scope均pass。此结论为独立离线代码核验，不是用户接受。

唯一P2：高级代理设置弹框内部未展示持久保存失败的ReaderState.message，用户需关闭弹框才看见失败提示；实际配置与磁盘保持旧状态、不虚报成功，故作为体验残留，不阻塞本轮、不返工。人工验收应检查该反馈；设备Keystore/备份迁移/实际杀进程/UI、真实官方API/自然度/费用均仍未测，无收费授权，旧预算不读取或重置。

本轮docs impact增量收口：凭证/模式持久化语义影响ARCHITECTURE、SECURITY、RELIABILITY及current-state；phase1计划、QUALITY_SCORE、handoff及本证据回填已完成的自动检查/独立评审状态，困难记录保留根因与经验。D12和并行UI偏好未改。无schema/migration、服务端函数、云资源变化，无deploy/apply。终态 **human_acceptance_required**。
