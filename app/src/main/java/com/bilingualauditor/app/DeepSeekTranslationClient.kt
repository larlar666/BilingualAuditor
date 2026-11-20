package com.bilingualauditor.app

import java.io.ByteArrayOutputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine

internal interface OfficialDeepSeekClient {
    suspend fun check(key: DeepSeekApiKey)
    suspend fun translate(text: String, key: DeepSeekApiKey): String
}

/** Fixed official endpoints and system TLS only. No retry, redirects, proxy TLS pins or raw errors. */
internal class DeepSeekTranslationClient(
    private val open: (URL) -> HttpsURLConnection = { it.openConnection() as HttpsURLConnection },
    private val deadlineMillis: Long = 60_000,
) : OfficialDeepSeekClient {
    override suspend fun check(key: DeepSeekApiKey) {
        val root = request("/models", key, null)
        val entries = root["data"] as? List<*> ?: throw TranslationFailure("INVALID_RESPONSE")
        if (root["object"] != "list" || entries.isEmpty() || entries.any { it !is Map<*, *> || it["id"] !is String } ||
            entries.none { (it as Map<*, *>)["id"] == "deepseek-flash" }) throw TranslationFailure("INVALID_RESPONSE")
    }
    override suspend fun translate(text: String, key: DeepSeekApiKey): String {
        val prepared = DeepSeekTextProtection.prepare(text)
        if (TranslationPolicy.canDisplayUnchanged(text)) return text
        val root = request("/chat/completions", key, DeepSeekTextProtection.payload(prepared))
        try {
            require(root["object"] == "chat.completion" && root["model"] == "deepseek-flash")
            val choices = root["choices"] as? List<*> ?: error("choices"); require(choices.size == 1)
            val choice = choices.single() as? Map<*, *> ?: error("choice")
            require(choice["finish_reason"] == "stop" && choice["index"] == java.math.BigDecimal.ZERO)
            val message = choice["message"] as? Map<*, *> ?: error("message")
            require(message["role"] == "assistant" && message["tool_calls"] == null && message["function_call"] == null && message["refusal"] == null &&
                (message["reasoning_content"] == null || message["reasoning_content"] == ""))
            val content = message["content"] as? String ?: error("content")
            root["usage"]?.let { usage ->
                require(usage is Map<*, *>)
                for (name in listOf("prompt_tokens", "completion_tokens", "total_tokens")) {
                    val number = usage[name] as? java.math.BigDecimal ?: error("usage")
                    require(number.scale() <= 0 && number >= java.math.BigDecimal.ZERO && number <= java.math.BigDecimal(1_000_000))
                }
            }
            return DeepSeekTextProtection.restore(content, prepared.fragments)
        } catch (failure: TranslationFailure) { throw failure
        } catch (_: Exception) { throw TranslationFailure("INVALID_RESPONSE") }
    }
    private suspend fun request(path: String, key: DeepSeekApiKey, payload: String?): Map<*, *> = suspendCancellableCoroutine { continuation ->
        val completed = java.util.concurrent.atomic.AtomicBoolean(false)
        val lock = Any(); var connection: HttpsURLConnection? = null
        var stopped = false
        fun stop() {
            val handle = synchronized(lock) { stopped = true; connection.also { connection = null } }
            // Never hold the state lock or the single deadline scheduler during potentially blocking platform cleanup.
            if (handle != null) Dispatchers.IO.dispatch(kotlin.coroutines.EmptyCoroutineContext, Runnable { runCatching { handle.disconnect() } })
        }
        continuation.invokeOnCancellation { completed.set(true); stop() }
        val timer = deadlines.schedule({
            val failure = TranslationFailure("UPSTREAM_TIMEOUT")
            if (completed.compareAndSet(false, true)) continuation.resumeWith(Result.failure(failure))
            stop()
        }, deadlineMillis, TimeUnit.MILLISECONDS)
        Dispatchers.IO.dispatch(continuation.context, Runnable {
            try {
                // openConnection allocates a handle; it does not connect. A cancellation during creation
                // must close the newly returned handle without ever starting an HTTP operation.
                val created = open(URL("https://api.deepseek.com$path"))
                val active = synchronized(lock) {
                    if (stopped || !continuation.isActive) null else created.also { connection = it }
                }
                if (active == null) { created.disconnect(); throw CancellationException() }
                active.instanceFollowRedirects = false; active.connectTimeout = 15_000; active.readTimeout = 30_000
                active.requestMethod = if (payload == null) "GET" else "POST"
                active.setRequestProperty("Authorization", "Bearer ${key.value}")
                active.setRequestProperty("Accept", "application/json")
                if (payload != null) {
                    active.doOutput = true; active.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    val bytes = payload.toByteArray(Charsets.UTF_8); active.setFixedLengthStreamingMode(bytes.size)
                    if (!continuation.isActive) throw CancellationException()
                    active.outputStream.use { if (!continuation.isActive) throw CancellationException(); it.write(bytes) }
                }
                if (!continuation.isActive) throw CancellationException()
                val status = active.responseCode
                if (status != 200) throw TranslationFailure(when (status) {
                    401 -> "DEEPSEEK_UNAUTHORIZED"; 403 -> "DEEPSEEK_FORBIDDEN"; 402 -> "DEEPSEEK_BALANCE"; 429 -> "RATE_LIMITED"
                    in 300..399 -> "INVALID_RESPONSE"; in 500..599 -> "SERVICE_UNAVAILABLE"; else -> "UPSTREAM_ERROR"
                })
                val bytes = ByteArrayOutputStream()
                active.inputStream.use { input ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        if (!continuation.isActive) throw CancellationException()
                        val n = input.read(buffer); if (n < 0) break
                        if (bytes.size() + n > 128 * 1024) throw TranslationFailure("INVALID_RESPONSE")
                        bytes.write(buffer, 0, n)
                    }
                }
                val decoded = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
                val value = StrictJson.parse(decoded) as? Map<*, *> ?: throw TranslationFailure("INVALID_RESPONSE")
                if (completed.compareAndSet(false, true)) continuation.resumeWith(Result.success(value))
            } catch (error: Exception) {
                val safe = when (error) {
                    is CancellationException -> error
                    is TranslationFailure -> error
                    is SSLException -> TranslationFailure("TLS_ERROR")
                    is SocketTimeoutException -> TranslationFailure("UPSTREAM_TIMEOUT")
                    is java.io.IOException -> TranslationFailure("NETWORK_ERROR")
                    else -> TranslationFailure("INVALID_RESPONSE")
                }
                if (completed.compareAndSet(false, true)) continuation.resumeWith(Result.failure(safe))
            } finally { timer.cancel(false); stop() }
        })
    }
    companion object { private val deadlines = Executors.newSingleThreadScheduledExecutor { runnable -> Thread(runnable, "deepseek-deadline").apply { isDaemon = true } } }
}
