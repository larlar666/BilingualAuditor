# 证据索引

更新时间：2026-11-03。职责：区分读取来源、可证事实、推断、未知、人工检查和执行前提。不存密钥、私人原文或无关聊天全文。

- [三聊天回顾](chat-review-2026-11-03.md)：必要用户决定/历史结果与分页范围，不依赖只读列表摘要。
- [历史验证](verification-history.md)：原构建/测试/Lint/图标结果、具体版本限制与真机缺口。本轮没有重跑应用检查。
- [本轮知识库记录](knowledge-bootstrap-2026-11-03.md)：读写范围、所有权变化、静态校验及保留项。
- [2026-10-23 workflow 安装](workflow-bootstrap-install.md)：安装时检查数与 human_acceptance_required，不因本轮知识维护而回写当时数据。
- [2026-11-07 翻译 Secret 绑定审计](translation-secret-binding-audit.md)：区分用户配置报告、生产绑定类型及后续加密/真实调用门槛；不记录凭证值。

- [2026-11-07 私人启用与运行时配置审计](translation-live-configuration-audit.md)：本人 token 已上传、首个无鉴权请求 503、空 guard 恢复、真实 Azure 零调用与后续审计门槛；用户已确认保存/关闭私窗，工具最终退出待取得。

后续只读审计可用 `<feature>-audit.md` 或专题目录，注明日期、文件/聊天出处、验证命令与版本、未测项和授权边界；具体当前质量由 [QUALITY_SCORE](../QUALITY_SCORE.md) 索引。Team Loop 的 audit-first 只在显式触发且满足条件时采用。

- [2026-11-13 手机热点 DeepSeek 演示](deepseek-phone-hotspot-demo.md)：新独立预算、Android 自动检查、后端／启动器阶段与真机未测；不是旧四样本或云部署证据。
