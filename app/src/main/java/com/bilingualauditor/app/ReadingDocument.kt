package com.bilingualauditor.app

import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class ReadingDocument(
    val id: String, val source: String, val translation: String?, val unchangedEnglish: Boolean,
    val createdAt: Long, val updatedAt: Long, val displayName: String,
) {
    val saveType: String get() = if (translation == null) "仅原文" else "双语"
}
data class DocumentListing(val documents: List<ReadingDocument>, val damagedCount: Int = 0)
interface DocumentRepository {
    suspend fun list(): DocumentListing
    suspend fun read(id: String): ReadingDocument
    suspend fun write(document: ReadingDocument)
}
internal object DocumentCodec {
    const val MAX_BYTES = 512 * 1024
    fun validId(id: String): Boolean = runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false)
    fun validate(d: ReadingDocument) {
        require(validId(d.id) && d.source.isNotBlank() && TranslationPolicy.count(d.source) <= 10000)
        require(StrictJson.wellFormed(d.source) && d.displayName.isNotBlank() && d.displayName.length <= 160 && StrictJson.wellFormed(d.displayName))
        require(d.createdAt >= 0 && d.updatedAt >= d.createdAt)
        require(d.translation == null || d.translation.isNotBlank() && d.translation.length <= 32768 && StrictJson.wellFormed(d.translation))
        require(!d.unchangedEnglish || d.translation == d.source)
    }
    fun encode(d: ReadingDocument): ByteArray {
        validate(d)
        return ("{\"schemaVersion\":1,\"id\":" + StrictJson.quote(d.id) + ",\"source\":" + StrictJson.quote(d.source) +
            ",\"translation\":" + (d.translation?.let(StrictJson::quote) ?: "null") + ",\"unchangedEnglish\":" + d.unchangedEnglish +
            ",\"createdAt\":" + d.createdAt + ",\"updatedAt\":" + d.updatedAt + ",\"displayName\":" + StrictJson.quote(d.displayName) + "}")
            .toByteArray(Charsets.UTF_8).also { require(it.size <= MAX_BYTES) }
    }
    fun decode(bytes: ByteArray): ReadingDocument {
        require(bytes.size <= MAX_BYTES)
        val map = StrictJson.parse(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()) as? Map<*, *> ?: error("record")
        fun number(key: String) = (map[key] as java.math.BigDecimal).longValueExact()
        require(number("schemaVersion") == 1L)
        require(map.containsKey("translation"))
        return ReadingDocument(map["id"] as String, map["source"] as String, map["translation"] as String?, map["unchangedEnglish"] as Boolean,
            number("createdAt"), number("updatedAt"), map["displayName"] as String).also(::validate)
    }
}
/** No index, no automatic repair. Only validated UUIDs can become file paths. */
internal class FileDocumentRepository(
    private val directory: File,
    private val replace: (File, File) -> Unit = { temporary, target ->
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); Unit
    },
) : DocumentRepository {
    private val mutex = Mutex()
    private fun path(id: String): File { require(DocumentCodec.validId(id)); return File(directory, "$id.json") }
    private fun readFile(file: File): ReadingDocument {
        require(file.length() <= DocumentCodec.MAX_BYTES)
        val bytes = file.inputStream().use { stream ->
            val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
            while (true) { val n = stream.read(buffer); if (n < 0) break; require(out.size() + n <= DocumentCodec.MAX_BYTES); out.write(buffer, 0, n) }
            out.toByteArray()
        }
        return DocumentCodec.decode(bytes).also { require(file.name == "${it.id}.json") }
    }
    override suspend fun list(): DocumentListing = withContext(Dispatchers.IO) { mutex.withLock {
        if (!directory.exists()) return@withLock DocumentListing(emptyList())
        val files = directory.listFiles() ?: error("list")
        var damaged = 0
        val documents = files.filter { !it.name.endsWith(".tmp") }.mapNotNull { file ->
            try { readFile(file) } catch (_: Exception) { damaged++; null }
        }.sortedWith(compareByDescending<ReadingDocument> { it.updatedAt }.thenBy { it.id })
        DocumentListing(documents, damaged)
    } }
    override suspend fun read(id: String): ReadingDocument = withContext(Dispatchers.IO) { mutex.withLock { readFile(path(id)) } }
    override suspend fun write(document: ReadingDocument) = withContext(Dispatchers.IO) { mutex.withLock {
        val bytes = DocumentCodec.encode(document)
        check(directory.isDirectory || directory.mkdirs())
        val target = path(document.id)
        val temporary = File.createTempFile("pending-", ".tmp", directory)
        try {
            FileOutputStream(temporary).use { it.write(bytes); it.flush(); it.fd.sync() }
            replace(temporary, target)
        } finally { temporary.delete() }
    } }
}
