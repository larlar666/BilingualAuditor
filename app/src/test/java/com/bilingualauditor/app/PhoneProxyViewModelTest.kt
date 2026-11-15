package com.bilingualauditor.app

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*
import org.junit.Test

class PhoneProxyViewModelTest {
    private val token = "a".repeat(32)
    private class Client : TranslationClient, ProxyHealthClient {
        var translateCalls = 0
        val pending = mutableListOf<Continuation<ProxyHealth>>()
        override suspend fun translate(text: String, requestId: String, settings: TranslationSettings): String { translateCalls++; return "Translated" }
        override suspend fun check(settings: TranslationSettings): ProxyHealth = suspendCoroutine { pending += it }
    }
    private fun configure(model: ReaderViewModel) = model.configureTranslation("https://10.1.2.3:8765/translate", token, TranslationMode.TEMP_PC_DEEPSEEK, "aa".repeat(32))
    @Test fun phoneBoundaryIncludesEmojiAndModeChangesPreserveFullSource() {
        val client = Client()
        val model = ReaderViewModel(client, Dispatchers.Unconfined, client)
        assertTrue(configure(model))
        for (size in listOf(999, 1000, 1001)) {
            val source = "中" + "😀".repeat(size - 2) + " "
            model.edit(source)
            model.onEditingFinished()
            assertEquals(size, model.state.value.characterCount)
            assertEquals(size > 1000, model.state.value.tooLong)
            model.translate()
            assertEquals(source, model.state.value.source)
        }
        assertEquals(2, client.translateCalls)
        assertTrue(model.state.value.showLengthDialog)
        model.dismissLengthDialog(); model.onEditingFinished()
        assertFalse(model.state.value.showLengthDialog)
        assertTrue(model.configureTranslation("https://example.com/translate", token))
        assertFalse(model.state.value.tooLong)
        assertTrue(configure(model)); assertTrue(model.state.value.tooLong)
        model.edit("English 😀"); model.translate()
        assertEquals(2, client.translateCalls)
        assertEquals("English 😀", model.state.value.translation)
    }
    @Test fun healthIsExplicitDeduplicatedAndStaleResultsCannotOverwriteCurrentState() {
        val client = Client()
        val model = ReaderViewModel(client, Dispatchers.Unconfined, client)
        configure(model)
        assertTrue(client.pending.isEmpty())
        model.checkConnection(); model.checkConnection()
        assertEquals(1, client.pending.size)
        model.edit("新文段")
        client.pending[0].resume(ProxyHealth(true, 0, 0, 20, 3_000_000))
        assertNull(model.state.value.connectionMessage)
        model.checkConnection(); model.cancelConnectionCheck()
        client.pending[1].resume(ProxyHealth(true, 0, 0, 20, 3_000_000))
        assertNull(model.state.value.connectionMessage)
        model.checkConnection(); model.clearTranslationSettings()
        client.pending[2].resume(ProxyHealth(true, 0, 0, 20, 3_000_000))
        assertNull(model.state.value.connectionMessage)
        configure(model); model.checkConnection()
        client.pending[3].resume(ProxyHealth(false, 1, 150_000, 19, 2_850_000))
        assertTrue(model.state.value.connectionMessage!!.contains("未调用模型"))
        assertTrue(model.state.value.connectionMessage!!.contains("未就绪"))
        assertEquals(0, client.translateCalls)
    }
}
