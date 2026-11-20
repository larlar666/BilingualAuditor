package com.bilingualauditor.app

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

fun interface TranslationClient {
    suspend fun translate(text: String, requestId: String, settings: TranslationSettings): String
}

class TranslationFailure(val code: String) : Exception(code)

object TranslationEndpoint {
    fun healthUri(endpoint: String): URI {
        val uri = URI(endpoint)
        return URI(uri.scheme, null, uri.host, uri.port, "/health", null, null)
    }
    fun isValid(value: String): Boolean = try {
        val uri = URI(value)
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
            uri.rawPath == "/translate" && uri.rawQuery == null && uri.rawFragment == null
    } catch (_: Exception) {
        false
    }
}

class HttpsTranslationClient : TranslationClient, ProxyHealthClient {
    override suspend fun check(settings: TranslationSettings): ProxyHealth = withContext(Dispatchers.IO) {
        if (!settings.valid || settings.mode != TranslationMode.TEMP_PC_DEEPSEEK) throw TranslationFailure("INVALID_CONFIG")
        val connection = openConnection(settings, true) as HttpsURLConnection
        try {
            PinnedTls.apply(connection, settings)
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Authorization", "Bearer ${settings.accessToken}")
            connection.setRequestProperty("Accept", "application/json")
            when (connection.responseCode) {
                200 -> ProxyHealth.parse(JSONObject(connection.inputStream.use { readBounded(it, connection, System.nanoTime() + 10_000_000_000L) }))
                401, 403 -> throw TranslationFailure("UNAUTHORIZED")
                in 300..399 -> throw TranslationFailure("INVALID_RESPONSE")
                else -> throw TranslationFailure("SERVICE_UNAVAILABLE")
            }
        } catch (error: TranslationFailure) { throw error
        } catch (_: SSLException) { throw TranslationFailure("TLS_ERROR")
        } catch (_: SocketTimeoutException) { throw TranslationFailure("UPSTREAM_TIMEOUT")
        } catch (_: IOException) { throw TranslationFailure("NETWORK_ERROR")
        } catch (_: JSONException) { throw TranslationFailure("INVALID_RESPONSE")
        } finally { connection.disconnect() }
    }
    override suspend fun translate(
        text: String,
        requestId: String,
        settings: TranslationSettings,
    ): String = withContext(Dispatchers.IO) {
        if (!settings.valid) throw TranslationFailure("INVALID_CONFIG")
        if (settings.mode == TranslationMode.TEMP_PC_DEEPSEEK && TranslationPolicy.count(text) > 1000) throw TranslationFailure("TEXT_TOO_LONG")
        if (!TranslationSettings.isValidToken(settings.accessToken)) throw TranslationFailure("INVALID_CONFIG")
        val deadlineNanos = System.nanoTime() + 45_000_000_000L
        val connection = openConnection(settings, false) as HttpsURLConnection
        try {
            PinnedTls.apply(connection, settings)
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 25_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${settings.accessToken}")
            val payload = JSONObject().put("text", text).put("requestId", requestId)
                .toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
            val status = connection.responseCode
            // Never send a bearer credential to a redirect destination.
            if (status in 300..399) throw TranslationFailure("INVALID_RESPONSE")
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.use { readBounded(it, connection, deadlineNanos) } ?: ""
            if (status != 200) {
                val code = try { JSONObject(response).optJSONObject("error")?.optString("code") }
                catch (_: JSONException) { null }
                throw TranslationFailure(code?.takeIf { it in KNOWN_ERRORS } ?: when (status) {
                    401, 403 -> "UNAUTHORIZED"
                    429 -> "RATE_LIMITED"
                    503 -> "SERVICE_UNAVAILABLE"
                    else -> "UPSTREAM_ERROR"
                })
            }
            val json = JSONObject(response)
            if (json.optString("requestId") != requestId || json.opt("translation") !is String) {
                throw TranslationFailure("INVALID_RESPONSE")
            }
            val translation = json.getString("translation")
            if (translation.isBlank() || TranslationPolicy.count(translation) > MAX_RESPONSE_CHARACTERS) {
                throw TranslationFailure("INVALID_RESPONSE")
            }
            translation
        } catch (error: TranslationFailure) {
            throw error
        } catch (_: SSLException) {
            throw TranslationFailure("TLS_ERROR")
        } catch (_: SocketTimeoutException) {
            throw TranslationFailure("UPSTREAM_TIMEOUT")
        } catch (_: IOException) {
            throw TranslationFailure("NETWORK_ERROR")
        } catch (_: JSONException) {
            throw TranslationFailure("INVALID_RESPONSE")
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(settings: TranslationSettings, health: Boolean): java.net.URLConnection {
        val url = (if (health) TranslationEndpoint.healthUri(settings.endpoint) else URI(settings.endpoint)).toURL()
        return if (settings.mode == TranslationMode.TEMP_PC_DEEPSEEK) url.openConnection(java.net.Proxy.NO_PROXY) else url.openConnection()
    }

    private fun readBounded(input: InputStream, connection: HttpsURLConnection, deadlineNanos: Long): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val remainingMillis = (deadlineNanos - System.nanoTime()) / 1_000_000L
            if (remainingMillis <= 0) throw TranslationFailure("UPSTREAM_TIMEOUT")
            connection.readTimeout = remainingMillis.coerceAtMost(25_000).toInt().coerceAtLeast(1)
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) throw TranslationFailure("INVALID_RESPONSE")
            output.write(buffer, 0, count)
        }
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(output.toByteArray())).toString()
        } catch (_: CharacterCodingException) {
            throw TranslationFailure("INVALID_RESPONSE")
        }
    }

    private companion object {
        const val MAX_RESPONSE_BYTES = 512 * 1024
        const val MAX_RESPONSE_CHARACTERS = 100_000
        val KNOWN_ERRORS = setOf(
            "INVALID_REQUEST", "TEXT_TOO_LONG", "UNAUTHORIZED", "RATE_LIMITED", "QUOTA_EXCEEDED",
            "SERVICE_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_ERROR", "PRESERVATION_FAILED", "PROTECTION_LIMIT",
        )
    }
}

fun translationErrorMessage(code: String): String = when (code) {
    "INVALID_KEY" -> "⚠️ 请输入有效的 DeepSeek Key；不允许空白或控制字符。"
    "KEY_LOAD_FAILED" -> "无法读取保存的 Key，请重新输入；旧记录未自动删除。"
    "KEY_SAVE_FAILED" -> "Key 配置未应用：持久记录操作失败，原配置保留。"
    "KEY_DELETE_FAILED" -> "Key 未清除：记录删除失败，请重试。"
    "KEY_CLEANUP_PENDING" -> "Key 内存和密文已清除，但系统密钥清理失败，请再次删除完成清理。"
    "DEEPSEEK_UNAUTHORIZED" -> "DeepSeek Key 无效或已撤销，请检查 Key。"
    "DEEPSEEK_FORBIDDEN" -> "DeepSeek 拒绝访问，请检查账户权限。"
    "DEEPSEEK_BALANCE" -> "DeepSeek 账户余额不足，请自行检查账户。"
    "INVALID_CONFIG" -> "请配置有效的 HTTPS 翻译服务地址及个人访问凭证。"
    "TEXT_TOO_LONG" -> "文段超过翻译长度上限，原文已保留。"
    "UNAUTHORIZED" -> "访问凭证无效或已撤销，请检查试用配置。"
    "RATE_LIMITED" -> "请求过于频繁，请稍后手动重试。"
    "QUOTA_EXCEEDED" -> "当前试用次数或额度已用尽，原文已保留。"
    "UPSTREAM_TIMEOUT" -> "翻译请求超时，请稍后手动重试。"
    "TLS_ERROR" -> "HTTPS 证书验证失败，请核对电脑地址、证书指纹和设备时间。"
    "NETWORK_ERROR" -> "无法连接翻译服务，请检查网络后重试。"
    "PRESERVATION_FAILED" -> "未能确认原有英文完整保留，本次译文未采用，请稍后重试。"
    "PROTECTION_LIMIT" -> "文段中的中英交替内容较多，暂时无法翻译，原文已保留。"
    "INVALID_RESPONSE" -> "翻译服务返回的结果不完整，本次译文未采用。"
    "INVALID_REQUEST" -> "翻译请求不符合要求，原文已保留。"
    else -> "翻译服务暂不可用，请稍后手动重试。"
}
