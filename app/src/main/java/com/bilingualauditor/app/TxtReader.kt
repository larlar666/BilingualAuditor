package com.bilingualauditor.app

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

class TxtImportException(message: String) : Exception(message)

/** Bounded, strict decoding: an import must never silently turn invalid bytes into replacement text. */
object TxtReader {
    const val MAX_BYTES = 256 * 1024
    const val MAX_CHARACTERS = 100_000

    fun read(input: InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count == -1) break
            if (output.size() + count > MAX_BYTES) {
                throw TxtImportException("文件超过 256 KiB，请先拆分为较小的 TXT。")
            }
            output.write(buffer, 0, count)
        }
        val bytes = output.toByteArray()
        val offset = if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() &&
            bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()
        ) 3 else 0
        val text = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, offset, bytes.size - offset))
                .toString()
        } catch (_: CharacterCodingException) {
            throw TxtImportException("暂不支持此文件的编码，请另存为 UTF-8 TXT 后重试。")
        }
        if (text.any { it.isISOControl() && it != '\n' && it != '\r' && it != '\t' }) {
            throw TxtImportException("文件含有非文本字符，请确认是 UTF-8 TXT。")
        }
        if (text.isBlank()) throw TxtImportException("这个 TXT 没有可阅读的文字。")
        if (text.length > MAX_CHARACTERS) {
            throw TxtImportException("文字超过 100,000 字符，请先拆分文件。")
        }
        return text
    }
}
