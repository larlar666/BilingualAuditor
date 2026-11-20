# 文段保存/打开实施证据

日期：2026-11-17。关联 [已批准计划](../plans/active/document-save-open.md)。状态 human_acceptance_required；Leader独立验证与fresh evaluator评审完成，尚未人工接受。

## 基线与范围

开工时工作区已有未提交BYOK/UI/docs，均保留。修改前SHA256：MainActivity.kt `223A9223143D3F107B089EC7723BAA72EFDAC2D65FB6A27EBBC0B42232DE8B5D`；ReaderViewModel.kt `277BA421669E08803DEA6853925078643E955C2BFFC9B645DC40765F48A92791`。既有49项单测。新增ReadingDocument.kt（模型/codec/repo）与ReadingDocumentTest.kt；本轮只追加文段状态/导航和对应docs。

## 实现可核事实

- schemaVersion=1逐文段JSON，合法UUID路径、精确原文、nullable对应英文、unchangedEnglish、createdAt/updatedAt/displayName。私有noBackupFilesDir/reading-documents，不含Key/config/log。
- Mutex串行IO、唯一同目录临时文件flush/fsync后ATOMIC_MOVE替换，失败保旧，无先删后写降级；记录512KiB硬上界，UTF-8严格解码。坏/未知版本保留并统计，不清库或自动修复。
- 同ID普通保存保留createdAt，另存为成功绑定新ID且原件保留。保存原文覆盖已有双语需确认；内存译文未保存继续dirty。过期译文不可配新原文保存。10000码点保存与1000模式翻译独立。
- 未保存保护及全读成功后替换；目标失败/TXT取消保当前。保存后再打开有延迟读互斥回归，先结束写busy再执行后续读，避免外层finally提前解除新读busy。
- 抽屉大分支emoji+文字，文段行无emoji；本机搜索名称/原文/英文，大小写不敏感；加载/空/无结果/坏记录/错误区分。单词本明确待开发，偏好设置仅承接既有翻译设置。

## Generator 本地验证

环境：BellSoft LibericaJDK21、既有Android SDK；Gradle离线。最初sandbox写用户.gradle缓存锁被拒，使用受审查的本地编译权限后成功，不涉及网络或新依赖。

- `:app:compileDebugKotlin --offline` 成功。
- 首轮 `:app:testDebugUnitTest --offline` 成功；补第6项延迟打开互斥后最终55项、0失败/错误/跳过（49既有+6新增）。Leader独立XML复核一致。
- 真实JVM临时目录：精确roundtrip、同ID更新、另存独立、重实例化、坏/未知版本保留、原子替换失败保旧、并发串行、10000/10001补充平面emoji码点边界。
- VM假仓库：写失败不变保存基线、仅原文覆盖确认、另存ID、打开失败保当前、取消提醒/TXT取消不清空、导入新身份/清译文、搜索与改回baseline clean。

Leader独立assembleDebug成功，test XML 55/0/0/0；APK SHA256 `EF95AA2F8CDBCE2381659F12AA3C70A6705E431FE8B76FE25CCB29BBBA5FE21E`。Leader同一离线命令 exit0 / BUILD SUCCESSFUL：assembleDebug、testDebugUnitTest、lintDebug均成功。Lint 0 Error/Fatal、5 Warning（4 GradleDependency + 既有CustomX509TrustManager）、1 Information。

## 独立评审与 Team Loop 收口

Leader提供并核验的fresh evaluator_save_open_r1最终结论为PASS，无P0/P1；read scope、diff、validation、docs检查均pass。生成及评审回执均已由Leader核验，无bootstrap实质偏离。planner、implementation generator、evaluator均为fresh dispatch 1；rounds/attempts=1/1，implementation_owner=generator。本次独立fresh generator仅收口最终证据/docs，不属于代码返工轮；代码已冻结，终态为human_acceptance_required，不转accepted。

唯一P2：`ReaderViewModel.kt:110–116`的侧栏跳页“放弃并继续”只关闭提醒并执行导航，仍保留dirty草稿；返回阅读时可能重复弹出同一未保存提醒。不丢数据，但“放弃”的语义需人工验收。本轮记录为非阻塞residual risk，不改代码、不返工。

自动测试未直接覆盖全部“离开提醒中写失败”及“打开后迟到翻译”组合，评审未发现阻塞问题；不据此宣称这些组合已完整通过。真机、低磁盘、设备原子移动、强杀、断电、大字体和TalkBack仍未验。

## 人工验收（未执行）

1. 保存仅原文和双语各一篇，断网/重启App，列表搜索后打开，原文空白/emoji精确保留且不触发翻译请求。
2. 修改后普通保存仅一条同ID；另存为两条独立。双语改存原文出现确认、取消无变化；成功后英文只在内存时明确未保存。
3. 1001..10000码点可存但直连不可翻译，10001全文保留且不可存；过期英文不可存双语。
4. 有未保存变化时依次新建/打开/导入/侧栏切页/系统返回，检查保存/放弃/继续编辑；保存失败不跳转，目标失败与TXT选择取消保留内容。翻译迟到不得串文。
   侧栏重点：选择“放弃并继续”后返回阅读，核实dirty草稿仍保留以及重复提醒是否可接受；此项对应上述P2，不能按已通过处理。
5. 保存/读取时连续点击与编辑无竞态；旋转不视作离开，Home/强杀不承诺未保存恢复。
6. 检查抽屉大分支emoji和文字、文段无逐项emoji、长列表/软键盘/大字体/TalkBack触控，单词本待开发及偏好配置可返回阅读。
7. 真机验证同目录原子替换支持；断电、低磁盘、系统迁移/厂商备份排除尚未证明。不用合成JVM测试推导这些结论。

无真实Key/API/收费调用、数据库migration、服务端函数、deploy/apply或远端删除；安装新APK才在设备生效。本机明文保存不等于手动备份。
