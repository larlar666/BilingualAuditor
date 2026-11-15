# 历史验证证据索引

整理日期：2026-11-03。职责：给历史结果绑定来源、范围和限制。本次只读文件/聊天，未重新构建、运行解析测试、生成图标或连接手机。质量矩阵见 [QUALITY_SCORE](../QUALITY_SCORE.md)。

## 2026-10-21 TXT 最小工程

来源：主聊天 turn 01a15d46-038f-75c0-8893-d9e1f3e0344a、[原 progress 的带日期记录](../../BilingualAuditor-docs/docs/progress.md)、[开发记录](../../BilingualAuditor-docs/docs/development.md)。历史报告：assembleDebug / testDebugUnitTest / lintDebug 成功，解析 7 tests、0 failures/errors/skipped；初轮 Lint 6 警告。

主聊天命令 exec-5327abe3-bb24-4762-8f1c-778e19edbd49 的历史未截断输出，是当时读取 JUnit XML 的结果：7 tests / 0 failures / 0 errors / 0 skipped，关联当时 APK 8,723,648 字节。本轮核对 [测试源码](../../app/src/test/java/com/bilingualauditor/app/TxtReaderTest.kt) 仍有 7 项，但 clean 后旧 XML 已不在当前路径；该历史输出不是本轮独立重跑或当前留存原始 XML 的证明。也没有 ViewModel/UI 自动测试或真机结果。

后续混合语言文案轮只重新 assembleDebug，APK 变为 8,748,434 字节；当时测试资料用 15:26 标识。再后来的图标轮替换同一路径 APK，不能沿用旧时间当作现有产物身份。

## 2026-10-21 图标最终轮

来源：「完善 APK 图标手稿」turn 01a15ee7-d283-7c31-a54d-c3fed51dcfe3 的实际命令输出：

- exec-9ec6cd11-5beb-4fda-a370-354dbbf332f3：`:app:clean :app:assembleDebug :app:lintDebug --console=plain --no-daemon --max-workers=2`，exitCode 0，输出 `BUILD SUCCESSFUL in 56s`。这是历史执行，不是本轮命令。
- exec-1b5d0bbc-d46e-4a57-8843-b3505a12e058：历史 Lint XML 列出 4 项 GradleDependency、1 项 DataExtractionRules，未列 Error；不是“零警告”。本轮留存 XML 同样读到 5 个 Warning，未重新生成。
- exec-5f101b02-a24f-442f-9860-15c3c51f8132：aapt2 badging 的 icon 指向打包自适应 XML，APK 长度 8,824,209；文件时间 2026-10-21 22:46:42（本机记录）。

本轮文件盘点仍见同尺寸/时间 APK、对应 output-metadata（applicationId com.bilingualauditor.app，versionCode 1，versionName 0.1.0-dev，debug），Lint 报告时间 22:47:13。尺寸/时间不是完整密码学身份，也没有 Git commit 绑定；这些观察不证明二进制与今日源码完全一致。本轮未再次 aapt2 dump、未新看视觉、未重跑测试。

图标轮中的中间失败（缓存锁权限、资源目录调整后 missing mipmap）和最终 clean 成功均保留在聊天。缓存是合理线索，未进一步证明唯一根因；不将中间失败继续当成当前 blocker，也不为后续每次构建强制 clean。

## 2026-10-23 workflow 安装

见 [原安装证据](workflow-bootstrap-install.md)。其中 27 新文件、41 条链接、25 项 hash 是安装当时的检查数，状态为 human_acceptance_required；不因后续知识库编辑而回写成当时安装结果改变。

## 真机、人工验收与外部状态

[手机测试清单](../../BilingualAuditor-docs/docs/manual-test-01.md) 是待执行用例，不是结果。图标最终回复也明确真机显示待确认。没有收到验证版本、设备系统和通过/失败记录，不能把用户问“可以开始测试吗”记为已验收。

同样没有生产服务部署、付费开通、词典法务许可或应用商店发布证据。上述状态必须由对应直接来源更新，代码或自动检查不能代替。
