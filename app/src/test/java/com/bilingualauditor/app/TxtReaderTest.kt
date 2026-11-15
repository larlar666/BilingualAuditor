package com.bilingualauditor.app

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TxtReaderTest {
    private fun read(bytes: ByteArray) = TxtReader.read(ByteArrayInputStream(bytes))

    @Test fun preservesChineseParagraphsAndWhitespace() {
        val text = "你好，世界！\r\n\r\n第二段：English 123\t结尾。\n"
        assertEquals(text, read(text.toByteArray(Charsets.UTF_8)))
    }

    @Test fun removesOnlyLeadingUtf8Bom() {
        assertEquals("中文\uFEFF", read("\uFEFF中文\uFEFF".toByteArray(Charsets.UTF_8)))
    }

    @Test fun rejectsGbkInsteadOfProducingGarbledText() {
        assertThrows(TxtImportException::class.java) {
            read(byteArrayOf(0xD6.toByte(), 0xD0.toByte(), 0xCE.toByte(), 0xC4.toByte()))
        }
    }

    @Test fun rejectsEmptyOrWhitespaceOnlyFiles() {
        for (text in listOf("", " \r\n\t", "\uFEFF")) {
            assertThrows(TxtImportException::class.java) { read(text.toByteArray()) }
        }
    }

    @Test fun rejectsBinaryAndUtf16WithoutBom() {
        assertThrows(TxtImportException::class.java) { read(byteArrayOf(65, 0, 66, 0)) }
    }

    @Test fun rejectsByteLimitEvenWhenCharacterCountWouldFit() {
        assertThrows(TxtImportException::class.java) {
            read("中".repeat(90_000).toByteArray(Charsets.UTF_8))
        }
    }

    @Test fun acceptsCharacterLimitAndRejectsOneMore() {
        assertEquals(TxtReader.MAX_CHARACTERS, read("a".repeat(100_000).toByteArray()).length)
        assertThrows(TxtImportException::class.java) { read("a".repeat(100_001).toByteArray()) }
    }
}
