package com.bilingualauditor.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Separate from proxy access tokens; never included in ReaderState or saved UI state. */
class DeepSeekApiKey private constructor(internal val value: String) {
    override fun toString() = "DeepSeekApiKey(redacted)"
    companion object {
        fun parse(input: String): DeepSeekApiKey {
            if (input.any { it.isISOControl() }) throw TranslationFailure("INVALID_KEY")
            val key = input.trim()
            if (key.isEmpty() || key.length > 512 || key.any { it.isISOControl() || it.isWhitespace() } || !StrictJson.wellFormed(key)) throw TranslationFailure("INVALID_KEY")
            return DeepSeekApiKey(key)
        }
    }
}

internal interface CredentialDisk {
    fun read(): ByteArray?
    fun write(bytes: ByteArray)
    fun deleteRecord()
}
internal interface CredentialCipher {
    fun encrypt(key: String): ByteArray
    fun decrypt(record: ByteArray): String
    fun deleteAlias()
}
internal data class CredentialStatus(val configured: Boolean, val remembered: Boolean, val cleanupPending: Boolean = false, val activeMode: TranslationMode? = null)

/** All transitions serialize. Publish only after the corresponding disk operation succeeds. */
internal class DeepSeekKeyRepository(private val disk: CredentialDisk, private val cipher: CredentialCipher) {
    private val mutex = Mutex()
    private var key: DeepSeekApiKey? = null
    private var remembered = false
    private var cleanupPending = false
    private var activeMode: TranslationMode? = null
    private var encrypted: ByteArray? = null
    suspend fun load(): CredentialStatus = withContext(Dispatchers.IO) { mutex.withLock {
        try {
            val record = disk.read()
            if (record != null && record.size >= 6 && record[0] == 66.toByte() && record[1] == 65.toByte()) {
                val buffer = ByteBuffer.wrap(record)
                require(buffer.get() == 66.toByte() && buffer.get() == 65.toByte() && buffer.get() == 2.toByte())
                activeMode = when (buffer.get().toInt()) { 0 -> null; 1 -> TranslationMode.DEEPSEEK_DIRECT; 2 -> TranslationMode.GENERIC_HTTPS; 3 -> TranslationMode.TEMP_PC_DEEPSEEK; else -> error("Invalid mode") }
                val size = buffer.short.toInt(); require(size >= 0 && size == buffer.remaining())
                encrypted = if (size == 0) null else ByteArray(size).also { buffer.get(it) }
            } else { activeMode = null; encrypted = record }
            key = encrypted?.let { DeepSeekApiKey.parse(cipher.decrypt(it)) }; remembered = encrypted != null
            status()
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) { key = null; remembered = false; throw TranslationFailure("KEY_LOAD_FAILED") }
    } }
    suspend fun apply(input: String?, remember: Boolean): CredentialStatus = withContext(Dispatchers.IO + NonCancellable) { mutex.withLock {
        val candidate = input?.let(DeepSeekApiKey::parse) ?: key ?: throw TranslationFailure("INVALID_KEY")
        try {
            val next = if (remember) cipher.encrypt(candidate.value) else null
            disk.write(encode(TranslationMode.DEEPSEEK_DIRECT, next))
            encrypted = next
        } catch (_: Exception) { throw TranslationFailure("KEY_SAVE_FAILED") }
        activeMode = TranslationMode.DEEPSEEK_DIRECT
        key = candidate; remembered = remember; cleanupPending = false
        // Alias cleanup is required on explicit delete; leaving an unused alias here cannot restore a deleted record.
        status()
    } }
    suspend fun selectMode(mode: TranslationMode) = withContext(Dispatchers.IO + NonCancellable) { mutex.withLock {
        require(mode != TranslationMode.DEEPSEEK_DIRECT)
        try { disk.write(encode(mode, encrypted)) } catch (_: Exception) { throw TranslationFailure("KEY_SAVE_FAILED") }
        activeMode = mode
    } }
    private fun encode(mode: TranslationMode?, cipherText: ByteArray?): ByteArray {
        val bytes = cipherText ?: byteArrayOf()
        val modeCode = when (mode) { null -> 0; TranslationMode.DEEPSEEK_DIRECT -> 1; TranslationMode.GENERIC_HTTPS -> 2; TranslationMode.TEMP_PC_DEEPSEEK -> 3 }
        return ByteBuffer.allocate(6 + bytes.size).put(66).put(65).put(2).put(modeCode.toByte()).putShort(bytes.size.toShort()).put(bytes).array()
    }
    suspend fun snapshot(): DeepSeekApiKey? = mutex.withLock { key }
    suspend fun delete(): CredentialStatus = withContext(Dispatchers.IO + NonCancellable) { mutex.withLock {
        try { disk.write(encode(activeMode, null)) } catch (_: Exception) { throw TranslationFailure("KEY_DELETE_FAILED") }
        encrypted = null; key = null; remembered = false; cleanupPending = true
        try { cipher.deleteAlias(); cleanupPending = false } catch (_: Exception) { throw TranslationFailure("KEY_CLEANUP_PENDING") }
        status()
    } }
    private fun status() = CredentialStatus(key != null, remembered, cleanupPending, activeMode)
    companion object {
        fun android(context: Context): DeepSeekKeyRepository {
            val file = File(context.noBackupFilesDir, "deepseek-key-v1")
            val pending = File(context.noBackupFilesDir, "deepseek-key-v1.new")
            val disk = object : CredentialDisk {
                override fun read(): ByteArray? = if (file.exists()) file.inputStream().use { stream ->
                    require(file.length() <= 4096)
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(1024)
                    while (true) { val n = stream.read(buffer); if (n < 0) break; require(output.size() + n <= 4096); output.write(buffer, 0, n) }
                    output.toByteArray()
                } else null
                override fun write(bytes: ByteArray) {
                    FileOutputStream(pending).use { out -> out.write(bytes); out.fd.sync() }
                    // Same filesystem, fail closed if atomic replacement is unsupported.
                    Files.move(pending.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                }
                override fun deleteRecord() {
                    if (pending.exists()) check(pending.delete())
                    if (file.exists()) check(file.delete())
                    check(!file.exists() && !pending.exists())
                }
            }
            return DeepSeekKeyRepository(disk, AndroidCredentialCipher())
        }
    }
}

private class AndroidCredentialCipher : CredentialCipher {
    private val alias = "bilingual-auditor-deepseek-key-v1"
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun secret(create: Boolean): SecretKey {
        (store().getKey(alias, null) as? SecretKey)?.let { return it }
        check(create)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    override fun encrypt(key: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret(true)) }
        val encrypted = cipher.doFinal(key.toByteArray(Charsets.UTF_8))
        return ByteBuffer.allocate(2 + cipher.iv.size + encrypted.size).put(1).put(cipher.iv.size.toByte()).put(cipher.iv).put(encrypted).array()
    }
    override fun decrypt(record: ByteArray): String {
        require(record.size in 30..4096 && record[0] == 1.toByte() && record[1] == 12.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(false), GCMParameterSpec(128, record.copyOfRange(2, 14))) }
        val bytes = cipher.doFinal(record.copyOfRange(14, record.size))
        return Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()
    }
    override fun deleteAlias() { store().deleteEntry(alias) }
}
