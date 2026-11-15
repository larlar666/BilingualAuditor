# 可靠性与失败边界

核对日期：2026-11-06。职责：解释实际失败处理和后续验收门槛，不声明可靠性认证。

## 当前文件与内存行为

由 [ReaderViewModel](../app/src/main/java/com/bilingualauditor/app/ReaderViewModel.kt) 与 [TxtReader](../app/src/main/java/com/bilingualauditor/app/TxtReader.kt) 核对：读取发生在 IO；流被关闭；字节数有上限；严格解码，不把无效字节替换成看似成功的乱码。完整读取成功后才替换原文，已捕获的权限、IO、参数及导入错误保留旧原文。

取消选择不触发导入。屏幕旋转通常复用 ViewModel，但进程死亡、关闭应用或清除数据后的文本恢复没有实现。`rememberSaveable` 只保存弹框状态，不保存原文。不要给用户做“已经保存”的提示。

解析边界和语言语义见 [domain-boundaries](architecture/domain-boundaries.md)，当前实际验证强度见 [QUALITY_SCORE](QUALITY_SCORE.md)。本轮已有 ViewModel 单元回归，但没有 UI 自动测试或手机证据覆盖完整 ContentResolver、云文件提供方、低内存和大文件交互。

## 当前翻译失败处理与在线验证门槛

翻译请求绑定原文及配置代次；编辑、换文件或配置变更会使旧任务失效，迟到结果不能覆盖新内容。原文改变后旧译文标记过期。loading 防重复提交，失败保留原文，不将错误文本显示为译文。超限后持续标红，导入完成或编辑结束时按一次告警状态弹窗；回到合法长度后恢复，不截断或建议拆短。

[HTTPS 客户端](../app/src/main/java/com/bilingualauditor/app/TranslationClient.kt) 区分网络、超时、授权、限流、额度、服务异常及英文保留失败；拒绝重定向，限制响应长度并校验 requestId。不自动重试。代理先预留持久预算，再请求上游；超时或失败不退回不确定用量，避免超发。严格 HTML 保护校验失败时丢弃结果；极端中英交替的保护包装超限会返回 `PROTECTION_LIMIT`，不误报原文超过 10,000 码点、不截断。

本地测试与假上游只能验证上述分支，不能证明真实 Azure 的 HTML 兼容、D10 保留效果、自然度、D1 binding、Workers CPU 限额或手机可达性。账户与部署步骤见 [代理说明](../server/translation-worker/README.md)；真实联通前不宣称翻译可用性已通过。

TTS 需检测引擎、语言、口音和语音数据，支持停止及资源释放；离线能力必须设备验证。词卡/复习/备份需持久化与恢复一致性、损坏文件不破坏旧数据、算法版本兼容等测试，当前均未接入。

## 出现问题时

记录版本、设备/系统、输入编码与大小、复现步骤、预期/实际、是否每次出现；用合成数据缩小复现。固定版本后回归相关解析、状态和交互，不只重试整套构建。已有失败模式与后续自动检查机会见 [技术债及 harness backlog](plans/tech-debt.md)。
