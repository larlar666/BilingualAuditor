package com.bilingualauditor.app

import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderViewModelTest {
    private class PendingClient : TranslationClient {
        val calls = mutableListOf<Continuation<String>>()
        val texts = mutableListOf<String>()
        override suspend fun translate(text: String, requestId: String, settings: TranslationSettings): String =
            suspendCoroutine { continuation -> texts += text; calls += continuation }
    }

    private fun configured(client: TranslationClient): ReaderViewModel =
        ReaderViewModel(client, Dispatchers.Unconfined).also {
            assertTrue(it.configureTranslation("https://example.workers.dev/translate", "test_access_token_12345678901234567890"))
        }

    @Test fun blankEnglishAndOverlongDoNotSendRequests() {
        val client = PendingClient()
        val model = configured(client)
        model.edit(" \n")
        model.translate()
        assertNull(model.state.value.translation)
        val english = "Hello  API!\nKeep MiXeD casing and typo wrod."
        model.edit(english)
        model.translate()
        assertEquals(english, model.state.value.translation)
        assertTrue(model.state.value.unchangedEnglish)
        model.edit("中".repeat(10_001))
        model.translate()
        assertTrue(model.state.value.tooLong)
        assertEquals(10_001, model.state.value.source.length)
        assertTrue(client.calls.isEmpty())
    }

    @Test fun successfulRequestShowsTranslationAndDuplicateClickIsIgnored() {
        val client = PendingClient()
        val model = configured(client)
        model.edit("今天学习 Android Studio。")
        model.translate()
        model.translate()
        assertEquals(1, client.calls.size)
        assertTrue(model.state.value.translating)
        client.calls[0].resume("Today I study Android Studio.")
        assertEquals("Today I study Android Studio.", model.state.value.translation)
        assertEquals("今天学习 Android Studio。", model.state.value.source)
        assertFalse(model.state.value.translating)
        model.edit("明天学习 Android Studio。")
        assertTrue(model.state.value.translationOutdated)
    }

    @Test fun oldResponseCannotOverwriteAnEditedSourceOrItsNewRequest() {
        val client = PendingClient()
        val model = configured(client)
        model.edit("旧文段")
        model.translate()
        model.edit("新文段")
        model.translate()
        client.calls[0].resume("Old result")
        assertNull(model.state.value.translation)
        assertTrue(model.state.value.translating)
        client.calls[1].resume("New result")
        assertEquals("New result", model.state.value.translation)
        assertEquals("新文段", model.state.value.source)
    }

    @Test fun oldResponseCannotOverwriteAnImportedFile() {
        val client = PendingClient()
        val model = configured(client)
        model.edit("旧内容")
        model.translate()
        model.acceptImportedText("new.txt", "新文件")
        client.calls[0].resume("Old file result")
        assertEquals("新文件", model.state.value.source)
        assertEquals("new.txt", model.state.value.fileName)
        assertNull(model.state.value.translation)
        assertTrue(model.state.value.serviceConfigured)
    }

    @Test fun clearingOrReplacingConfigurationInvalidatesPendingResponse() {
        val client = PendingClient()
        val model = configured(client)
        model.edit("原文")
        model.translate()
        model.clearTranslationSettings()
        client.calls[0].resume("Result from revoked configuration")
        assertNull(model.state.value.translation)
        assertFalse(model.state.value.serviceConfigured)
        assertTrue(model.configureTranslation("https://other.workers.dev/translate", "new_access_token_12345678901234567890"))
        model.translate()
        assertTrue(model.configureTranslation("https://third.workers.dev/translate", "third_access_token_12345678901234567890"))
        client.calls[1].resume("Result from replaced configuration")
        assertNull(model.state.value.translation)
        assertFalse(model.state.value.translating)
    }

    @Test fun overlimitDialogWaitsForEditingEndAndIsNotRepeatedWithinEpisode() {
        val model = configured(PendingClient())
        model.edit("中".repeat(10_001))
        assertFalse(model.state.value.showLengthDialog)
        model.onEditingFinished()
        assertTrue(model.state.value.showLengthDialog)
        model.dismissLengthDialog()
        model.edit("中".repeat(10_002))
        model.onEditingFinished()
        assertFalse(model.state.value.showLengthDialog)
        model.edit("合法文段")
        model.edit("中".repeat(10_001))
        model.onEditingFinished()
        assertTrue(model.state.value.showLengthDialog)
    }

    @Test fun importedOverlimitTextTriggersOneDialogAndPreservesAllText() {
        val model = configured(PendingClient())
        val source = "中".repeat(10_001)
        model.acceptImportedText("long.txt", source)
        assertTrue(model.state.value.showLengthDialog)
        assertEquals(source, model.state.value.source)
        model.dismissLengthDialog()
        model.onEditingFinished()
        assertFalse(model.state.value.showLengthDialog)
    }

    @Test fun failureRetainsSourceAndOldTranslationWithoutInventingSuccess() {
        val client = PendingClient()
        val model = configured(client)
        model.edit("第一篇")
        model.translate()
        client.calls[0].resume("First translation")
        model.edit("第二篇")
        model.translate()
        client.calls[1].resumeWithException(TranslationFailure("QUOTA_EXCEEDED"))
        assertEquals("第二篇", model.state.value.source)
        assertEquals("First translation", model.state.value.translation)
        assertTrue(model.state.value.translationOutdated)
        assertFalse(model.state.value.translating)
        assertTrue(model.state.value.message!!.contains("额度"))
    }

    @Test fun invalidConfigurationDoesNotLeakItsValuesOrReplaceValidConfig() {
        val model = configured(PendingClient())
        assertFalse(model.configureTranslation("http://unsafe.example/translate", "secret\nheader"))
        assertTrue(model.state.value.serviceConfigured)
        assertEquals("example.workers.dev", model.state.value.serviceHost)
        assertFalse(model.state.value.message!!.contains("secret"))
        assertFalse(TranslationSettings("endpoint", "secret").toString().contains("secret"))
    }
}
