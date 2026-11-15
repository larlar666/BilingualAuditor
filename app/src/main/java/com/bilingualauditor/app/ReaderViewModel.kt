package com.bilingualauditor.app

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.IOException
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ReaderState(
    val source: String = "",
    val fileName: String? = null,
    val importing: Boolean = false,
    val message: String? = null,
    val translation: String? = null,
    val translatedSource: String? = null,
    val translating: Boolean = false,
    val unchangedEnglish: Boolean = false,
    val showLengthDialog: Boolean = false,
    val serviceConfigured: Boolean = false,
    val serviceHost: String? = null,
    val serviceMode: TranslationMode = TranslationMode.GENERIC_HTTPS,
    val checkingConnection: Boolean = false,
    val connectionMessage: String? = null,
) {
    val characterCount: Int get() = TranslationPolicy.count(source)
    val activeLimit: Int get() = if (serviceMode == TranslationMode.TEMP_PC_DEEPSEEK) 1000 else TranslationPolicy.MAX_CODE_POINTS
    val tooLong: Boolean get() = characterCount > activeLimit
    val translationOutdated: Boolean get() = translation != null && translatedSource != source
}

class ReaderViewModel(
    private val translationClient: TranslationClient = HttpsTranslationClient(),
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    private val healthClient: ProxyHealthClient = HttpsTranslationClient(),
) : ViewModel() {
    private val mutableState = MutableStateFlow(ReaderState())
    val state = mutableState.asStateFlow()
    private var settings: TranslationSettings? = null
    private var translationJob: Job? = null
    private var healthJob: Job? = null
    private var generation = 0L
    private var overLimitNotified = false

    fun edit(text: String) {
        if (mutableState.value.importing || text == mutableState.value.source) return
        if (text.length > TxtReader.MAX_CHARACTERS) {
            mutableState.update { it.copy(message = "最多输入 100,000 字符，原文未被替换。") }
            return
        }
        invalidateRequest()
        mutableState.update { it.copy(source = text, message = null, translating = false) }
        resetLengthWarningWhenValid()
    }

    fun onEditingFinished() = notifyLengthLimit()

    fun dismissLengthDialog() {
        mutableState.update { it.copy(showLengthDialog = false) }
    }

    fun configureTranslation(endpoint: String, accessToken: String, mode: TranslationMode = TranslationMode.GENERIC_HTTPS, certificatePin: String = ""): Boolean {
        val normalizedEndpoint = endpoint.trim()
        val normalizedToken = accessToken.trim()
        val candidate = TranslationSettings(normalizedEndpoint, normalizedToken, mode, certificatePin)
        if (!candidate.valid) {
            mutableState.update { it.copy(message = translationErrorMessage("INVALID_CONFIG")) }
            return false
        }
        invalidateRequest()
        settings = candidate
        overLimitNotified = false
        mutableState.update {
            it.copy(serviceConfigured = true, serviceHost = URI(normalizedEndpoint).host, serviceMode = mode,
                translating = false, message = "试用配置已应用，仅在本次应用运行期间保留。")
        }
        resetLengthWarningWhenValid()
        notifyLengthLimit()
        return true
    }

    fun clearTranslationSettings() {
        invalidateRequest()
        settings = null
        mutableState.update {
            it.copy(serviceConfigured = false, serviceHost = null, serviceMode = TranslationMode.GENERIC_HTTPS, translating = false, showLengthDialog = false,
                message = "试用配置已清除。")
        }
        overLimitNotified = false
        resetLengthWarningWhenValid()
    }

    fun checkConnection() {
        val config = settings ?: return
        if (config.mode != TranslationMode.TEMP_PC_DEEPSEEK || mutableState.value.checkingConnection || mutableState.value.translating) return
        val requestGeneration = ++generation
        mutableState.update { it.copy(checkingConnection = true, connectionMessage = null) }
        healthJob = viewModelScope.launch(mainDispatcher) {
            try {
                val health = healthClient.check(config)
                if (generation == requestGeneration) mutableState.update { it.copy(checkingConnection = false, connectionMessage = health.display) }
            } catch (error: CancellationException) { throw error
            } catch (error: Exception) {
                if (generation == requestGeneration) mutableState.update { it.copy(checkingConnection = false,
                    connectionMessage = translationErrorMessage((error as? TranslationFailure)?.code ?: "SERVICE_UNAVAILABLE")) }
            }
        }
    }

    fun cancelConnectionCheck() { invalidateRequest() }

    fun importTxt(resolver: ContentResolver, uri: Uri) {
        if (mutableState.value.importing) return
        invalidateRequest()
        mutableState.update { it.copy(importing = true, translating = false, message = null) }
        viewModelScope.launch(mainDispatcher) {
            try {
                val (name, text) = withContext(Dispatchers.IO) {
                    val name = resolver.query(
                        uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null,
                    )?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }
                    if (name != null && !name.endsWith(".txt", ignoreCase = true)) {
                        throw TxtImportException("请选择 .txt 文件。")
                    }
                    val text = resolver.openInputStream(uri)?.use(TxtReader::read)
                        ?: throw IOException("Cannot open selected document")
                    (name ?: "所选 TXT") to text
                }
                acceptImportedText(name, text)
            } catch (error: TxtImportException) {
                fail(error.message ?: "无法导入这个 TXT。")
            } catch (_: SecurityException) {
                fail("无法读取所选文件，请重新选择并允许读取。")
            } catch (_: IOException) {
                fail("文件读取失败，请确认文件仍可访问，然后重试。")
            } catch (_: IllegalArgumentException) {
                fail("文件提供方无法打开此文件，请换一个位置重试。")
            }
        }
    }

    /** Single success path after the importer has fully decoded and validated the file. */
    internal fun acceptImportedText(name: String, text: String) {
        invalidateRequest()
        overLimitNotified = false
        mutableState.update {
            it.copy(source = text, fileName = name, importing = false, translating = false,
                message = null, showLengthDialog = false)
        }
        notifyLengthLimit()
    }

    fun translate() {
        val snapshot = mutableState.value
        if (snapshot.importing || snapshot.translating || snapshot.checkingConnection) return
        if (snapshot.source.isBlank()) {
            mutableState.update { it.copy(message = "请先输入文字或选择 TXT。") }
            return
        }
        if (snapshot.tooLong) {
            notifyLengthLimit()
            mutableState.update { it.copy(message = "文段超出 ${snapshot.activeLimit} 码点范围，全文已保留。") }
            return
        }
        if (TranslationPolicy.canDisplayUnchanged(snapshot.source)) {
            mutableState.update {
                it.copy(translation = snapshot.source, translatedSource = snapshot.source,
                    unchangedEnglish = true, message = "英文内容原样显示，未发送翻译请求。")
            }
            return
        }
        if (!TranslationPolicy.containsChinese(snapshot.source)) {
            mutableState.update { it.copy(message = "当前支持中文或中英混合译成英文；英文可原样阅读。") }
            return
        }
        val requestSettings = settings
        if (requestSettings == null) {
            mutableState.update { it.copy(message = "请先配置试用翻译服务；原文已保留。") }
            return
        }
        val requestGeneration = ++generation
        val requestId = UUID.randomUUID().toString()
        mutableState.update { it.copy(translating = true, message = null) }
        translationJob = viewModelScope.launch(mainDispatcher) {
            try {
                val translation = translationClient.translate(snapshot.source, requestId, requestSettings)
                if (requestGeneration != generation) return@launch
                if (translation.isBlank()) throw TranslationFailure("INVALID_RESPONSE")
                mutableState.update {
                    it.copy(translation = translation, translatedSource = snapshot.source,
                        translating = false, unchangedEnglish = false, message = null)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: TranslationFailure) {
                if (requestGeneration == generation) {
                    mutableState.update { it.copy(translating = false, message = translationErrorMessage(error.code)) }
                }
            } catch (_: Exception) {
                if (requestGeneration == generation) {
                    mutableState.update {
                        it.copy(translating = false, message = translationErrorMessage("SERVICE_UNAVAILABLE"))
                    }
                }
            }
        }
    }

    private fun invalidateRequest() {
        generation++
        translationJob?.cancel()
        translationJob = null
        healthJob?.cancel()
        healthJob = null
        mutableState.update { it.copy(checkingConnection = false, connectionMessage = null) }
    }

    private fun notifyLengthLimit() {
        if (!mutableState.value.tooLong || overLimitNotified) return
        overLimitNotified = true
        mutableState.update { it.copy(showLengthDialog = true) }
    }

    private fun resetLengthWarningWhenValid() {
        if (!mutableState.value.tooLong) {
            overLimitNotified = false
            mutableState.update { it.copy(showLengthDialog = false) }
        }
    }

    private fun fail(message: String) {
        mutableState.update { it.copy(importing = false, message = message) }
    }
}
