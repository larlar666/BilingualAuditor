package com.bilingualauditor.app

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class DeepSeekViewModelTest {
    @Test fun editingDuringSavedKeyLoadDoesNotDiscardConfiguration() = runBlocking {
        val entered = java.util.concurrent.CountDownLatch(1); val release = java.util.concurrent.CountDownLatch(1)
        val model = ReaderViewModel(mainDispatcher = Dispatchers.Unconfined)
        model.initializeKeyRepository(DeepSeekKeyRepository(object : CredentialDisk {
            override fun read(): ByteArray { entered.countDown(); check(release.await(2, java.util.concurrent.TimeUnit.SECONDS)); return byteArrayOf(1) }
            override fun write(bytes: ByteArray) {}
            override fun deleteRecord() {}
        }, object : CredentialCipher {
            override fun encrypt(key: String) = byteArrayOf(1)
            override fun decrypt(record: ByteArray) = "synthetic-saved-key"
            override fun deleteAlias() {}
        }))
        assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
        model.edit("正在恢复时编辑")
        assertFalse(model.configureTranslation("https://example.com/translate", "a".repeat(32)))
        release.countDown()
        repeat(200) { if (model.state.value.keyLoading) delay(5) }
        assertFalse(model.state.value.keyLoading); assertFalse(model.state.value.serviceConfigured)
        assertTrue(model.state.value.deepSeekConfigured); assertTrue(model.state.value.keyRemembered)
        assertEquals("正在恢复时编辑", model.state.value.source)
    }
    private class Client : OfficialDeepSeekClient {
        val translations = mutableListOf<Continuation<String>>()
        val checks = mutableListOf<Continuation<Unit>>()
        override suspend fun check(key: DeepSeekApiKey) = suspendCoroutine { checks += it }
        override suspend fun translate(text: String, key: DeepSeekApiKey): String = suspendCoroutine { translations += it }
    }
    private fun model(client: Client): ReaderViewModel = ReaderViewModel(mainDispatcher = Dispatchers.Unconfined, officialClient = client).also {
        it.installKeyRepository(DeepSeekKeyRepository(object : CredentialDisk {
            override fun read(): ByteArray? = null
            override fun write(bytes: ByteArray) {}
            override fun deleteRecord() {}
        }, object : CredentialCipher {
            override fun encrypt(key: String) = key.toByteArray()
            override fun decrypt(record: ByteArray) = String(record)
            override fun deleteAlias() {}
        }))
    }
    private suspend fun configured(model: ReaderViewModel) {
        model.configureDeepSeek("synthetic-key", false)
        repeat(200) { if (!model.state.value.keyBusy) return; delay(5) }
        fail("Key operation timed out")
    }
    @Test fun directLimitEnglishBypassAndConfigurationDoesNotAccessNetwork() = runBlocking {
        val client = Client(); val model = model(client); configured(model)
        assertTrue(model.state.value.serviceConfigured); assertFalse(model.state.value.keyRemembered)
        assertTrue(client.checks.isEmpty()); assertTrue(client.translations.isEmpty())
        model.edit("English 😀"); model.translate(); assertEquals("English 😀", model.state.value.translation)
        model.edit("😀".repeat(1001)); model.translate(); assertTrue(model.state.value.tooLong)
        assertTrue(client.translations.isEmpty())
        model.edit("你好 Ж"); model.translate(); assertTrue(client.translations.isEmpty())
        assertFalse(model.state.value.toString().contains("synthetic-key"))
    }
    @Test fun checkTranslationMutualExclusionCancellationAndLateResults() = runBlocking {
        val client = Client(); val model = model(client); configured(model); model.edit("中文")
        model.checkConnection(); model.checkConnection(); model.translate()
        assertEquals(1, client.checks.size); assertTrue(client.translations.isEmpty())
        model.edit("新文"); client.checks[0].resume(Unit); assertNull(model.state.value.connectionMessage)
        model.translate(); model.translate(); model.checkConnection()
        assertEquals(1, client.translations.size); assertEquals(1, client.checks.size)
        model.cancelTranslation(); client.translations[0].resume("Late")
        assertFalse(model.state.value.translating); assertNull(model.state.value.translation)
        model.translate(); configured(model); client.translations[1].resume("Old key")
        assertNull(model.state.value.translation); assertFalse(model.state.value.translating)
        model.translate(); model.deleteDeepSeekKey()
        repeat(200) { if (model.state.value.keyBusy) delay(5) }
        client.translations[2].resume("Deleted key")
        assertFalse(model.state.value.serviceConfigured); assertFalse(model.state.value.deepSeekConfigured)
        assertNull(model.state.value.translation)
    }
}
