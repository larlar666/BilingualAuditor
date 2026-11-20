package com.bilingualauditor.app

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.URL
import java.security.cert.Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class DeepSeekTranslationClientTest {
    private val key = DeepSeekApiKey.parse("synthetic-test-key")
    private open class Connection(url: URL, val status: Int = 200, val response: String = "") : HttpsURLConnection(url) {
        val sent = ByteArrayOutputStream(); val disconnected = CountDownLatch(1)
        override fun getResponseCode() = status
        override fun getInputStream(): InputStream = ByteArrayInputStream(response.toByteArray())
        override fun getOutputStream(): OutputStream = sent
        override fun disconnect() { disconnected.countDown() }
        override fun connect() {}
        override fun usingProxy() = false
        override fun getCipherSuite() = "fake"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
    }
    private fun response(content: String = "{\"translation\":\"Hello\"}", finish: String = "stop", extra: String = "") =
        "{\"object\":\"chat.completion\",\"model\":\"deepseek-flash\",\"choices\":[{\"index\":0,\"finish_reason\":\"$finish\",\"message\":{\"role\":\"assistant\",\"content\":${StrictJson.quote(content)}$extra}}]}"
    @Test fun fixedRequestAndPureEnglishBypass() = runBlocking {
        var calls = 0; lateinit var connection: Connection
        val client = DeepSeekTranslationClient(open = { url -> calls++; Connection(url, response = response()).also { connection = it } })
        assertEquals("English 😀", client.translate("English 😀", key)); assertEquals(0, calls)
        assertEquals("Hello", client.translate("你好", key)); assertEquals(1, calls)
        assertEquals("https://api.deepseek.com/chat/completions", connection.url.toString())
        assertFalse(connection.instanceFollowRedirects); assertEquals("Bearer synthetic-test-key", connection.getRequestProperty("Authorization"))
        val body = StrictJson.parse(connection.sent.toString("UTF-8")) as Map<*, *>
        assertEquals("deepseek-flash", body["model"]); assertEquals(false, body["stream"])
        assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS))
    }
    @Test fun modelCheckRequiresExpectedModelAndDoesNotGenerate() = runBlocking {
        val urls = mutableListOf<String>()
        DeepSeekTranslationClient(open = { urls += it.toString(); Connection(it, response = "{\"object\":\"list\",\"data\":[{\"id\":\"deepseek-flash\"}]}") }).check(key)
        assertEquals(listOf("https://api.deepseek.com/models"), urls)
        for (body in listOf("{}", "{\"object\":\"list\",\"data\":[{\"id\":\"other\"}]}")) assertTrue(runCatching { DeepSeekTranslationClient(open = { Connection(it, response = body) }).check(key) }.isFailure)
    }
    @Test fun statusErrorsDoNotLeakBodiesOrRetryOrFollowRedirects() = runBlocking {
        for ((status, expected) in listOf(401 to "DEEPSEEK_UNAUTHORIZED", 403 to "DEEPSEEK_FORBIDDEN", 402 to "DEEPSEEK_BALANCE", 429 to "RATE_LIMITED", 503 to "SERVICE_UNAVAILABLE", 302 to "INVALID_RESPONSE")) {
            var calls = 0
            val error = runCatching { DeepSeekTranslationClient(open = { calls++; Connection(it, status, "secret-upstream-body") }).translate("你好", key) }.exceptionOrNull() as TranslationFailure
            assertEquals(expected, error.code); assertEquals(1, calls); assertFalse(error.toString().contains("secret"))
        }
    }
    @Test fun malformedResponsesNeverBecomeTranslations() = runBlocking {
        for (body in listOf(response(finish = "length"), response("{\"translation\":\" \"}"), response(extra = ",\"tool_calls\":[]"), response(extra = ",\"reasoning_content\":\"unexpected\""), response("{\"translation\":\"x\",\"translation\":\"y\"}"), "x".repeat(128 * 1024 + 1), "{bad}")) {
            assertTrue(runCatching { DeepSeekTranslationClient(open = { Connection(it, response = body) }).translate("你好", key) }.isFailure)
        }
    }
    private class BlockingConnection(url: URL, val stage: String) : Connection(url) {
        val entered = CountDownLatch(1)
        private fun block() { entered.countDown(); check(disconnected.await(5, TimeUnit.SECONDS)); throw java.io.IOException("synthetic") }
        override fun getOutputStream(): OutputStream = if (stage == "upload") object : OutputStream() { override fun write(b: Int) = block(); override fun write(b: ByteArray, off: Int, len: Int) = block() } else super.getOutputStream()
        override fun getResponseCode(): Int { if (stage == "headers") block(); return 200 }
        override fun getInputStream(): InputStream = object : InputStream() { override fun read(): Int { block(); return -1 }; override fun read(b: ByteArray, off: Int, len: Int): Int { block(); return -1 } }
    }
    @Test fun cancellationDisconnectsActualUploadHeadersAndRead() = runBlocking {
        for (stage in listOf("upload", "headers", "read")) {
            val connection = BlockingConnection(URL("https://api.deepseek.com/chat/completions"), stage)
            val task = async(kotlinx.coroutines.Dispatchers.Unconfined) { DeepSeekTranslationClient(open = { connection }).translate("你好", key) }
            assertTrue(connection.entered.await(2, TimeUnit.SECONDS)); task.cancelAndJoin()
            assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS)); assertTrue(task.isCancelled)
        }
    }
    @Test fun overallDeadlineDisconnectsWhileUploadIsBlocked() = runBlocking {
        for (stage in listOf("upload", "headers", "read")) {
            val connection = BlockingConnection(URL("https://api.deepseek.com/chat/completions"), stage)
            val error = runCatching { DeepSeekTranslationClient(open = { connection }, deadlineMillis = 100).translate("你好", key) }.exceptionOrNull() as TranslationFailure
            assertEquals("UPSTREAM_TIMEOUT", error.code); assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS))
        }
    }
    @Test fun cancellationDuringHandleCreationOrBeforeUploadDoesNotSend() = runBlocking {
        for (stage in listOf("creation", "configuration", "output")) {
            val entered = CountDownLatch(1); val release = CountDownLatch(1)
            val connection = object : Connection(URL("https://api.deepseek.com/chat/completions")) {
                private fun pause() { entered.countDown(); check(release.await(2, TimeUnit.SECONDS)) }
                override fun setRequestProperty(name: String, value: String) {
                    if (stage == "configuration" && name == "Accept") pause()
                    super.setRequestProperty(name, value)
                }
                override fun getOutputStream(): OutputStream { if (stage == "output") pause(); return sent }
            }
            val task = async(kotlinx.coroutines.Dispatchers.Unconfined) {
                DeepSeekTranslationClient(open = {
                    if (stage == "creation") { entered.countDown(); check(release.await(2, TimeUnit.SECONDS)) }
                    connection
                }).translate("你好", key)
            }
            assertTrue(entered.await(2, TimeUnit.SECONDS)); task.cancelAndJoin(); release.countDown()
            assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS))
            assertEquals(0, connection.sent.size())
        }
    }
}
