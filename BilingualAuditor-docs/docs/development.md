# 开发与验证

## 当前最小版本

本文件保留构建环境、命令与操作方法；当前实现范围统一查 [current-state](../../docs/product/current-state.md)，模块/配置查 [ARCHITECTURE](../../ARCHITECTURE.md)，解析边界查 [domain-boundaries](../../docs/architecture/domain-boundaries.md)。产品合同见 product/decisions，不从开发方法推导需求已验收。

## 构建配置

- JDK：本机 21.0.6；Java/Kotlin 字节码目标 17。
- Gradle：8.10.2；Android Gradle Plugin：8.6.1。
- Kotlin / Compose Compiler 插件：2.0.21；Compose BOM：2024.10.01。
- SDK platform：35；Build Tools：35.0.1。
- Activity Compose：1.9.3；Lifecycle：2.8.7；JUnit：4.13.2。

固定一组版本便于复现，不宣称它们是最新版。基础依据：[AGP 8.6 兼容信息](https://developer.android.com/build/releases/agp-8-6-0-release-notes)、[Gradle 8.10.2 Java 兼容信息](https://docs.gradle.org/8.10.2/userguide/compatibility.html)、[Compose Compiler 配置](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)。发布前再审查工具版本与目标平台政策。

PowerShell 下，在当前进程设置 SDK 路径（不会改系统环境变量）：

```powershell
$env:ANDROID_HOME = 'C:\Users\a1234\AppData\Local\Android\Sdk'
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --console=plain
```

上述为本机已核对路径；Codex 受限进程的 LOCALAPPDATA 可能重定向，不能直接套用旧默认。其他 SDK 位置可通过本机 `local.properties` 中的 `sdk.dir` 指定，此文件不提交。默认仓库仅为 Google Maven、Maven Central 和 Gradle Plugin Portal；不自动添加第三方镜像。

## 验收

### 自动检查

`TxtReaderTest` 覆盖 UTF-8 中文与段落保持、BOM、GBK 拒绝、空文件、二进制/UTF-16 空字节、字节上限与字符上限；`TranslationPolicyTest` 与 `ReaderViewModelTest` 覆盖业务码点上限、英文免请求、请求失效和错误原文保留。后端在 `server/translation-worker` 运行 `node --test test/*.test.mjs`，使用假上游及本地真实 SQLite 并发；部署方法见 [代理说明](../../server/translation-worker/README.md)。

历史结果、日期/版本和留存证据限制统一查 [verification-history](../../docs/evidence/verification-history.md)，本轮结果见 [翻译本地验证](../../docs/evidence/translation-local-validation-2026-11-06.md)，质量缺口查 [QUALITY_SCORE](../../docs/QUALITY_SCORE.md)。下列是真机验收方法，不是已通过结果。

### 真机检查（均待执行）

- 安装并启动 APK，在系统选择器打开 `samples/chinese-utf8.txt`，原文与段落完整显示。
- 输入、长按粘贴和修改文字；旋转屏幕后内容仍在。
- 输入非空后再次选择 TXT，先看到替换提示；取消提示、取消文件选择或导入失败均保留旧原文。
- 打开空文件、GBK 文件、超过 256 KiB 文件时出现明确提示。
- 不配置服务时，中文翻译提示先配置并保留原文；纯英文可原样阅读，明确未发送翻译请求。
- 在既有导入安全上限内导入 10,001 码点文段，全文保留、标红并弹窗，翻译不可用；不建议截断/拆短，不提供虚假文件夹入口。
- 按代理说明完成账户、D1 apply、secret 与 Worker deploy 后，在 App 临时配置完整 HTTPS `/translate` 地址和本人凭证；重开应用需重填，不输入 Azure 服务密钥。
- 用合成中文/混合样本验证真实译文、原英文拼写/大小写/URL 保留、原文编辑后的旧译文标记、请求中换文件及网络/限流/额度失败保留。真实服务未就绪时不以模拟成功代替。
- 大文件读取时界面可响应，读取完成后可继续编辑。
- 窄屏、软键盘和系统导航栏下按钮可访问。

## 应用图标资源（2026-10-21）

已接入用户确认的图标，Manifest 的 `android:icon` 指向 `@mipmap/ic_launcher`。最低 API 26，所有支持的系统使用自适应图标，由系统套用圆形或圆角等蒙版；Android 13+ 主题图标提供简化的耳机笑脸单色版本。

设计原图：`output/imagegen/bilingual-app-icon-refined.png`。在项目根目录运行 `./tools/generate-app-icon.ps1` 可重新生成自适应位图、五档 PNG 导出和圆形裁切预览（`output/imagegen/app-icon-circle-preview.png`）。需要 Windows PowerShell / PowerShell 和 System.Drawing；不调用在线图片服务。主体放在 108 dp 图层中央的 66 dp 区域，并延展边缘填满背景，以减少不同桌面形状的裁切。预览仅检查静态圆形裁切，不代替真机桌面验收。

## 后续分享入口（候选，尚未实现）

用户询问从其他应用分享文字/TXT和拖至“岛”快捷加入的可能性。优先候选为 Android 标准 ACTION_SEND 接收文本及单个 TXT，进入阅读页后预览并手动翻译。接收分享不自动加入单词本。

系统分享是通用接口，来源应用决定实际分享内容；分享网址不等于已经抓取网页正文。[Android 接收分享说明](https://developer.android.com/develop/ui/compose/sharing/receive)

另一候选为 ACTION_PROCESS_TEXT：接收其他应用中选中的文字，可在后续查词阶段评估选词菜单入口；菜单展示由来源应用和系统决定，当前未实现。[Android 接口](https://developer.android.com/reference/android/content/Intent#ACTION_PROCESS_TEXT)

vivo 官方介绍“原子岛拖放直达”，但本次尚未找到足够的第三方 APK 接入条件，不能承诺应用会出现在岛内。[vivo 说明](https://www.vivo.com.cn/service/questions/all?categoryId=158&questionId=1744)
