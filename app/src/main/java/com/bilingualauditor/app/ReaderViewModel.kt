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

enum class ReaderPage { READING, DOCUMENTS, WORDS, PREFERENCES }
data class ReaderContent(val source: String, val translation: String?, val unchangedEnglish: Boolean)
data class ReaderState(
    val source: String = "",
    val documentId: String? = null,
    val savedContent: ReaderContent? = null,
    val savedType: String? = null,
    val documentBusy: Boolean = false,
    val documentsLoading: Boolean = false,
    val documents: List<ReadingDocument> = emptyList(),
    val documentListError: Boolean = false,
    val damagedDocuments: Int = 0,
    val query: String = "",
    val page: ReaderPage = ReaderPage.READING,
    val leavePrompt: Boolean = false,
    val confirmRemoveSavedTranslation: Boolean = false,
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
    val serviceMode: TranslationMode = TranslationMode.DEEPSEEK_DIRECT,
    val keyLoading: Boolean = false,
    val keyBusy: Boolean = false,
    val keyRemembered: Boolean = false,
    val deepSeekConfigured: Boolean = false,
    val keyCleanupPending: Boolean = false,
    val checkingConnection: Boolean = false,
    val connectionMessage: String? = null,
) {
    val content: ReaderContent get() = ReaderContent(source, translation?.takeIf { translatedSource == source }, unchangedEnglish && translatedSource == source && translation != null)
    val dirty: Boolean get() = if (savedContent != null) content != savedContent else source.isNotEmpty() || translation != null
    val canSave: Boolean get() = source.isNotBlank() && characterCount <= 10000 && !documentBusy && !importing && !translating
    val validTranslation: Boolean get() = translation != null && translatedSource == source
    val filteredDocuments: List<ReadingDocument> get() = documents.filter { query.isEmpty() || it.displayName.contains(query, true) || it.source.contains(query, true) || it.translation?.contains(query, true) == true }
    val characterCount: Int get() = TranslationPolicy.count(source)
    val activeLimit: Int get() = if (serviceMode != TranslationMode.GENERIC_HTTPS) 1000 else TranslationPolicy.MAX_CODE_POINTS
    val tooLong: Boolean get() = characterCount > activeLimit
    val translationOutdated: Boolean get() = translation != null && translatedSource != source
}

class ReaderViewModel internal constructor(
    private val translationClient: TranslationClient = HttpsTranslationClient(),
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    private val healthClient: ProxyHealthClient = HttpsTranslationClient(),
    private val officialClient: OfficialDeepSeekClient = DeepSeekTranslationClient(),
    private var documentRepository: DocumentRepository? = null,
) : ViewModel() {
    private val mutableState = MutableStateFlow(ReaderState())
    val state = mutableState.asStateFlow()
    private var settings: TranslationSettings? = null
    private var keys: DeepSeekKeyRepository? = null
    private var initialized = false
    private var translationJob: Job? = null
    private var healthJob: Job? = null
    private var generation = 0L
    private var overLimitNotified = false
    private var baselineDocument: ReadingDocument? = null
    private var pendingLeave: (() -> Unit)? = null
    private var pendingSave: (() -> Unit)? = null
    private var listGeneration = 0L

    fun initializeDocuments(context: android.content.Context) {
        if (documentRepository == null) documentRepository = FileDocumentRepository(java.io.File(context.noBackupFilesDir, "reading-documents"))
        refreshDocuments()
    }
    fun refreshDocuments() {
        val repo = documentRepository ?: return
        val ticket = ++listGeneration
        mutableState.update { it.copy(documentsLoading = true, documentListError = false) }
        viewModelScope.launch(mainDispatcher) {
            try { val listing = repo.list(); if (ticket == listGeneration) mutableState.update { it.copy(documents = listing.documents, damagedDocuments = listing.damagedCount) } }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { if (ticket == listGeneration) mutableState.update { it.copy(documentListError = true) } }
            finally { if (ticket == listGeneration) mutableState.update { it.copy(documentsLoading = false) } }
        }
    }
    fun searchDocuments(query: String) { mutableState.update { it.copy(query = query) } }
    fun requestLeave(action: () -> Unit) {
        if (state.value.documentBusy || state.value.importing || state.value.leavePrompt) return
        if (state.value.dirty) { pendingLeave = action; mutableState.update { it.copy(leavePrompt = true) } }
        else action()
    }
    fun continueEditing() { pendingLeave = null; mutableState.update { it.copy(leavePrompt = false) } }
    fun discardAndLeave() {
        val action = pendingLeave; pendingLeave = null
        mutableState.update { it.copy(leavePrompt = false) }; action?.invoke()
    }
    fun navigate(page: ReaderPage) {
        if (page == state.value.page) return
        requestLeave { invalidateRequest(); mutableState.update { it.copy(page = page, translating = false) }; if (page == ReaderPage.DOCUMENTS) refreshDocuments() }
    }
    fun newDocument() = requestLeave {
        invalidateRequest(); baselineDocument = null
        mutableState.update { it.copy(source = "", translation = null, translatedSource = null, unchangedEnglish = false,
            fileName = null, documentId = null, savedContent = null, savedType = null, page = ReaderPage.READING, translating = false, message = null) }
    }
    fun openDocument(id: String) = requestLeave { openDocumentNow(id) }
    private fun openDocumentNow(id: String) {
        val repo = documentRepository ?: return
        invalidateRequest(); mutableState.update { it.copy(documentBusy = true, translating = false) }
        viewModelScope.launch(mainDispatcher) {
            try {
                val d = repo.read(id); DocumentCodec.validate(d); require(d.id == id)
                baselineDocument = d
                mutableState.update { it.copy(source = d.source, translation = d.translation, translatedSource = if (d.translation == null) null else d.source,
                    unchangedEnglish = d.unchangedEnglish, documentId = d.id, fileName = d.displayName,
                    savedContent = ReaderContent(d.source, d.translation, d.unchangedEnglish), savedType = d.saveType,
                    page = ReaderPage.READING, message = null, showLengthDialog = false) }
                overLimitNotified = false
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { mutableState.update { it.copy(message = "打开失败，当前内容已保留；原记录未更改。") } }
            finally { mutableState.update { it.copy(documentBusy = false) } }
        }
    }
    fun saveDocument(bilingual: Boolean, saveAs: Boolean = false, confirmed: Boolean = false) {
        val snapshot = state.value
        if (!snapshot.canSave || bilingual && !snapshot.validTranslation) return
        if (!saveAs && !bilingual && baselineDocument?.translation != null && !confirmed) {
            pendingSave = { saveDocument(false, false, true) }
            mutableState.update { it.copy(confirmRemoveSavedTranslation = true) }; return
        }
        val repo = documentRepository ?: return
        val previous = baselineDocument.takeUnless { saveAs }
        val now = System.currentTimeMillis().coerceAtLeast(previous?.createdAt ?: 0)
        val name = (snapshot.fileName ?: snapshot.source.lineSequence().firstOrNull { it.isNotBlank() } ?: "未命名文段").take(80).let { if (it.lastOrNull()?.isHighSurrogate() == true) it.dropLast(1) else it }
        val d = ReadingDocument(previous?.id ?: UUID.randomUUID().toString(), snapshot.source, if (bilingual) snapshot.translation else null,
            bilingual && snapshot.unchangedEnglish, previous?.createdAt ?: now, now, name)
        mutableState.update { it.copy(documentBusy = true) }
        viewModelScope.launch(mainDispatcher) {
            var afterSave: (() -> Unit)? = null
            var committed = false
            try {
                repo.write(d); baselineDocument = d; committed = true
                mutableState.update { it.copy(documentId = d.id, savedContent = ReaderContent(d.source, d.translation, d.unchangedEnglish), savedType = d.saveType, fileName = d.displayName, message = "已保存：${d.saveType}。") }
                // An in-memory translation intentionally omitted from an original-only save is still unsaved.
                afterSave = pendingLeave; pendingLeave = null
                mutableState.update { it.copy(leavePrompt = false) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { mutableState.update { it.copy(message = "保存失败，当前内容与原保存版本均保留。") } }
            finally { mutableState.update { it.copy(documentBusy = false) } }
            if (committed) { afterSave?.invoke(); refreshDocuments() }
        }
    }
    fun confirmOriginalOnlySave() { val action = pendingSave; pendingSave = null; mutableState.update { it.copy(confirmRemoveSavedTranslation = false) }; action?.invoke() }
    fun cancelOriginalOnlySave() { pendingSave = null; mutableState.update { it.copy(confirmRemoveSavedTranslation = false) } }


    fun initializeKeys(context: android.content.Context) {
        if (initialized) return
        initializeKeyRepository(DeepSeekKeyRepository.android(context.applicationContext))
    }

    internal fun initializeKeyRepository(repository: DeepSeekKeyRepository) {
        if (initialized) return
        initialized = true
        keys = repository
        mutableState.update { it.copy(keyLoading = true) }
        viewModelScope.launch(mainDispatcher) {
            try {
                val status = keys!!.load()
                val enabled = status.activeMode == TranslationMode.DEEPSEEK_DIRECT && status.configured
                mutableState.update { it.copy(serviceConfigured = enabled,
                    serviceMode = status.activeMode ?: TranslationMode.DEEPSEEK_DIRECT,
                    serviceHost = if (enabled) "api.deepseek.com" else null, keyRemembered = status.remembered, deepSeekConfigured = status.configured,
                    message = if (status.configured && status.activeMode == null) "已保留 Key；请主动应用配置以启用。" else it.message) }
            } catch (error: CancellationException) { throw error
            } catch (_: Exception) { mutableState.update { it.copy(message = translationErrorMessage("KEY_LOAD_FAILED")) } }
            finally { mutableState.update { it.copy(keyLoading = false) } }
        }
    }

    internal fun installKeyRepository(repository: DeepSeekKeyRepository) { keys = repository; initialized = true }

    fun configureDeepSeek(input: String?, remember: Boolean) {
        if (mutableState.value.keyLoading || mutableState.value.keyBusy) return
        val repository = keys ?: return
        invalidateRequest()
        mutableState.update { it.copy(keyBusy = true, translating = false) }
        viewModelScope.launch(mainDispatcher) {
            try {
                val status = repository.apply(input, remember)
                settings = null
                mutableState.update { it.copy(serviceConfigured = status.configured, serviceHost = "api.deepseek.com",
                    serviceMode = TranslationMode.DEEPSEEK_DIRECT, keyRemembered = status.remembered, deepSeekConfigured = status.configured,
                    keyCleanupPending = status.cleanupPending,
                    message = if (status.remembered) "Key 已加密保存。" else "Key 已应用，仅本次进程使用。") }
                overLimitNotified = false; resetLengthWarningWhenValid(); notifyLengthLimit()
            } catch (error: TranslationFailure) { mutableState.update { it.copy(message = translationErrorMessage(error.code)) } }
            finally { mutableState.update { it.copy(keyBusy = false) } }
        }
    }

    fun deleteDeepSeekKey() {
        if (mutableState.value.keyLoading || mutableState.value.keyBusy) return
        val repository = keys ?: return
        invalidateRequest()
        mutableState.update { it.copy(keyBusy = true, translating = false) }
        viewModelScope.launch(mainDispatcher) {
            try {
                repository.delete()
                mutableState.update { it.copy(serviceConfigured = if (it.serviceMode == TranslationMode.DEEPSEEK_DIRECT) false else it.serviceConfigured,
                    keyRemembered = false, deepSeekConfigured = false, keyCleanupPending = false, message = "DeepSeek Key 已清除。") }
            } catch (error: TranslationFailure) {
                mutableState.update { it.copy(serviceConfigured = if (error.code == "KEY_CLEANUP_PENDING" && it.serviceMode == TranslationMode.DEEPSEEK_DIRECT) false else it.serviceConfigured,
                    keyRemembered = if (error.code == "KEY_CLEANUP_PENDING") false else it.keyRemembered,
                    deepSeekConfigured = if (error.code == "KEY_CLEANUP_PENDING") false else it.deepSeekConfigured,
                    keyCleanupPending = error.code == "KEY_CLEANUP_PENDING", message = translationErrorMessage(error.code)) }
            } finally { mutableState.update { it.copy(keyBusy = false) } }
        }
    }

    fun cancelTranslation() {
        invalidateRequest()
        mutableState.update { it.copy(translating = false, message = "操作已取消；已发送请求仍可能产生费用。") }
    }

    fun edit(text: String) {
        if (mutableState.value.documentBusy || mutableState.value.leavePrompt || mutableState.value.importing || text == mutableState.value.source) return
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

    fun configureTranslation(endpoint: String, accessToken: String, mode: TranslationMode = TranslationMode.GENERIC_HTTPS, certificatePin: String = "", onApplied: () -> Unit = {}): Boolean {
        if (mutableState.value.keyLoading || mutableState.value.keyBusy || mode == TranslationMode.DEEPSEEK_DIRECT) return false
        val normalizedEndpoint = endpoint.trim()
        val normalizedToken = accessToken.trim()
        val candidate = TranslationSettings(normalizedEndpoint, normalizedToken, mode, certificatePin)
        if (!candidate.valid) {
            mutableState.update { it.copy(message = translationErrorMessage("INVALID_CONFIG")) }
            return false
        }
        persistProxySelection(mode, onApplied) {
            settings = candidate
            mutableState.update { it.copy(serviceConfigured = true, serviceHost = URI(normalizedEndpoint).host,
                serviceMode = mode, message = "试用配置已应用，仅在本次应用运行期间保留。") }
        }
        return true // Accepted; onApplied runs only after the durable mode transaction succeeds.
    }

    fun clearTranslationSettings(onApplied: () -> Unit = {}) {
        if (mutableState.value.keyLoading || mutableState.value.keyBusy) return
        val mode = mutableState.value.serviceMode.takeIf { it != TranslationMode.DEEPSEEK_DIRECT } ?: TranslationMode.GENERIC_HTTPS
        persistProxySelection(mode, onApplied) {
            settings = null
            mutableState.update { it.copy(serviceConfigured = false, serviceHost = null, serviceMode = mode,
                showLengthDialog = false, message = "试用配置已清除。") }
        }
    }

    private fun persistProxySelection(mode: TranslationMode, onApplied: () -> Unit, publish: () -> Unit) {
        invalidateRequest()
        mutableState.update { it.copy(keyBusy = true, translating = false) }
        // Legacy callers without an Android repository retain their in-memory configuration API.
        if (keys == null) {
            publish(); finishModeChange(); mutableState.update { it.copy(keyBusy = false) }; onApplied(); return
        }
        viewModelScope.launch(mainDispatcher) {
            try {
                keys!!.selectMode(mode)
                publish(); finishModeChange(); onApplied()
            } catch (error: CancellationException) { throw error
            } catch (error: TranslationFailure) { mutableState.update { it.copy(message = translationErrorMessage(error.code)) } }
            finally { mutableState.update { it.copy(keyBusy = false) } }
        }
    }

    private fun finishModeChange() {
        overLimitNotified = false
        resetLengthWarningWhenValid()
        notifyLengthLimit()
    }

    fun checkConnection() {
        val direct = mutableState.value.serviceMode == TranslationMode.DEEPSEEK_DIRECT
        val config = settings
        if ((!direct && config?.mode != TranslationMode.TEMP_PC_DEEPSEEK) || !mutableState.value.serviceConfigured || mutableState.value.keyLoading || mutableState.value.keyBusy || mutableState.value.checkingConnection || mutableState.value.translating) return
        val requestGeneration = ++generation
        mutableState.update { it.copy(checkingConnection = true, connectionMessage = null) }
        healthJob = viewModelScope.launch(mainDispatcher) {
            try {
                val display = if (direct) {
                    val key = keys?.snapshot() ?: throw TranslationFailure("INVALID_KEY")
                    officialClient.check(key)
                    "Key 验证通过：本次模型列表可达且通过鉴权；不代表余额或翻译质量。"
                } else healthClient.check(config!!).display
                if (generation == requestGeneration) mutableState.update { it.copy(checkingConnection = false, connectionMessage = display) }
            } catch (error: CancellationException) { throw error
            } catch (error: Exception) {
                if (generation == requestGeneration) mutableState.update { it.copy(checkingConnection = false,
                    connectionMessage = translationErrorMessage((error as? TranslationFailure)?.code ?: "SERVICE_UNAVAILABLE")) }
            }
        }
    }

    fun cancelConnectionCheck() { invalidateRequest() }

    fun importTxt(resolver: ContentResolver, uri: Uri) {
        if (mutableState.value.importing || mutableState.value.documentBusy) return
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
        baselineDocument = null
        mutableState.update {
            it.copy(source = text, fileName = name, importing = false, translating = false,
                translation = null, translatedSource = null, unchangedEnglish = false, documentId = null, savedContent = null, savedType = null, page = ReaderPage.READING,
                message = null, showLengthDialog = false)
        }
        notifyLengthLimit()
    }

    fun translate() {
        val snapshot = mutableState.value
        if (snapshot.documentBusy || snapshot.leavePrompt || snapshot.importing || snapshot.translating || snapshot.checkingConnection || snapshot.keyLoading || snapshot.keyBusy) return
        if (snapshot.source.isBlank()) {
            mutableState.update { it.copy(message = "请先输入文字或选择 TXT。") }
            return
        }
        if (snapshot.tooLong) {
            notifyLengthLimit()
            mutableState.update { it.copy(message = "文段超出 ${snapshot.activeLimit} 码点范围，全文已保留。") }
            return
        }
        if (snapshot.serviceMode == TranslationMode.DEEPSEEK_DIRECT) {
            try { DeepSeekTextProtection.validate(snapshot.source) } catch (error: TranslationFailure) {
                mutableState.update { it.copy(message = translationErrorMessage(error.code)) }; return
            }
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
        if (requestSettings == null && snapshot.serviceMode != TranslationMode.DEEPSEEK_DIRECT || !snapshot.serviceConfigured) {
            mutableState.update { it.copy(message = "请先配置试用翻译服务；原文已保留。") }
            return
        }
        val requestGeneration = ++generation
        val requestId = UUID.randomUUID().toString()
        mutableState.update { it.copy(translating = true, message = null) }
        translationJob = viewModelScope.launch(mainDispatcher) {
            try {
                val translation = if (snapshot.serviceMode == TranslationMode.DEEPSEEK_DIRECT) {
                    val key = keys?.snapshot() ?: throw TranslationFailure("INVALID_KEY")
                    officialClient.translate(snapshot.source, key)
                } else translationClient.translate(snapshot.source, requestId, requestSettings!!)
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
