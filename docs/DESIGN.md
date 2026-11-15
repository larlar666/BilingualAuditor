# 视觉与交互指南

核对日期：2026-11-03。职责：用户体验与视觉设计入口。界面代码职责见 [FRONTEND](FRONTEND.md)。

## 当前设计依据

简易界面、后续用户草图调整的偏好见 [core-beliefs](design-docs/core-beliefs.md)。图标的正式人工选择见 [D11](../BilingualAuditor-docs/docs/decisions.md)，原手稿完善与“作为 app 图标”的聊天来源见 [回顾证据](evidence/chat-review-2026-11-03.md)。尚无其他已确认完整 UI 设计系统，不自创颜色、间距、导航稿作为用户合同。

界面应让用户区分原文、译文、加载、错误和服务未接入；不能将测试文本显示为真实翻译。当前代码的具体布局见 [IA](architecture/ia-and-navigation.md)，本指南不重复布局快照。

## 图标工作路径

- 原图：[bilingual-app-icon-refined.png](../output/imagegen/bilingual-app-icon-refined.png)。生成资源及脚本位置由 [架构](../ARCHITECTURE.md) 定义。
- 生成方法与执行方式：沿用 [development 的图标资源节](../BilingualAuditor-docs/docs/development.md)。脚本参数是当前实现，不是所有 Android 图标的通用保证；运行会写 res 与 output，文档任务不运行。
- 圆形预览：[app-icon-circle-preview.png](../output/imagegen/app-icon-circle-preview.png)，只反映已有导出结果。本次未重新生成或目视验收。
- 改图标后检查 Manifest/adaptive XML 引用、静态检查与 APK 实际资源；真机圆形/圆角/单色主题显示单独记录，历史检查见 [验证证据](evidence/verification-history.md)。

修改前保留用户确认原图，标明新方案是候选还是已批准；不因工具生成成功就声明用户接受新设计。
