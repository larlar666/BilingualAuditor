package com.bilingualauditor.app

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

class DeepSeekKeyRepositoryTest {
    private class Disk : CredentialDisk {
        var bytes: ByteArray? = null; var failWrite = false; var failDelete = false
        override fun read() = bytes
        override fun write(bytes: ByteArray) { check(!failWrite); this.bytes = bytes }
        override fun deleteRecord() { check(!failDelete); bytes = null }
    }
    private class Crypto : CredentialCipher {
        private var key = KeyGenerator.getInstance("AES").apply { init(128) }.generateKey()
        var failDelete = false
        override fun encrypt(key: String): ByteArray { val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, this@Crypto.key) }; return c.iv + c.doFinal(key.toByteArray()) }
        override fun decrypt(record: ByteArray): String { val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, record.copyOfRange(0, 12))) }; return String(c.doFinal(record.copyOfRange(12, record.size))) }
        override fun deleteAlias() { check(!failDelete); key = KeyGenerator.getInstance("AES").apply { init(128) }.generateKey() }
    }
    @Test fun saveReplaceAndCloseRememberAreTransactional() = runBlocking {
        val disk = Disk(); val crypto = Crypto(); val repo = DeepSeekKeyRepository(disk, crypto)
        assertFalse(repo.load().configured)
        repo.apply("synthetic-key-one", true); val first = disk.bytes!!.clone()
        repo.apply("synthetic-key-one", true); assertFalse(first.contentEquals(disk.bytes))
        assertEquals("synthetic-key-one", DeepSeekKeyRepository(disk, crypto).also { it.load() }.snapshot()!!.value)
        disk.failWrite = true
        assertTrue(runCatching { repo.apply("synthetic-key-two", true) }.exceptionOrNull() is TranslationFailure)
        assertEquals("synthetic-key-one", repo.snapshot()!!.value)
        disk.failWrite = true
        assertTrue(runCatching { repo.apply("synthetic-key-two", false) }.isFailure)
        assertEquals("synthetic-key-one", repo.snapshot()!!.value)
        disk.failWrite = false; repo.apply("synthetic-key-two", false)
        assertFalse(DeepSeekKeyRepository(disk, crypto).load().configured); assertEquals("synthetic-key-two", repo.snapshot()!!.value)
    }
    @Test fun deletionReportsIntermediateAliasFailureAndAllowsRetry() = runBlocking {
        val disk = Disk(); val crypto = Crypto(); val repo = DeepSeekKeyRepository(disk, crypto)
        repo.apply("synthetic-key", true); disk.failWrite = true
        assertEquals("KEY_DELETE_FAILED", (runCatching { repo.delete() }.exceptionOrNull() as TranslationFailure).code)
        assertNotNull(repo.snapshot()); assertNotNull(disk.bytes)
        disk.failWrite = false; crypto.failDelete = true
        assertEquals("KEY_CLEANUP_PENDING", (runCatching { repo.delete() }.exceptionOrNull() as TranslationFailure).code)
        assertNull(repo.snapshot()); assertFalse(DeepSeekKeyRepository(disk, crypto).load().configured)
        crypto.failDelete = false; assertFalse(repo.delete().cleanupPending)
    }
    @Test fun corruptAndInvalidatedRecordsNeverBecomeKeys() = runBlocking {
        val disk = Disk(); val crypto = Crypto(); val repo = DeepSeekKeyRepository(disk, crypto)
        repo.apply("synthetic-key", true); disk.bytes!![13] = (disk.bytes!![13].toInt() xor 1).toByte()
        assertEquals("KEY_LOAD_FAILED", (runCatching { repo.load() }.exceptionOrNull() as TranslationFailure).code)
        assertNull(repo.snapshot()); assertNotNull(disk.bytes)
        repo.apply("synthetic-key", true); crypto.deleteAlias()
        assertTrue(runCatching { repo.load() }.isFailure); assertNull(repo.snapshot())
        for (input in listOf("", "x\ny", "\nsecret", "a b", "x".repeat(513))) assertTrue(runCatching { DeepSeekApiKey.parse(input) }.isFailure)
        assertFalse(DeepSeekApiKey.parse("synthetic-key").toString().contains("synthetic-key"))
    }
}
