# Compose / UI 开发指南

核对日期：2026-11-13。职责：Android 前端职责与修改检查路径；不将网页框架约定套进项目。

当前 `ReaderScreen` 是 [MainActivity.kt](../app/src/main/java/com/bilingualauditor/app/MainActivity.kt) 的私有 composable，没有独立导航图或多个页面。`ReaderViewModel` 管导入、翻译和超限事件，`ReaderState` 是界面读模型，`TxtReader` 不承载 Compose 逻辑。本人试用配置通过临时弹窗录入，不是持久设置页。具体依赖和数据流见 [ARCHITECTURE](../ARCHITECTURE.md)。

本项目继续采用现有命名：Activity 表示 Android 入口，Screen 表示界面，ViewModel 表示状态与事件，Reader/Exception 表示文本读取及领域错误。新文件按职责拆分，不为符合模板预先引入空 service/repository 层。

UI 修改时核对：

- 先读 [产品规格](product-specs/index.md) 和 [DESIGN](DESIGN.md)，再读相关 composable 与 ViewModel；不要从按钮文案推断业务已经实现。
- 在 UI 收集生命周期感知的状态；阻塞文件读取保持在 IO，不放进 composable 重组路径。
- 导入期间当前代码禁用编辑/重复导入；替换确认、取消选择和错误消息不能使旧原文意外丢失。跨页面或持久化改动须更新架构与边界。
- 检查软键盘、安全区域、滚动、大字体及可访问的按钮；当前 minLines/maxLines 只是布局参数，不是测试通过证明。
- 当前粘贴依靠系统文本框菜单，尚无规格建议中的独立粘贴按钮；这一差距记录在 [技术债](plans/tech-debt.md)，不静默删除规格。
- 正常、空白、读取中、翻译中、超限、未配置、失败、英文原样展示及旧译文过期状态分别验收；配置凭证不使用 rememberSaveable。旋转保留与进程终止恢复不同，见 [可靠性](RELIABILITY.md)。

回归命令和手机清单见 [QUALITY_SCORE](QUALITY_SCORE.md)。未来分享入口与 TTS 控制应复用阅读场景，但尚未设计或集成，不在这里写成当前导航。

## 临时电脑 DeepSeek 模式

本人试用配置弹窗可切换“临时电脑 DeepSeek 代理”，填写私有 HTTPS 地址、已有 Bearer 与证书 SHA-256 pin；供应商 Key 只能留在电脑。该模式显示独立 1000 Unicode 码点上限和预算／公开短文说明，提供“检查连接（不调用模型）”与取消检查；health 展示代理策略及预算，不宣称模型可用。切换配置、编辑、导入或取消后的迟到状态不得覆盖当前内容；通用模式仍是一万码点。配置仅内存，不增加历史或持久设置页。用户操作与真机清单归 [手机指南](guides/deepseek-phone-hotspot-demo.md)，自动与未测范围归 [主证据](evidence/deepseek-phone-hotspot-demo.md)。
