# 输入、状态与集成边界

核对日期：2026-11-06。职责：易误读的实现边界和后续高风险合同；产品意图以 [规格/决定](../product-specs/index.md) 为准。

- [TxtReader](../../app/src/main/java/com/bilingualauditor/app/TxtReader.kt)：最多 256 KiB 字节、100,000 个 UTF-16 代码单元；UTF-8 可带开头 BOM；拒绝空白、无效编码及换行/回车/制表符之外的 ISO 控制字符。界面简写“字符”，不等于 emoji 等用户感知字符数。
- [ViewModel](../../app/src/main/java/com/bilingualauditor/app/ReaderViewModel.kt)：已知文件名须以 .txt 结尾，通过 ContentResolver 读流；导入安全限制不变，编辑最多 100,000 UTF-16 单元；导入期间忽略 edit。
- [TranslationPolicy](../../app/src/main/java/com/bilingualauditor/app/TranslationPolicy.kt)：独立的单文段业务上限为 10,000 Unicode 码点，包含空白、标点及 emoji；并非 UTF-16 长度或用户感知字素数。在既有导入安全上限内，业务超限仍保留全文、阻止翻译并提示；后续保存须复用相同业务校验，本轮未实现保存。
- 解析器不识别语言；混合原样读取不等于 D10 的混合翻译。编码与语言不是同一概念。
- 成功才整体替换；已捕获异常保留旧输入；不写回原文件。弹框与原文的恢复边界见 [RELIABILITY](../RELIABILITY.md)。

网络发送/后端授权与额度见 [SECURITY](../SECURITY.md)。代理已有仅保存计数的 D1 [预算 schema](../../server/translation-worker/migrations/0001_translation_budget.sql)，尚未 apply；它不是阅读历史。上游 HTML 包装的保守计数与产品码点限制分开，保护开销超限可明确拒绝，但不截断原文。备份覆盖及 FSRS 状态/日志合同在对应功能实施前收口。

删除历史不连带删除词卡、确认后整体恢复目前是配套建议，不能自动升格为人工决定。TTS 声音可用、首查词联网和已保存释义离线分别需要证据。
