package com.bilingualauditor.app

import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.Checkbox
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) { ReaderScreen() }
            }
        }
    }
}

@Composable
private fun ReaderScreen(model: ReaderViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current as? ComponentActivity
    val context = LocalContext.current.applicationContext
    val resolver = context.contentResolver
    LaunchedEffect(model) { model.initializeKeys(context); model.initializeDocuments(context) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var saveOptions by remember { mutableStateOf(false) }
    var saveAs by remember { mutableStateOf(false) }
    BackHandler {
        if (drawer.isOpen) scope.launch { drawer.close() }
        else if (state.page != ReaderPage.READING) model.navigate(ReaderPage.READING)
        else model.requestLeave { activity?.finish() }
    }
    var showConfiguration by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) model.importTxt(resolver, uri)
    }
    val chooseFile = { picker.launch(arrayOf("text/plain", "application/octet-stream")) }

    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = !state.documentBusy && !state.importing,
        drawerContent = {
            ModalDrawerSheet {
                Text("双语阅读", modifier = Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge)
                listOf(Triple(ReaderPage.READING, "📝", "阅读"), Triple(ReaderPage.DOCUMENTS, "📂", "已保存文档"),
                    Triple(ReaderPage.WORDS, "📘", "单词本"), Triple(ReaderPage.PREFERENCES, "⚙️", "偏好设置")).forEach { (page, icon, label) ->
                    NavigationDrawerItem(icon = { Text(icon) }, label = { Text(label) }, selected = state.page == page,
                        onClick = { if (!state.documentBusy && !state.importing) { scope.launch { drawer.close() }; model.navigate(page) } })
                }
            }
        }) {
    Column(
        modifier = Modifier.fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TextButton(onClick = { scope.launch { drawer.open() } }, enabled = !state.documentBusy && !state.importing) { Text("☰ 目录") }
        if (state.page == ReaderPage.DOCUMENTS) {
            Text("已保存文档", style = MaterialTheme.typography.headlineMedium)
            OutlinedTextField(value = state.query, onValueChange = model::searchDocuments, label = { Text("搜索名称、原文或英文") }, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = model::refreshDocuments, enabled = !state.documentBusy) { Text("刷新") }
            if (state.documentsLoading) Text("正在加载…")
            if (state.documentListError) Text("列表读取失败，请重试；文件未更改。", color = MaterialTheme.colorScheme.error)
            if (state.damagedDocuments > 0) Text("${state.damagedDocuments} 条记录损坏或版本不支持，已保留原文件。", color = MaterialTheme.colorScheme.error)
            if (!state.documentsLoading && !state.documentListError && state.filteredDocuments.isEmpty()) Text(if (state.query.isEmpty()) "还没有已保存文档。" else "没有匹配的文档。")
            state.filteredDocuments.forEach { document ->
                OutlinedButton(onClick = { model.openDocument(document.id) }, enabled = !state.documentBusy, modifier = Modifier.fillMaxWidth()) {
                    Column { Text(document.displayName); Text(document.saveType, style = MaterialTheme.typography.bodySmall) }
                }
            }
            state.message?.let { Text(it) }
        } else if (state.page == ReaderPage.WORDS) {
            Text("单词本", style = MaterialTheme.typography.headlineMedium)
            Text("单词本待开发。")
        } else if (state.page == ReaderPage.PREFERENCES) {
            Text("偏好设置", style = MaterialTheme.typography.headlineMedium)
            OutlinedButton(onClick = { showConfiguration = true }) { Text("翻译设置") }
            Text("当前翻译模式：${state.serviceMode}")
            state.message?.let { Text(it) }
        } else {
        Text("双语阅读", style = MaterialTheme.typography.headlineMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = model::newDocument, enabled = !state.documentBusy && !state.importing) { Text("新建") }
            OutlinedButton(onClick = { saveAs = false; saveOptions = true }, enabled = state.canSave) { Text("保存") }
            OutlinedButton(onClick = { saveAs = true; saveOptions = true }, enabled = state.canSave) { Text("另存为") }
        }
        Text((state.savedType?.let { "保存版本：$it · " } ?: "临时文段 · ") + if (state.dirty) "有未保存变化" else if (state.documentId != null) "已保存" else "尚未保存")
        if (state.documentBusy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        Text("打开文段并翻译", style = MaterialTheme.typography.titleMedium)
        Text("支持中文、英文或中英混合的 UTF-8 TXT。导入安全上限为 256 KiB、100,000 字符；当前模式翻译上限为 ${state.activeLimit} Unicode 码点（包含空白、标点和 emoji）；通用产品上限为 10,000 码点。也可以输入或长按粘贴。")
        OutlinedButton(
            onClick = { model.requestLeave(chooseFile) },
            enabled = !state.importing && !state.documentBusy,
        ) { Text("导入 TXT") }
        state.fileName?.let { Text("文件：$it") }
        if (state.importing) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Text("正在读取文件…")
        }
        OutlinedTextField(
            value = state.source,
            onValueChange = model::edit,
            label = { Text("原文") },
            modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused) model.onEditingFinished() },
            minLines = 8,
            maxLines = 14,
            enabled = !state.importing && !state.documentBusy,
            isError = state.tooLong,
        )
        Text("${state.characterCount} / ${state.activeLimit} Unicode 码点",
            color = if (state.tooLong) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        if (state.tooLong) {
            Text("文段超出范围，暂不能翻译；全文仍保留。", color = MaterialTheme.colorScheme.error)
        }
        OutlinedButton(onClick = { showConfiguration = true }, enabled = !state.importing) {
            Text("翻译设置")
        }
        if (state.serviceConfigured) {
            Text("翻译服务：${state.serviceHost}。" + if (state.serviceMode == TranslationMode.DEEPSEEK_DIRECT && state.keyRemembered) "Key 已加密保存。" else "配置仅本次进程使用。",
                style = MaterialTheme.typography.bodySmall)
        }
        if (state.keyLoading) Text("正在读取 Key 配置…")
        if (state.serviceMode == TranslationMode.DEEPSEEK_DIRECT) {
            Text("自己的 DeepSeek Key：文段直接发送至 DeepSeek，API 费用由自己的账户承担。纯英文原样显示不调用模型；取消或超时仍可能产生费用。App 不是账户总消费硬上限。")
            OutlinedButton(onClick = model::checkConnection, enabled = state.serviceConfigured && !state.keyLoading && !state.keyBusy && !state.translating && !state.checkingConnection) { Text("检查连接（不调用模型）") }
            if (state.checkingConnection) TextButton(onClick = model::cancelConnectionCheck) { Text("取消连接检查") }
            state.connectionMessage?.let { Text(it) }
        }
        if (state.serviceMode == TranslationMode.TEMP_PC_DEEPSEEK && state.serviceConfigured) {
            Text("临时电脑代理，未云部署。电脑须保持运行并连接本手机热点，仅一台手机；请求经电脑发送至 DeepSeek，供应商 Key 只在电脑。仅用公开或自写短文；每次最多 1,000 码点（含空白标点），最多 20 次上游尝试或 3 元预留，失败和重试也计数。预留不是实际账单或 API 余额。")
            OutlinedButton(onClick = model::checkConnection,
                enabled = !state.documentBusy && !state.importing && !state.translating && !state.checkingConnection) { Text("检查连接（不调用模型）") }
            if (state.checkingConnection) TextButton(onClick = model::cancelConnectionCheck) { Text("取消连接检查") }
            state.connectionMessage?.let { Text(it) }
        }
        Text("点击翻译会将当前文段发送到你配置的翻译服务；英文内容原样阅读时不联网。",
            style = MaterialTheme.typography.bodySmall)
        Button(onClick = model::translate,
            enabled = !state.documentBusy && !state.importing && !state.translating && !state.checkingConnection && !state.keyLoading && !state.keyBusy && !state.tooLong) {
            Text(if (state.translating) "正在翻译…" else "翻译成英文 / 阅读英文")
        }
        if (state.translating) {
            TextButton(onClick = model::cancelTranslation) { Text("取消翻译") }
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Text("英文译文", style = MaterialTheme.typography.titleMedium)
        if (state.translationOutdated) {
            Text("原文已修改，以下为旧译文，请重新翻译。", color = MaterialTheme.colorScheme.error)
        }
        if (state.unchangedEnglish && !state.translationOutdated) {
            Text("英文原文 · 未请求在线翻译", style = MaterialTheme.typography.bodySmall)
        }
        Text(state.translation ?: "译文会显示在这里。")
        Text("保存上限为 10,000 Unicode 码点。保存在本机私有空间，不修改原 TXT；未保存变化在进程终止后可能丢失。本机保存不等于备份。",
            style = MaterialTheme.typography.bodySmall)
    }
        }
    }
    if (saveOptions) {
        AlertDialog(onDismissRequest = { saveOptions = false }, title = { Text(if (saveAs) "另存为新文段" else "保存文段") },
            text = { Text("选择保存内容。双语必须对应当前原文。仅原文保存会省略英文；仍在内存中的英文会继续标为未保存变化。") },
            confirmButton = { TextButton(onClick = { saveOptions = false; model.saveDocument(true, saveAs) }, enabled = state.canSave && state.validTranslation) { Text("保存双语") } },
            dismissButton = { TextButton(onClick = { saveOptions = false; model.saveDocument(false, saveAs) }, enabled = state.canSave) { Text("仅保存原文") }; TextButton(onClick = { saveOptions = false }) { Text("取消") } })
    }
    if (state.leavePrompt) {
        AlertDialog(onDismissRequest = model::continueEditing, title = { Text("有未保存变化") },
            text = { Column { Text("保存成功后继续；放弃只在目标成功打开时替换当前内容。")
                state.message?.let { Text(it) }
                TextButton(onClick = { model.saveDocument(true) }, enabled = state.canSave && state.validTranslation) { Text("保存双语并继续") }
                TextButton(onClick = { model.saveDocument(false) }, enabled = state.canSave) { Text("保存原文并继续") }
            } },
            confirmButton = { TextButton(onClick = model::discardAndLeave, enabled = !state.documentBusy) { Text("放弃并继续") } },
            dismissButton = { TextButton(onClick = model::continueEditing, enabled = !state.documentBusy) { Text("继续编辑") } })
    }
    if (state.confirmRemoveSavedTranslation) {
        AlertDialog(onDismissRequest = model::cancelOriginalOnlySave, title = { Text("移除已保存的英文？") },
            text = { Text("这会把当前文段的保存版本更新为仅原文，并移除该版本的英文。内存译文仍可保留。") },
            confirmButton = { TextButton(onClick = model::confirmOriginalOnlySave) { Text("确认仅保存原文") } },
            dismissButton = { TextButton(onClick = model::cancelOriginalOnlySave) { Text("取消") } })
    }
    if (state.showLengthDialog) {
        AlertDialog(
            onDismissRequest = model::dismissLengthDialog,
            title = { Text("文段超出长度范围") },
            text = { Text("当前 ${state.characterCount} 字符，当前模式上限为 ${state.activeLimit} Unicode 码点。全文已保留，长度符合要求后才能翻译。以后可新建文件夹来组织文段；本版尚未提供文件夹功能，新建文件夹也不改变长度限制。") },
            confirmButton = { TextButton(onClick = model::dismissLengthDialog) { Text("知道了") } },
        )
    }
    if (showConfiguration) {
        TranslationConfigurationDialog(
            configured = state.serviceConfigured,
            state = state,
            onDeepSeekApply = model::configureDeepSeek,
            onDeleteKey = model::deleteDeepSeekKey,
            onApply = { endpoint, token, mode, pin ->
                model.configureTranslation(endpoint, token, mode, pin) { showConfiguration = false }
            },
            onClear = { model.clearTranslationSettings { showConfiguration = false } },
            onDismiss = { showConfiguration = false },
        )
    }

}

@Composable
private fun TranslationConfigurationDialog(
    configured: Boolean,
    state: ReaderState,
    onDeepSeekApply: (String?, Boolean) -> Unit,
    onDeleteKey: () -> Unit,
    onApply: (String, String, TranslationMode, String) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Credentials deliberately do not use rememberSaveable or a persistent preference.
    var endpoint by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf(TranslationMode.DEEPSEEK_DIRECT) }
    var pin by remember { mutableStateOf("") }
    var showValidationError by remember { mutableStateOf(false) }
    var errorAttempt by remember { mutableStateOf(0) }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(errorAttempt) {
        if (errorAttempt > 0) {
            for (offset in listOf(-10f, 10f, -6f, 6f, 0f)) shake.animateTo(offset, tween(45))
        }
    }
    var rememberKey by remember(state.keyRemembered) { mutableStateOf(state.keyRemembered) }
    var showKey by remember { mutableStateOf(false) }
    val busy = state.keyLoading || state.keyBusy
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("翻译设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.graphicsLayer { translationX = shake.value }.verticalScroll(rememberScrollState())) {
                TextButton(enabled = !busy, onClick = { mode = when (mode) {
                    TranslationMode.DEEPSEEK_DIRECT -> TranslationMode.TEMP_PC_DEEPSEEK
                    TranslationMode.TEMP_PC_DEEPSEEK -> TranslationMode.GENERIC_HTTPS
                    TranslationMode.GENERIC_HTTPS -> TranslationMode.DEEPSEEK_DIRECT
                }; token = ""; showValidationError = false }) {
                    Text(when (mode) {
                        TranslationMode.DEEPSEEK_DIRECT -> "🔑 自己的 DeepSeek Key（高级：切换代理）"
                        TranslationMode.TEMP_PC_DEEPSEEK -> "高级：临时电脑代理（点击切换）"
                        TranslationMode.GENERIC_HTTPS -> "高级：通用 HTTPS 代理（点击切换）"
                    })
                }
                if (mode == TranslationMode.DEEPSEEK_DIRECT) {
                    Text("DeepSeek 官方服务 · api.deepseek.com。文段直发，费用由自己的账户承担。应用配置不联网；检查连接需要主动点击。")
                    if (state.deepSeekConfigured) Text(if (state.serviceMode == TranslationMode.DEEPSEEK_DIRECT && state.serviceConfigured) "✅ Key 已启用；不回填明文。留空可调整保存方式，输入新 Key 可替换。" else "已保留 Key，当前未启用；留空并应用可主动启用，不回填明文。")
                    OutlinedTextField(value = token, onValueChange = { if (it.length <= 512) token = it },
                        label = { Text("DeepSeek API Key") }, singleLine = true, enabled = !busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                        visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation())
                    TextButton(onClick = { showKey = !showKey }, enabled = !busy) { Text(if (showKey) "隐藏本次输入" else "显示本次输入") }
                    Row { Checkbox(checked = rememberKey, onCheckedChange = { rememberKey = it }, enabled = !busy); Text("记住 Key（默认关闭，加密保存在本机）") }
                    Text("仅本次使用在进程终止后失效。取消/超时仍可能产生费用；本地限制不能约束账户总消费。")
                    TextButton(onClick = { token = ""; onDeleteKey() }, enabled = !busy) { Text(if (state.keyCleanupPending) "重试清理系统密钥" else "删除 DeepSeek Key") }
                    state.message?.let { Text(it) }
                } else {
                Text("配置仅保留在本次运行内存中。填写代理访问 Bearer 凭证，不能填写 DeepSeek、Azure 或其他供应商 API Key。")
                if (mode == TranslationMode.TEMP_PC_DEEPSEEK) {
                    Text("填写电脑就绪窗口提供的完整私有 IPv4 HTTPS 地址和 SHA-256 证书指纹。电脑须连接本手机热点并保持运行。")
                    OutlinedTextField(value = pin, onValueChange = { pin = it }, label = { Text("证书 SHA-256 指纹（64 位十六进制）") })
                }
                OutlinedTextField(value = endpoint, onValueChange = { endpoint = it },
                    label = { Text("HTTPS 翻译地址（以 /translate 结尾）") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                OutlinedTextField(value = token, onValueChange = { token = it },
                    label = { Text("个人访问凭证") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    visualTransformation = PasswordVisualTransformation())
                }
                if (showValidationError) {
                    Text(if (mode == TranslationMode.DEEPSEEK_DIRECT) "⚠️ 请检查 Key：不能为空、含空白或控制字符。" else "请检查 HTTPS 地址、访问凭证，以及电脑模式所需的私有 IPv4 和证书指纹。", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                if (mode == TranslationMode.DEEPSEEK_DIRECT) {
                    try {
                        if (token.isNotEmpty()) DeepSeekApiKey.parse(token)
                        else if (!state.deepSeekConfigured) throw TranslationFailure("INVALID_KEY")
                        onDeepSeekApply(token.takeIf { it.isNotEmpty() }, rememberKey); token = ""; showValidationError = false
                    } catch (_: TranslationFailure) { showValidationError = true; errorAttempt++ }
                    return@TextButton
                }
                val cleanedToken = token.trim()
                if (!TranslationSettings(endpoint.trim(), cleanedToken, mode, pin).valid) {
                    showValidationError = true; errorAttempt++
                } else onApply(endpoint, token, mode, pin)
            }) { Text("应用配置") }
        },
        dismissButton = {
            if (configured && mode != TranslationMode.DEEPSEEK_DIRECT) TextButton(onClick = onClear, enabled = !busy) { Text("清除代理配置") }
            TextButton(onClick = onDismiss, enabled = !busy) { Text("关闭") }
        },
    )
}
