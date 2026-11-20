package com.bilingualauditor.app

import java.io.File
import java.util.UUID
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class ReadingDocumentTest {
    private fun document(source: String = "原文 😀\n  exact ") = ReadingDocument(UUID.randomUUID().toString(), source, "English", false, 1, 2, "name")
    private fun directory() = java.nio.file.Files.createTempDirectory("reading-doc-test").toFile()
    @Test fun roundTripUpdateSaveAsAndRestart() = runBlocking {
        val dir = directory()
        try {
            val repo = FileDocumentRepository(dir); val d = document(); repo.write(d)
            assertEquals(d, repo.read(d.id))
            repo.write(d.copy(source = "updated", translation = null, updatedAt = 3))
            assertEquals(1, repo.list().documents.size)
            val another = d.copy(id = UUID.randomUUID().toString()); repo.write(another)
            val restarted = FileDocumentRepository(dir)
            assertEquals(2, restarted.list().documents.size); assertEquals(another, restarted.read(another.id))
        } finally { dir.deleteRecursively() }
    }
    @Test fun damagedAndFutureRecordsRetainedAndAtomicFailurePreservesOld() = runBlocking {
        val dir = directory()
        try {
            val d = document(); FileDocumentRepository(dir).write(d)
            val bytes = File(dir, "${d.id}.json").readBytes()
            val failing = FileDocumentRepository(dir) { _, _ -> throw java.io.IOException("synthetic") }
            try { failing.write(d.copy(source = "new")); fail() } catch (_: java.io.IOException) {}
            assertArrayEquals(bytes, File(dir, "${d.id}.json").readBytes())
            val future = File(dir, "${UUID.randomUUID()}.json"); future.writeText(String(bytes).replace("\"schemaVersion\":1", "\"schemaVersion\":99"))
            val bad = File(dir, "bad.json"); bad.writeText("{")
            val result = FileDocumentRepository(dir).list()
            assertEquals(1, result.documents.size); assertEquals(2, result.damagedCount)
            assertTrue(future.exists()); assertTrue(bad.exists()); assertFalse(dir.listFiles()!!.any { it.name.endsWith(".tmp") })
            try { failing.read("../outside"); fail() } catch (_: IllegalArgumentException) {}
        } finally { dir.deleteRecursively() }
    }
    @Test fun concurrentWritesSerializeAndLengthCountsCodePoints() = runBlocking {
        val dir = directory()
        try {
            val repo = FileDocumentRepository(dir); val d = document("😀".repeat(10000)).copy(translation = null)
            coroutineScope { repeat(12) { index -> launch { repo.write(d.copy(updatedAt = index + 2L)) } } }
            assertEquals(1, repo.list().documents.size); assertEquals(d.source, repo.read(d.id).source)
            try { repo.write(d.copy(source = "😀".repeat(10001))); fail() } catch (_: IllegalArgumentException) {}
            assertEquals(d.source, repo.read(d.id).source)
        } finally { dir.deleteRecursively() }
    }
    private class Fake : DocumentRepository {
        val records = linkedMapOf<String, ReadingDocument>()
        var failWrite = false; var failRead = false
        override suspend fun list() = DocumentListing(records.values.toList())
        override suspend fun read(id: String): ReadingDocument { if (failRead) error("synthetic"); return records.getValue(id) }
        override suspend fun write(document: ReadingDocument) { if (failWrite) error("synthetic"); records[document.id] = document }
    }
    @Test fun viewModelIdentityFailureBaselineAndOriginalOnlyConfirmation() {
        val repo = Fake(); val vm = ReaderViewModel(mainDispatcher = Dispatchers.Unconfined, documentRepository = repo)
        vm.edit("English"); vm.translate(); assertTrue(vm.state.value.dirty)
        vm.saveDocument(true); val first = vm.state.value.documentId!!
        assertFalse(vm.state.value.dirty); assertEquals("双语", vm.state.value.savedType)
        vm.edit("changed"); repo.failWrite = true; vm.saveDocument(false)
        assertTrue(vm.state.value.confirmRemoveSavedTranslation); vm.confirmOriginalOnlySave()
        assertTrue(vm.state.value.dirty); assertEquals("English", repo.records[first]!!.source)
        repo.failWrite = false; vm.saveDocument(false); vm.confirmOriginalOnlySave()
        assertEquals(first, vm.state.value.documentId); assertEquals(1, repo.records.size); assertNull(repo.records[first]!!.translation)
        vm.edit("English"); vm.translate(); vm.saveDocument(true, saveAs = true)
        assertNotEquals(first, vm.state.value.documentId); assertEquals(2, repo.records.size)
        vm.edit("temporary"); val before = vm.state.value.source
        repo.failRead = true; vm.openDocument(first); assertTrue(vm.state.value.leavePrompt); vm.discardAndLeave()
        assertEquals(before, vm.state.value.source)
    }
    @Test fun limitsImportIdentitySearchAndCancelLeave() {
        val repo = Fake(); val vm = ReaderViewModel(mainDispatcher = Dispatchers.Unconfined, documentRepository = repo)
        vm.edit("😀".repeat(10000)); assertTrue(vm.state.value.tooLong); assertTrue(vm.state.value.canSave)
        vm.saveDocument(false); assertNotNull(vm.state.value.documentId)
        vm.edit("😀".repeat(10001)); assertFalse(vm.state.value.canSave)
        var left = false; vm.requestLeave { left = true }; vm.continueEditing(); assertFalse(left)
        vm.requestLeave { /* picker cancelled: no replacement */ }; vm.discardAndLeave()
        assertEquals(10001, vm.state.value.characterCount)
        vm.acceptImportedText("synthetic.txt", "English"); assertNull(vm.state.value.documentId); assertNull(vm.state.value.translation)
        vm.translate(); vm.saveDocument(true); vm.refreshDocuments(); vm.searchDocuments("ENGLISH")
        assertEquals(1, vm.state.value.filteredDocuments.size)
        val baseline = vm.state.value.source; vm.edit("x"); vm.edit(baseline); assertFalse(vm.state.value.dirty)
    }
    @Test fun saveThenOpenKeepsBusyUntilDelayedReadAndRejectsEdits() = runBlocking {
        val target = document("target")
        val readStarted = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val repo = object : DocumentRepository {
            override suspend fun list() = DocumentListing(listOf(target))
            override suspend fun write(document: ReadingDocument) {}
            override suspend fun read(id: String): ReadingDocument { readStarted.complete(Unit); release.await(); return target }
        }
        val vm = ReaderViewModel(mainDispatcher = Dispatchers.Unconfined, documentRepository = repo)
        vm.edit("unsaved"); vm.openDocument(target.id); vm.saveDocument(false)
        readStarted.await(); assertTrue(vm.state.value.documentBusy)
        vm.edit("must not replace"); assertEquals("unsaved", vm.state.value.source)
        vm.newDocument(); assertEquals("unsaved", vm.state.value.source)
        release.complete(Unit); yield()
        assertEquals("target", vm.state.value.source); assertFalse(vm.state.value.documentBusy)
    }

}
