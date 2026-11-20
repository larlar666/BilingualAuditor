package com.bilingualauditor.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class DeepSeekModeRecoveryTest {
    private class Disk : CredentialDisk {
        var bytes: ByteArray? = null
        var fail = false
        var entered: java.util.concurrent.CountDownLatch? = null
        var release: java.util.concurrent.CountDownLatch? = null
        override fun read() = bytes
        override fun write(bytes: ByteArray) {
            entered?.countDown()
            release?.let { check(it.await(2, java.util.concurrent.TimeUnit.SECONDS)) }
            check(!fail); this.bytes = bytes.clone()
        }
        override fun deleteRecord() { error("Mode metadata must survive") }
    }
    private val crypto = object : CredentialCipher {
        override fun encrypt(key: String) = key.toByteArray()
        override fun decrypt(record: ByteArray) = String(record)
        override fun deleteAlias() {}
    }
    private class Client : OfficialDeepSeekClient {
        var calls = 0
        override suspend fun check(key: DeepSeekApiKey) { calls++ }
        override suspend fun translate(text: String, key: DeepSeekApiKey): String { calls++; return "Translated" }
    }
    private suspend fun ready(model: ReaderViewModel) {
        repeat(400) { if (!model.state.value.keyBusy && !model.state.value.keyLoading) return; delay(5) }
        fail("Configuration operation timed out")
    }
    private suspend fun model(disk: Disk, client: Client): ReaderViewModel =
        ReaderViewModel(mainDispatcher = Dispatchers.Unconfined, officialClient = client).also {
            it.initializeKeyRepository(DeepSeekKeyRepository(disk, crypto)); ready(it)
        }
    private fun proxy(model: ReaderViewModel, mode: TranslationMode, done: () -> Unit = {}): Boolean =
        model.configureTranslation(if (mode == TranslationMode.TEMP_PC_DEEPSEEK) "https://10.1.2.3:8765/translate" else "https://example.com/translate",
            "a".repeat(32), mode, if (mode == TranslationMode.TEMP_PC_DEEPSEEK) "aa".repeat(32) else "", done)

    @Test fun bothProxyModesSurviveRestartWithoutActivatingRetainedOfficialKey() = runBlocking {
        for (mode in listOf(TranslationMode.GENERIC_HTTPS, TranslationMode.TEMP_PC_DEEPSEEK)) {
            val disk = Disk(); val client = Client(); val first = model(disk, client)
            first.configureDeepSeek("synthetic-key", true); ready(first)
            assertTrue(proxy(first, mode)); ready(first)
            val next = model(disk, client)
            assertEquals(mode, next.state.value.serviceMode)
            assertEquals(if (mode == TranslationMode.GENERIC_HTTPS) 10000 else 1000, next.state.value.activeLimit)
            assertFalse(next.state.value.serviceConfigured); assertTrue(next.state.value.keyRemembered)
            next.edit("中文"); next.translate(); next.checkConnection(); assertEquals(0, client.calls)
            next.configureDeepSeek(null, true); ready(next)
            assertTrue(next.state.value.serviceConfigured); assertEquals(TranslationMode.DEEPSEEK_DIRECT, next.state.value.serviceMode)
            next.translate(); assertEquals(1, client.calls)
        }
    }
    @Test fun clearProxyAndDeleteKeyPreserveSelectedModeAcrossRestart() = runBlocking {
        val disk = Disk(); val client = Client(); val first = model(disk, client)
        first.configureDeepSeek("synthetic-key", true); ready(first)
        proxy(first, TranslationMode.TEMP_PC_DEEPSEEK); ready(first)
        first.clearTranslationSettings(); ready(first)
        val next = model(disk, client)
        assertEquals(TranslationMode.TEMP_PC_DEEPSEEK, next.state.value.serviceMode)
        assertFalse(next.state.value.serviceConfigured); assertTrue(next.state.value.deepSeekConfigured)
        next.deleteDeepSeekKey(); ready(next)
        val last = model(disk, client)
        assertEquals(TranslationMode.TEMP_PC_DEEPSEEK, last.state.value.serviceMode)
        assertFalse(last.state.value.serviceConfigured); assertFalse(last.state.value.deepSeekConfigured)
        last.edit("中文"); last.translate(); assertEquals(0, client.calls)
    }
    @Test fun failedModeWriteDoesNotPublishOrCloseDialogAndDiskKeepsOldSelection() = runBlocking {
        val disk = Disk(); val client = Client(); val first = model(disk, client)
        first.configureDeepSeek("synthetic-key", true); ready(first)
        disk.fail = true; var completed = false
        proxy(first, TranslationMode.GENERIC_HTTPS) { completed = true }; ready(first)
        assertFalse(completed); assertTrue(first.state.value.serviceConfigured)
        assertEquals(TranslationMode.DEEPSEEK_DIRECT, first.state.value.serviceMode)
        assertTrue(first.state.value.message!!.contains("失败"))
        val next = model(disk, client)
        assertTrue(next.state.value.serviceConfigured); assertEquals(TranslationMode.DEEPSEEK_DIRECT, next.state.value.serviceMode)
        disk.fail = false; proxy(first, TranslationMode.GENERIC_HTTPS); ready(first)
        disk.fail = true; first.clearTranslationSettings { completed = true }; ready(first)
        assertFalse(completed); assertTrue(first.state.value.serviceConfigured)
        assertEquals(TranslationMode.GENERIC_HTTPS, model(disk, client).state.value.serviceMode)
    }
    @Test fun onlyThisProcessDoesNotPersistKeyButDoesPersistSelectedMode() = runBlocking {
        val disk = Disk(); val client = Client(); val first = model(disk, client)
        first.configureDeepSeek("synthetic-key", true); ready(first)
        first.configureDeepSeek(null, false); ready(first)
        val next = model(disk, client)
        assertEquals(TranslationMode.DEEPSEEK_DIRECT, next.state.value.serviceMode)
        assertFalse(next.state.value.serviceConfigured); assertFalse(next.state.value.keyRemembered)
        assertFalse(String(disk.bytes!!).contains("synthetic-key"))
    }
    @Test fun legacyKeyNeedsExplicitApplyBeforeAnyOfficialRequest() = runBlocking {
        val disk = Disk().apply { bytes = "synthetic-legacy-key".toByteArray() }; val client = Client()
        val first = model(disk, client)
        assertTrue(first.state.value.deepSeekConfigured); assertFalse(first.state.value.serviceConfigured)
        first.edit("中文"); first.translate(); first.checkConnection(); assertEquals(0, client.calls)
        first.configureDeepSeek(null, true); ready(first); first.translate(); assertEquals(1, client.calls)
        assertTrue(model(disk, client).state.value.serviceConfigured)
    }
    @Test fun modeSaveBusyRejectsCompetingConfigurationButPreservesSourceEdits() = runBlocking {
        val disk = Disk(); val client = Client(); val first = model(disk, client)
        first.configureDeepSeek("synthetic-key", true); ready(first)
        disk.entered = java.util.concurrent.CountDownLatch(1); disk.release = java.util.concurrent.CountDownLatch(1)
        proxy(first, TranslationMode.GENERIC_HTTPS)
        assertTrue(disk.entered!!.await(2, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(first.state.value.keyBusy)
        first.edit("新正文"); first.configureDeepSeek("replacement", true); first.deleteDeepSeekKey()
        first.clearTranslationSettings(); assertFalse(proxy(first, TranslationMode.TEMP_PC_DEEPSEEK))
        first.translate(); first.checkConnection(); assertEquals(0, client.calls)
        disk.release!!.countDown(); ready(first)
        assertEquals("新正文", first.state.value.source)
        assertEquals(TranslationMode.GENERIC_HTTPS, first.state.value.serviceMode)
        assertTrue(first.state.value.serviceConfigured)
    }
}
