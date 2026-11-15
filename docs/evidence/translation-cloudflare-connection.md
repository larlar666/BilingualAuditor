# Cloudflare 连接与授权记录

来源：2026-11-07（Asia/Shanghai）本轮用户控制台截图、Leader 提供的登录 CLI 摘要及 generator 实际 D1/部署 CLI 结果。此页记录连接及分阶段远端生效证据，不保存凭证、授权链接参数、设备码、邮箱或账户标识；不代表真实翻译或人工验收成立。

## 当前阶段

- 用户已进入 Cloudflare 控制台；截图账户与 CLI 唯一目标账户一致。Workers & Pages 显示无项目、Daily Requests 为 0/100000、存在 Upgrade 按钮及已有 `anrannarna.workers.dev` 子域。结合官方新账户默认 Workers Free 的条件，截图支持当前 Free 特征，足以继续已批准的免费部署；没有取得 API `plan=Free` 返回，也没有点击 Upgrade 或更改 billing。
- 固定工具为 Wrangler 4.158.0；本轮 CLI 帮助确认支持 device 与 browser 登录。所请求业务 scope 为 `account:read`、`user:read`、`workers_scripts:write`、`d1:write`；Wrangler 自动加入用于刷新的 `offline_access`。
- 首次 keyring 非交互尝试缺少 `@napi-rs/keyring`；官方交互自动安装因无 npm 未成功。Leader 已向用户说明并接受标准 CLI 存储：登录状态采用项目外用户配置目录的明文 fallback。未读取或输出 token，未将凭证写入仓库，也未全局安装更多工具。
- Device 流程在 token endpoint 遇到 `UND_ERR_SOCKET`，未成功。随后对 Cloudflare OAuth token 路径和 API 根路径进行不携带凭证的 GET 检查，均返回 HTTP 404；这仅说明当时能够连接对应主机，不能证明认证成功。
- 随后手动打开浏览器的 PKCE 尝试超时；再次使用默认浏览器自动打开的标准 PKCE 登录，CLI 返回 `Successfully logged in`、exit 0。Leader 的 `whoami --json` 返回 `loggedIn: true` 及唯一账户，与截图一致。认证成功不等于部署完成；不记录动态 URL、state 或 token。

## D1 实际生效记录

- 远端写入前，Leader 只读 `d1 list --json` 返回空数组；目标 Worker deployment 查询返回不存在（API 10007），无已有同名对象覆盖证据。
- 每次 CLI 固定唯一目标账户、使用 Wrangler 4.158.0，metrics 关闭、日志路径局限本地 `.wrangler/logs`；真实登录使用项目外用户配置，不设置本地检查用的 `XDG_CONFIG_HOME`。未读取日志或凭证原值。
- `d1 create bilingual-auditor-translation-budget` exit 0：创建于 WNAM，实际数据库 ID 为 `003ed1e0-0471-40e3-b54e-a3d37e211440`；已替换 `wrangler.toml` 占位，binding 保持 `DB`。
- `d1 migrations apply bilingual-auditor-translation-budget --remote` exit 0，`0001_translation_budget.sql` 标记成功。migration 仅创建 `translation_budget`（IF NOT EXISTS），语义仍为持久预算计数，不保存原文、译文或凭证；没有删除语句。
- 随后远端只读 `PRAGMA table_info(translation_budget)` 核对 `month`（TEXT 主键）、`characters`、`minute`、`requests`（INTEGER，默认 0）；`COUNT(*)` 为 0，`d1_migrations` 含 `0001_translation_budget.sql`。各查询 `success: true`、`changed_db: false`、`rows_written: 0`。因此 D1 schema 已远端生效，不等于翻译函数已上线。

## Worker 初步部署与后续门槛

2026-11-07 执行固定账户的 `wrangler deploy`，exit 0，已初步部署 `bilingual-auditor-translation`。地址为 `https://bilingual-auditor-translation.anrannarna.workers.dev`，版本 `f8d762d6-b3c8-48a9-b812-28d192a7116d`；CLI 报告上传及触发器部署成功，startup 1 ms。使用既有子域，没有注册新域名或出现付费提示。

绑定为实际 D1 `DB`，预算仍为每月 1,000,000、每分钟 6；observability 仍关闭。未配置 `AZURE_TRANSLATOR_KEY`、`AZURE_TRANSLATOR_REGION`、`ACCESS_TOKEN`，生产 `AZURE_TIER_CONFIRMED` 仍为空，缺配置拒绝调用。此版本是初步服务端部署，不能据此宣称真实翻译可用或完成 CPU 限额/手机可达性验收。本轮未变更函数或预算 schema 语义。

Leader 独立复核远端 `PRAGMA table_info(translation_budget)` exit 0，列及主键一致，`served_by: v3-prod`、WNAM/LAX、primary true，`changed_db: false`、`rows_written: 0`。随后无 Authorization 的 HTTPS `POST /translate` 使用合成文本和固定测试 UUID，收到 HTTP 503、安全 JSON `SERVICE_UNAVAILABLE` / `翻译服务暂不可用。` 及 `Cache-Control: no-store`，命令 exit 0。公网拒绝响应与当前空 guard/缺 secret 状态一致，不是翻译成功证据，也不能据此证明已启用服务时的鉴权行为。

Leader 已引导用户在 Worker 官方控制台安全录入 Azure key 与 `eastasia` 两个 Secrets；尚无用户完成回复，不能据此宣称配置已完成。本人 `ACCESS_TOKEN` 尚未生成或写入；未要求用户通过聊天、截图传递 key，也未要求启用 F0 guard。

用户对 `ba-lar` 是否仅供本项目使用已回复“是，仅供本项目使用”，因此专用性已获用户确认；F0 层级和区域 `eastasia` 来自用户报告，密钥有效、订阅存续及真实 Azure 请求仍未验证。真实英文保护效果、手机网络及人工验收继续待验证；既有本地结果见 [本地验证](translation-local-validation-2026-11-06.md)，后续范围见 [active plan](../plans/active/translation-integration.md)。

## 验证范围

本次核验认证、D1 远端结果、Worker 初步部署及公网拒绝响应；不重跑 Android 构建、单测或 Lint，也不将此前本地通过结果算作真机证明。后续需分别核对 secret 配置、F0 实际状态、启用 guard 后的版本、真实合成文本翻译与手机人工验收。
