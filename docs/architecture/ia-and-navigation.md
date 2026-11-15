# 当前阅读页与导航

核对日期：2026-11-06。职责：描述实际入口和布局；源为 [MainActivity](../../app/src/main/java/com/bilingualauditor/app/MainActivity.kt) 和 [Manifest](../../app/src/main/AndroidManifest.xml)，不是用户草图。

只有 launcher MainActivity 和 ReaderScreen；无底栏、导航图、设置/历史/单词本/复习页或分享接收入口。选 TXT 进入系统 OpenDocument，结果回到同一页；原文非空先显示替换确认。

页面纵向显示标题、输入说明、选文件按钮、文件名、进度、原文区、10,000 码点计数、本人试用配置入口、翻译按钮/消息、译文及临时保留说明。外层滚动，使用 safeDrawing/imePadding；输入区限制显示行数。旋转、软键盘、大字体仍需手机验证。

翻译仍在同页完成，支持 loading、旧译文过期及英文原样阅读提示。超限标红并弹窗，翻译按钮禁用；弹窗仅说明后续文件夹组织方向，没有可用的保存或新建文件夹按钮。配置弹窗录入完整 HTTPS `/translate` 地址及个人访问凭证，仅保留内存，可清除；不接收 Azure 服务密钥。未来设计先读 [规格](../product-specs/index.md)、[DESIGN](../DESIGN.md)、[UI 指南](../FRONTEND.md)。
