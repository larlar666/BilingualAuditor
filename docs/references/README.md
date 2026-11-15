# 技术参考与来源

更新时间：2026-11-03。职责：带来源与版本的入口，不创建不存在的工具或 schema。

| 来源 | 版本/时点 | 用途与限制 |
| --- | --- | --- |
| [OpenAI Harness engineering](https://openai.com/index/harness-engineering/) | 2026-02-11 发布；2026-11-03 打开英文原文，指定中文页抓取超时 | 借鉴短入口/渐进阅读/反馈；不是本项目已具备自治或 CI 的证明 |
| [根 Gradle](../../build.gradle.kts)、[app Gradle](../../app/build.gradle.kts)、[wrapper](../../gradle/wrapper/gradle-wrapper.properties) | AGP 8.6.1、Kotlin/Compose compiler 2.0.21、Gradle 8.10.2；其他版本查原文件 | 环境/命令沿用 [development](../../BilingualAuditor-docs/docs/development.md)，本轮未下载或构建 |
| [技术初评及其中官方链接](../../BilingualAuditor-docs/docs/technical-evaluation.md) | 2026-10-21 历史核查 | 免费层/词典/FSRS 候选，实施前复核；本轮未更新价格/许可判断 |
| [workflow marker](../workflow/.codex-teammode-version) | 0.3.1；commit 521c6331c13c65dac0c7f6112d4c70b833f0770d | 本轮不升级；项目外层知识维护不改 managed blocks |
| [图标脚本](../../tools/generate-app-icon.ps1) | 现有 Windows System.Drawing 实现 | 真实生成源；产物在 output/imagegen 与 app/res，本轮未运行 |

没有 Room/schema/部署资料的真实生成源，因此不建 docs/generated、db-schema 或虚假服务说明。后续出现真实生成器、输入、版本和命令后再建，并注明生成物不能直接手改。
