package com.bilingualauditor.app

import android.os.Bundle
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
    val resolver = LocalContext.current.applicationContext.contentResolver
    var confirmReplace by rememberSaveable { mutableStateOf(false) }
    var showConfiguration by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) model.importTxt(resolver, uri)
    }
    val chooseFile = { picker.launch(arrayOf("text/plain", "application/octet-stream")) }

    Column(
        modifier = Modifier.fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("双语阅读", style = MaterialTheme.typography.headlineMedium)
        Text("打开文段并翻译", style = MaterialTheme.typography.titleMedium)
        Text("支持中文、英文或中英混合的 UTF-8 TXT。导入安全上限为 256 KiB、100,000 字符；单文段翻译上限为 10,000 字符（包含空白和标点）。也可以输入或长按粘贴。")
        OutlinedButton(
            onClick = { if (state.source.isNotEmpty()) confirmReplace = true else chooseFile() },
            enabled = !state.importing,
        ) { Text("选择 TXT") }
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
            enabled = !state.importing,
            isError = state.tooLong,
        )
        Text("${state.characterCount} / ${state.activeLimit} Unicode 码点",
            color = if (state.tooLong) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        if (state.tooLong) {
            Text("文段超出范围，暂不能翻译；全文仍保留。", color = MaterialTheme.colorScheme.error)
        }
        OutlinedButton(onClick = { showConfiguration = true }, enabled = !state.importing) {
            Text(if (state.serviceConfigured) "修改试用翻译配置" else "配置试用翻译服务")
        }
        if (state.serviceConfigured) {
            Text("翻译服务：${state.serviceHost}。配置仅临时保留，关闭应用后需重新配置。",
                style = MaterialTheme.typography.bodySmall)
        }
        if (state.serviceMode == TranslationMode.TEMP_PC_DEEPSEEK && state.serviceConfigured) {
            Text("临时电脑代理，未云部署。电脑须保持运行并连接本手机热点，仅一台手机；请求经电脑发送至 DeepSeek，供应商 Key 只在电脑。仅用公开或自写短文；每次最多 1,000 码点（含空白标点），最多 20 次上游尝试或 3 元预留，失败和重试也计数。预留不是实际账单或 API 余额。")
            OutlinedButton(onClick = model::checkConnection,
                enabled = !state.importing && !state.translating && !state.checkingConnection) { Text("检查连接（不调用模型）") }
            if (state.checkingConnection) TextButton(onClick = model::cancelConnectionCheck) { Text("取消连接检查") }
            state.connectionMessage?.let { Text(it) }
        }
        Text("点击翻译会将当前文段发送到你配置的翻译服务；英文内容原样阅读时不联网。",
            style = MaterialTheme.typography.bodySmall)
        Button(onClick = model::translate,
            enabled = !state.importing && !state.translating && !state.checkingConnection && !state.tooLong) {
            Text(if (state.translating) "正在翻译…" else "翻译成英文 / 阅读英文")
        }
        if (state.translating) {
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
        Text("当前原文仅临时保留，关闭应用后可能丢失；不会修改原 TXT 文件。",
            style = MaterialTheme.typography.bodySmall)
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
            onApply = { endpoint, token, mode, pin ->
                if (model.configureTranslation(endpoint, token, mode, pin)) showConfiguration = false
            },
            onClear = { model.clearTranslationSettings(); showConfiguration = false },
            onDismiss = { showConfiguration = false },
        )
    }
    if (confirmReplace) {
        AlertDialog(
            onDismissRequest = { confirmReplace = false },
            title = { Text("选择另一个 TXT？") },
            text = { Text("成功读取新文件后会替换当前原文。取消选择或读取失败会保留当前原文。") },
            confirmButton = {
                TextButton(onClick = { confirmReplace = false; chooseFile() }) { Text("继续选择") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReplace = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun TranslationConfigurationDialog(
    configured: Boolean,
    onApply: (String, String, TranslationMode, String) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Credentials deliberately do not use rememberSaveable or a persistent preference.
    var endpoint by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf(TranslationMode.TEMP_PC_DEEPSEEK) }
    var pin by remember { mutableStateOf("") }
    var showValidationError by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("本人试用翻译配置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.verticalScroll(rememberScrollState())) {
                TextButton(onClick = { mode = if (mode == TranslationMode.TEMP_PC_DEEPSEEK) TranslationMode.GENERIC_HTTPS else TranslationMode.TEMP_PC_DEEPSEEK }) {
                    Text(if (mode == TranslationMode.TEMP_PC_DEEPSEEK) "模式：临时电脑 DeepSeek 代理（点击切换）" else "模式：通用 HTTPS 服务（点击切换）")
                }
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
                if (showValidationError) {
                    Text("请检查 HTTPS 地址、访问凭证，以及电脑模式所需的私有 IPv4 和证书指纹。", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val cleanedToken = token.trim()
                if (!TranslationSettings(endpoint.trim(), cleanedToken, mode, pin).valid) {
                    showValidationError = true
                } else onApply(endpoint, token, mode, pin)
            }) { Text("应用配置") }
        },
        dismissButton = {
            if (configured) TextButton(onClick = onClear) { Text("清除配置") }
            else TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
