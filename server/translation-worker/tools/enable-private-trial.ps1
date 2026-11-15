#requires -Version 7.0
[CmdletBinding()]
param([switch]$SelfTest, [switch]$ReuseExistingToken, [switch]$DiagnosticOnce)

# Never enable tracing/transcription, print ErrorRecord, or return raw CLI output.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$workerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$endpoint = 'https://bilingual-auditor-translation.anrannarna.workers.dev/translate'
$account = 'd06ab0448a151f1907b09bf22da3649a'
$worker = 'bilingual-auditor-translation'
$script:personalToken = $null
$script:secretAttempted = $false
$script:failure = $false
$script:enabled = $false
$script:phase = 'precheck'

function Invoke-CapturedProcess {
    param([string]$Executable, [string[]]$Arguments, [AllowNull()][string]$InputText)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.WorkingDirectory = $workerRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($arg in $Arguments) { $start.ArgumentList.Add($arg) }
    $start.Environment['CLOUDFLARE_ACCOUNT_ID'] = $account
    $start.Environment['WRANGLER_WRITE_LOGS'] = 'false'
    $start.Environment['WRANGLER_LOG_SANITIZE'] = 'true'
    $start.Environment['WRANGLER_SEND_METRICS'] = 'false'
    $start.Environment['WRANGLER_SEND_ERROR_REPORTS'] = 'false'
    $start.Environment['WRANGLER_LOG'] = 'log'
    $start.Environment['CI'] = 'true'
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        $null = $process.Start()
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        if ($null -ne $InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(120000)) {
            $process.Kill($true)
            throw 'PROCESS_TIMEOUT'
        }
        $output = $outTask.GetAwaiter().GetResult()
        $null = $errTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'CLI_FAILED' }
        return $output
    } finally { $process.Dispose() }
}

function Invoke-Wrangler {
    param([string[]]$Command, [AllowNull()][string]$InputText = $null)
    $argsList = @('node_modules/wrangler/bin/wrangler.js') + $Command
    return Invoke-CapturedProcess -Executable $script:nodePath -Arguments $argsList -InputText $InputText
}

function Get-ProductionVersion {
    $raw = Invoke-Wrangler -Command @('deployments', 'status', '--json', '--name', $worker)
    $deployment = ConvertFrom-Json -InputObject $raw
    if (@($deployment.versions).Count -ne 1 -or $deployment.versions[0].percentage -ne 100 -or
        $deployment.versions[0].version_id -notmatch '^[0-9a-f-]{36}$') { throw 'PRODUCTION_NOT_SINGLE_VERSION' }
    return [string]$deployment.versions[0].version_id
}

function Assert-ProductionSecrets {
    param([string]$Version, [switch]$RequirePersonalToken, [switch]$RejectPersonalToken, [switch]$RequireDiagnosticsEnabled)
    $raw = Invoke-Wrangler -Command @('versions', 'view', $Version, '--json', '--name', $worker)
    $versionMetadata = ConvertFrom-Json -InputObject $raw
    # Deliberately project only binding name/type. Never inspect Azure key text.
    $bindings = @($versionMetadata.resources.bindings | ForEach-Object {
        [pscustomobject]@{ Name = [string]$_.name; Type = [string]$_.type }
    })
    $names = @('AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION')
    if ($RequirePersonalToken) { $names += 'ACCESS_TOKEN' }
    foreach ($name in $names) {
        if (@($bindings | Where-Object { $_.Name -eq $name -and $_.Type -eq 'secret_text' }).Count -ne 1) {
            throw 'SECRET_TYPE_GATE_FAILED'
        }
    }
    if ($RejectPersonalToken -and @($bindings | Where-Object { $_.Name -eq 'ACCESS_TOKEN' }).Count -ne 0) {
        throw 'EXISTING_PERSONAL_TOKEN'
    }
    if ($RequireDiagnosticsEnabled) {
        $diagnostics = @($versionMetadata.resources.bindings | Where-Object { $_.name -ceq 'SAFE_UPSTREAM_DIAGNOSTICS' })
        if ($diagnostics.Count -ne 1 -or $diagnostics[0].type -cne 'plain_text' -or $diagnostics[0].text -cne 'SAFE_ENUMS_V1') {
            throw 'DIAGNOSTIC_ENABLE_NOT_CONFIRMED'
        }
    }
}

function Write-SafeDiagnostic {
    param($Data)
    # Never interpolate fields from an untrusted response: emit only allowlisted constants.
    $stage = 'OTHER'; $httpStatus = 'OTHER'; $azureCode = 'OTHER'
    if ($null -ne $Data -and $null -ne $Data.PSObject.Properties['error']) {
        $errorData = $Data.error
        if ($null -ne $errorData -and $null -ne $errorData.PSObject.Properties['diagnostic']) {
            $diag = $errorData.diagnostic
            if ($null -ne $diag) {
                foreach ($known in @('transport','response_decode','http','response_shape')) {
                    if ($null -ne $diag.PSObject.Properties['stage'] -and $diag.stage -is [string] -and $diag.stage -ceq $known) { $stage = $known }
                }
                foreach ($known in @('200','400','401','403','405','408','415','429','500','503')) {
                    if ($null -ne $diag.PSObject.Properties['httpStatus'] -and $diag.httpStatus -is [string] -and $diag.httpStatus -ceq $known) { $httpStatus = $known }
                }
                foreach ($known in @('400000','400001','400002','400003','400004','400005','400006',
                    '400018','400019','400020','400021','400023','400035','400036','400042','400043',
                    '400050','400064','400070','400071','400072','400073','400074','400075','400077',
                    '400079','400080','401000','401015','403000','403001','405000','408001','408002',
                    '415000','429000','429001','429002','500000','503000')) {
                    if ($null -ne $diag.PSObject.Properties['azureCode'] -and $diag.azureCode -is [string] -and $diag.azureCode -ceq $known) { $azureCode = $known }
                }
            }
        }
    }
    Write-Output "SAFE_DIAGNOSTIC STAGE=$stage HTTP=$httpStatus AZURE=$azureCode"
}

function Invoke-SyntheticCase {
    param([string]$Name, [string]$Text, [int]$ExpectedStatus = 200,
        [string]$ExpectedCode = '', [string[]]$Preserve = @(), [switch]$Unauthorized, [switch]$Exact)
    $requestId = [guid]::NewGuid().ToString()
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $endpoint)
    $response = $null
    try {
        if (-not $Unauthorized) {
            $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:personalToken)
        }
        $body = @{ text = $Text; requestId = $requestId } | ConvertTo-Json -Compress
        $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
        $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(40))
        $response = $script:http.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($response.Content.Headers.ContentLength -gt 1000000) { throw 'RESPONSE_TOO_LARGE' }
        $stream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
        $memory = [IO.MemoryStream]::new()
        try {
            $buffer = [byte[]]::new(8192)
            while ($true) {
                $count = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()
                if ($count -eq 0) { break }
                if ($memory.Length + $count -gt 1000000) { throw 'RESPONSE_TOO_LARGE' }
                $memory.Write($buffer, 0, $count)
            }
            $raw = [Text.Encoding]::UTF8.GetString($memory.ToArray())
        } finally { $memory.Dispose(); $stream.Dispose() }
        try { $data = ConvertFrom-Json -InputObject $raw }
        catch {
            Write-Output "CASE=$Name STATUS=$status CODE=INVALID_RESPONSE"
            throw 'INVALID_RESPONSE'
        }
        $code = 'OK'
        if ($status -ne 200) {
            $allowed = @('INVALID_REQUEST','TEXT_TOO_LONG','UNAUTHORIZED','RATE_LIMITED','QUOTA_EXCEEDED',
                'SERVICE_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_ERROR','PRESERVATION_FAILED','PROTECTION_LIMIT')
            $code = 'UNRECOGNIZED_ERROR'
            if ($data.error.code -cin $allowed) { $code = [string]$data.error.code }
        }
        Write-Output "CASE=$Name STATUS=$status CODE=$code"
        if ($DiagnosticOnce -and $Name -ceq 'chinese' -and $status -ne 200) { Write-SafeDiagnostic -Data $data }
        if ($status -ne $ExpectedStatus -or ($ExpectedCode -and $code -cne $ExpectedCode)) { throw 'SYNTHETIC_CASE_FAILED' }
        if ($status -eq 200) {
            if ($data.requestId -cne $requestId -or $data.translation -isnot [string] -or
                -not $data.translation.Trim() -or $data.translation.Length -gt 20000) { throw 'RESPONSE_CONTRACT_FAILED' }
            $translation = [string]$data.translation
            if ($translation.Contains($script:personalToken)) { throw 'RESPONSE_CONTRACT_FAILED' }
            foreach ($fragment in $Preserve) {
                if (-not $translation.Contains($fragment, [StringComparison]::Ordinal)) { throw 'PRESERVATION_CHECK_FAILED' }
            }
            if ($Exact -and $translation -cne $Text) { throw 'PRESERVATION_CHECK_FAILED' }
            # Synthetic translations only; JSON escapes control characters in console output.
            Write-Output "CASE=$Name CONSISTENCY=OK TRANSLATION=$($translation | ConvertTo-Json -Compress)"
        }
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne (Get-Variable deadline -ErrorAction SilentlyContinue)) { $deadline.Dispose() }
        $request.Dispose()
    }
}

function Show-PrivateConfiguration {
    $form = [Windows.Forms.Form]::new()
    try {
        $form.Text = 'BilingualAuditor 本人配置（请勿截图或分享）'
        $form.Width = 760; $form.Height = 320
        $form.StartPosition = 'CenterScreen'
        $form.TopMost = $true
        $label = [Windows.Forms.Label]::new()
        $label.SetBounds(16, 12, 710, 50)
        $label.Text = '请将完整地址和本人访问凭证录入手机。关闭前请转存到自己的密码管理器；工具不会保存凭证。此凭证不是 Azure 密钥。'
        if ($script:failure) {
            $label.Text = '翻译验证未通过，凭证请保管，当前未验收。关闭前请转存到自己的密码管理器；工具不会保存凭证。此凭证不是 Azure 密钥。'
        }
        $urlBox = [Windows.Forms.TextBox]::new()
        $urlBox.SetBounds(16, 70, 710, 28); $urlBox.ReadOnly = $true; $urlBox.Text = $endpoint
        $tokenBox = [Windows.Forms.TextBox]::new()
        $tokenBox.SetBounds(16, 115, 710, 28); $tokenBox.ReadOnly = $true; $tokenBox.UseSystemPasswordChar = $true; $tokenBox.Text = $script:personalToken
        $showToken = [Windows.Forms.CheckBox]::new()
        $showToken.SetBounds(420, 165, 180, 34); $showToken.Text = '显示本人凭证'
        $showToken.Add_CheckedChanged({ $tokenBox.UseSystemPasswordChar = -not $showToken.Checked })
        $copyUrl = [Windows.Forms.Button]::new()
        $copyUrl.SetBounds(16, 165, 180, 34); $copyUrl.Text = '复制地址'
        $copyUrl.Add_Click({ try { [Windows.Forms.Clipboard]::SetText($endpoint) } catch { } })
        $copyToken = [Windows.Forms.Button]::new()
        $copyToken.SetBounds(216, 165, 180, 34); $copyToken.Text = '复制本人访问凭证'
        $copyToken.Add_Click({ try { [Windows.Forms.Clipboard]::SetText($script:personalToken) } catch { } })
        $form.Controls.AddRange(@($label, $urlBox, $tokenBox, $copyUrl, $copyToken, $showToken))
        $form.Add_FormClosing({ param($sender, $eventArgs)
            $answer = [Windows.Forms.MessageBox]::Show('已转存到自己的密码管理器？关闭后工具不会保存凭证。', '关闭确认', 'YesNo', 'Warning')
            if ($answer -ne [Windows.Forms.DialogResult]::Yes) { $eventArgs.Cancel = $true }
        })
        $form.Add_Shown({ Write-Output 'PRIVATE_CONFIGURATION_WINDOW_READY' | Out-Host })
        $null = $form.ShowDialog()
        $tokenBox.Clear()
    } finally { $form.Dispose() }
}

function Read-ExistingPersonalToken {
    # User-owned masked input only: no clipboard access, reveal, copy, argv or files.
    $form = [Windows.Forms.Form]::new()
    $timer = [Windows.Forms.Timer]::new()
    $box = [Windows.Forms.TextBox]::new()
    try {
        $form.Text = 'BilingualAuditor 输入已保存的本人凭证（请勿截图）'
        $form.Width = 720; $form.Height = 220; $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
        $label = [Windows.Forms.Label]::new()
        $label.SetBounds(16, 12, 670, 48)
        $label.Text = '配置门槛已通过。请输入此前保存的本人访问凭证；不生成或上传新凭证。取消、关闭或五分钟未确认将恢复关闭 guard。'
        $box.SetBounds(16, 66, 670, 28); $box.UseSystemPasswordChar = $true; $box.MaxLength = 256
        $ok = [Windows.Forms.Button]::new()
        $ok.SetBounds(440, 110, 115, 32); $ok.Text = '继续验证'; $ok.DialogResult = [Windows.Forms.DialogResult]::OK
        $cancel = [Windows.Forms.Button]::new()
        $cancel.SetBounds(570, 110, 115, 32); $cancel.Text = '取消'; $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
        $form.Controls.AddRange(@($label, $box, $ok, $cancel)); $form.AcceptButton = $ok; $form.CancelButton = $cancel
        $timer.Interval = 300000
        $timer.Add_Tick({ $form.DialogResult = [Windows.Forms.DialogResult]::Cancel; $form.Close() })
        $form.Add_Shown({ $timer.Start(); Write-Output 'EXISTING_TOKEN_INPUT_READY' | Out-Host })
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'EXISTING_TOKEN_INPUT_CANCELLED' }
        if ($box.Text -cnotmatch '^[A-Za-z0-9_-]{32,256}$') { throw 'EXISTING_TOKEN_FORMAT_FAILED' }
        $script:personalToken = $box.Text
    } finally { $timer.Stop(); $timer.Dispose(); $box.Clear(); $form.Dispose() }
}

function New-PrivateToken {
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $script:personalToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    [Array]::Clear($bytes, 0, $bytes.Length)
    $script:secretAttempted = $true
    $script:phase = 'token_upload'
    $null = Invoke-Wrangler -Command @('secret', 'put', 'ACCESS_TOKEN', '--name', $worker) -InputText $script:personalToken
    $secretVersion = Get-ProductionVersion
    Assert-ProductionSecrets -Version $secretVersion -RequirePersonalToken
    Write-Output "SECRET_VERSION=$secretVersion"
}

function Set-TrialGuard {
    param([switch]$Enable, [switch]$Diagnostic)
    $content = $script:config
    if ($Enable) { $content = $content.Replace('AZURE_TIER_CONFIRMED = ""', 'AZURE_TIER_CONFIRMED = "F0"') }
    if ($Enable -and $Diagnostic) { $content = $content.Replace('SAFE_UPSTREAM_DIAGNOSTICS = ""', 'SAFE_UPSTREAM_DIAGNOSTICS = "SAFE_ENUMS_V1"') }
    [IO.File]::WriteAllText($script:configPath, $content, [Text.UTF8Encoding]::new($false))
    $null = Invoke-Wrangler -Command @('deploy', '--name', $worker)
}

function Invoke-TrialFlow {
    param([switch]$Reuse, [switch]$Diagnostic)
    if ($Diagnostic -and -not $Reuse) { throw 'DIAGNOSTIC_REQUIRES_REUSE' }
    $script:diagnosticCloseNeeded = $false
    try {
    $initialVersion = Get-ProductionVersion
    if ($Reuse) { Assert-ProductionSecrets -Version $initialVersion -RequirePersonalToken }
    else { Assert-ProductionSecrets -Version $initialVersion -RejectPersonalToken }
    Write-Output "PRECHECK_VERSION=$initialVersion SECRET_TYPES=OK"
    if (-not $Reuse) { New-PrivateToken }
    $script:phase = 'guard_deploy'
    if ($Diagnostic) { $script:diagnosticCloseNeeded = $true }
    Set-TrialGuard -Enable -Diagnostic:$Diagnostic
    $script:enabled = $true
    $enabledVersion = Get-ProductionVersion
    Assert-ProductionSecrets -Version $enabledVersion -RequirePersonalToken -RequireDiagnosticsEnabled:$Diagnostic
    Write-Output "ENABLED_VERSION=$enabledVersion ENDPOINT=$endpoint"
    $script:phase = 'synthetic_tests'
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
    $script:http = [Net.Http.HttpClient]::new($handler)
    $script:http.Timeout = [TimeSpan]::FromSeconds(40)
    try {
        Invoke-SyntheticCase -Name 'unauthorized' -Text '合成测试' -ExpectedStatus 401 -ExpectedCode 'UNAUTHORIZED' -Unauthorized
        if ($Reuse) {
            $script:phase = 'existing_token_input'
            Read-ExistingPersonalToken
            $script:phase = 'synthetic_tests'
        }
        if (-not $Diagnostic) {
            Invoke-SyntheticCase -Name 'too_long' -Text ('中' * 10001) -ExpectedStatus 422 -ExpectedCode 'TEXT_TOO_LONG'
            Invoke-SyntheticCase -Name 'english' -Text 'I has a apple. NASA uses iPhone.' -Exact
        }
        # Four Azure calls maximum, no retries; first failure exits this sequence.
        Invoke-SyntheticCase -Name 'chinese' -Text '今天天气很好，我们一起去公园散步。'
        if (-not $Diagnostic) {
            Invoke-SyntheticCase -Name 'mixed' -Text '今天用 NASA API 测试 iPhone 和 OpenAI。' -Preserve @(' NASA API ', ' iPhone ', ' OpenAI。')
            Invoke-SyntheticCase -Name 'spelling' -Text '请保留 I has a apple. 这句话的原样。' -Preserve @(' I has a apple. ')
            Invoke-SyntheticCase -Name 'literal' -Text '链接 https://example.com/Aa?x=One&b=2 和 <b>Hello</b> 是字面文本。' -Preserve @(' https://example.com/Aa?x=One&b=2 ', ' <b>Hello</b> ')
        }
    } finally { $script:http.Dispose() }
    } catch {
        if (-not $Diagnostic -and ($script:enabled -or $script:phase -eq 'guard_deploy')) {
            try {
                Set-TrialGuard
                $closedVersion = Get-ProductionVersion
                Assert-ProductionSecrets -Version $closedVersion -RequirePersonalToken
                Assert-ProductionGuardClosed -Version $closedVersion
                Write-Output "GUARD_CLOSED_VERSION=$closedVersion"
                $script:enabled = $false
            } catch { Write-Output 'GUARD_CLOSE_UNCONFIRMED MANUAL_CHECK_REQUIRED' }
        }
        throw
    } finally {
        if ($Diagnostic -and $script:diagnosticCloseNeeded) {
            # A one-shot diagnosis never leaves translation or diagnostics enabled, even on success.
            try {
                Set-TrialGuard
                $closedVersion = Get-ProductionVersion
                Assert-ProductionSecrets -Version $closedVersion -RequirePersonalToken
                Assert-ProductionGuardClosed -Version $closedVersion -RequireDiagnosticsClosed
                Write-Output "GUARD_CLOSED_VERSION=$closedVersion DIAGNOSTICS=CLOSED"
                $script:enabled = $false
            } catch {
                Write-Output 'GUARD_CLOSE_UNCONFIRMED MANUAL_CHECK_REQUIRED'
                throw 'DIAGNOSTIC_CLOSE_FAILED'
            }
        }
    }
}

function Assert-ProductionGuardClosed {
    param([string]$Version, [switch]$RequireDiagnosticsClosed)
    $raw = Invoke-Wrangler -Command @('versions', 'view', $Version, '--json', '--name', $worker)
    $metadata = ConvertFrom-Json -InputObject $raw
    $guards = @($metadata.resources.bindings | Where-Object { $_.name -ceq 'AZURE_TIER_CONFIRMED' })
    if ($guards.Count -ne 1 -or $guards[0].type -cne 'plain_text' -or $guards[0].text -cne '') {
        throw 'GUARD_CLOSE_NOT_CONFIRMED'
    }
    if ($RequireDiagnosticsClosed) {
        $diagnostics = @($metadata.resources.bindings | Where-Object { $_.name -ceq 'SAFE_UPSTREAM_DIAGNOSTICS' })
        if ($diagnostics.Count -ne 1 -or $diagnostics[0].type -cne 'plain_text' -or $diagnostics[0].text -cne '') {
            throw 'DIAGNOSTIC_CLOSE_NOT_CONFIRMED'
        }
    }
}

function Invoke-FlowSelfTest {
    # Dynamic-scope stubs exercise the production sequence; no UI, remote, or real credential.
    function Get-ProductionVersion { return '00000000-0000-0000-0000-000000000000' }
    function Assert-ProductionSecrets {
        param($Version, [switch]$RequirePersonalToken, [switch]$RejectPersonalToken, [switch]$RequireDiagnosticsEnabled)
        if (-not $RequirePersonalToken -or $RejectPersonalToken) { throw 'SELFTEST_REUSE_GATE' }
        if ($RequireDiagnosticsEnabled) { $script:flowTest.diagnosticEnableConfirm++ }
    }
    function New-PrivateToken { throw 'SELFTEST_GENERATION_FORBIDDEN' }
    function Invoke-Wrangler { throw 'SELFTEST_CLI_FORBIDDEN' }
    function Show-PrivateConfiguration { throw 'SELFTEST_REVEAL_FORBIDDEN' }
    function Set-TrialGuard {
        param([switch]$Enable, [switch]$Diagnostic)
        if ($Enable) {
            $script:flowTest.open++
            if ([bool]$Diagnostic -ne $script:flowTest.diagnostic) { throw 'SELFTEST_DIAGNOSTIC_FLAG' }
            if ($script:flowTest.fail -eq 'guard_deploy') { throw 'SELFTEST_DEPLOY_FAILURE' }
        } else { $script:flowTest.close++ }
    }
    function Assert-ProductionGuardClosed {
        param($Version, [switch]$RequireDiagnosticsClosed)
        if ([bool]$RequireDiagnosticsClosed -ne $script:flowTest.diagnostic) { throw 'SELFTEST_DIAGNOSTIC_CLOSE_FLAG' }
        $script:flowTest.confirm++
    }
    function Read-ExistingPersonalToken {
        $script:flowTest.input++
        if ($script:flowTest.fail -eq 'input') { throw 'SELFTEST_CANCEL_OR_TIMEOUT' }
        $script:personalToken = 'SELFTEST_FIXED_NONSECRET_SENTINEL_0000'
    }
    function Invoke-SyntheticCase {
        param($Name, $Text, $ExpectedStatus, $ExpectedCode, $Preserve, [switch]$Unauthorized, [switch]$Exact)
        $script:flowTest.cases.Add($Name)
        if ($Name -in @('chinese','mixed','spelling','literal')) { $script:flowTest.azure++ }
        if ($Name -eq 'unauthorized' -and (-not $Unauthorized -or $ExpectedStatus -ne 401 -or $ExpectedCode -cne 'UNAUTHORIZED')) { throw 'SELFTEST_401_CONTRACT' }
        if ($Name -eq 'too_long' -and ($ExpectedStatus -ne 422 -or $ExpectedCode -cne 'TEXT_TOO_LONG')) { throw 'SELFTEST_LENGTH_CONTRACT' }
        if ($Name -eq 'english' -and -not $Exact) { throw 'SELFTEST_ENGLISH_CONTRACT' }
        if ($Name -ceq $script:flowTest.fail) { throw 'SELFTEST_CASE_FAILURE' }
    }
    try {
        foreach ($diagnosticMode in @($false, $true)) {
        $failures = @('', 'unauthorized', 'input', 'too_long', 'english', 'chinese', 'mixed', 'spelling', 'literal')
        if ($diagnosticMode) { $failures = @('', 'guard_deploy', 'unauthorized', 'input', 'chinese') }
        foreach ($failureAt in $failures) {
            $script:flowTest = @{ fail=$failureAt; diagnostic=$diagnosticMode; diagnosticEnableConfirm=0; open=0; close=0; confirm=0; input=0; azure=0; cases=[Collections.Generic.List[string]]::new() }
            $script:enabled = $false; $script:phase = 'precheck'; $script:personalToken = $null
            $caught = $false
            try { $null = Invoke-TrialFlow -Reuse -Diagnostic:$diagnosticMode } catch { $caught = $true }
            $maximum = 4; if ($diagnosticMode) { $maximum = 1 }
            if ($caught -ne [bool]$failureAt -or $script:flowTest.open -ne 1 -or $script:flowTest.azure -gt $maximum) { throw 'SELFTEST_FLOW_FAILED' }
            if ($failureAt -or $diagnosticMode) {
                if ($script:flowTest.close -ne 1 -or $script:flowTest.confirm -ne 1 -or $script:enabled) { throw 'SELFTEST_ROLLBACK_FAILED' }
            } elseif ($script:flowTest.close -ne 0 -or $script:flowTest.azure -ne 4 -or $script:flowTest.cases.Count -ne 7) { throw 'SELFTEST_MAXIMUM_FAILED' }
            if ($diagnosticMode -and -not $failureAt -and ($script:flowTest.azure -ne 1 -or $script:flowTest.cases.Count -ne 2)) { throw 'SELFTEST_DIAGNOSTIC_MAXIMUM_FAILED' }
            if ($diagnosticMode -and $failureAt -ne 'guard_deploy' -and $script:flowTest.diagnosticEnableConfirm -ne 1) { throw 'SELFTEST_DIAGNOSTIC_ENABLE_CONFIRM' }
            if ($failureAt -eq 'guard_deploy' -and ($script:flowTest.input -ne 0 -or $script:flowTest.azure -ne 0 -or $script:flowTest.cases.Count -ne 0)) { throw 'SELFTEST_DEPLOY_CONTINUED' }
            if ($failureAt -eq 'unauthorized' -and ($script:flowTest.input -ne 0 -or $script:flowTest.azure -ne 0 -or $script:flowTest.cases.Count -ne 1)) { throw 'SELFTEST_INPUT_BEFORE_401' }
            if ($failureAt -eq 'input' -and ($script:flowTest.azure -ne 0 -or $script:flowTest.cases.Count -ne 1)) { throw 'SELFTEST_CANCEL_AZURE' }
            if ($failureAt -notin @('guard_deploy','unauthorized') -and $script:flowTest.input -ne 1) { throw 'SELFTEST_INPUT_COUNT' }
            if ($failureAt -in @('too_long','english','chinese','mixed','spelling','literal') -and $script:flowTest.cases[-1] -cne $failureAt) { throw 'SELFTEST_RETRY_AFTER_FAILURE' }
        }
        }
        $rejected = $false
        try { $null = Invoke-TrialFlow -Diagnostic } catch { if ($_.Exception.Message -ceq 'DIAGNOSTIC_REQUIRES_REUSE') { $rejected = $true } }
        if (-not $rejected) { throw 'SELFTEST_DIAGNOSTIC_REUSE_REQUIRED' }
    } finally {
        $script:personalToken = $null; $script:enabled = $false; $script:phase = 'precheck'
        Remove-Variable -Name flowTest -Scope Script -ErrorAction SilentlyContinue
    }
}

try {
    if ($DiagnosticOnce -and -not $ReuseExistingToken) { throw 'DIAGNOSTIC_REQUIRES_REUSE' }
    $script:nodePath = (Get-Command node -CommandType Application).Source
    if ($SelfTest) {
        # Fixed nonsecret sentinel: verifies stdin isolation plus stdout/stderr capture.
        $probe = @'
let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{console.error('PRIVATE_TEST_SENTINEL');console.log(JSON.stringify({stdin:s,argv:process.argv.slice(1),logs:process.env.WRANGLER_WRITE_LOGS,sanitize:process.env.WRANGLER_LOG_SANITIZE,metrics:process.env.WRANGLER_SEND_METRICS,account:process.env.CLOUDFLARE_ACCOUNT_ID}));});
'@
        $captured = @(Invoke-CapturedProcess -Executable $script:nodePath -Arguments @('-e', $probe) -InputText 'PRIVATE_TEST_SENTINEL')
        if ($captured.Count -ne 1) { throw 'SELFTEST_OUTPUT_LEAK' }
        $check = ConvertFrom-Json -InputObject $captured[0]
        if ($check.stdin -cne 'PRIVATE_TEST_SENTINEL' -or @($check.argv).Count -ne 0 -or
            $check.logs -cne 'false' -or $check.sanitize -cne 'true' -or $check.metrics -cne 'false' -or
            $check.account -cne $account) { throw 'SELFTEST_FAILED' }
        $rejected = $false
        try {
            $null = Invoke-CapturedProcess -Executable $script:nodePath -Arguments @('-e', "console.error('PRIVATE_TEST_SENTINEL');process.exit(9)") -InputText $null
        } catch { if ($_.Exception.Message -ceq 'CLI_FAILED') { $rejected = $true } else { throw } }
        if (-not $rejected) { throw 'SELFTEST_NONZERO_NOT_REJECTED' }
        Invoke-FlowSelfTest
        $known = ConvertFrom-Json '{"error":{"diagnostic":{"stage":"http","httpStatus":"401","azureCode":"401000","message":"DO_NOT_LEAK"}}}'
        if ((Write-SafeDiagnostic -Data $known) -cne 'SAFE_DIAGNOSTIC STAGE=http HTTP=401 AZURE=401000') { throw 'SELFTEST_DIAGNOSTIC_KNOWN' }
        $hostile = ConvertFrom-Json '{"error":{"diagnostic":{"stage":"transport DO_NOT_LEAK","httpStatus":"401 DO_NOT_LEAK","azureCode":{"private":"DO_NOT_LEAK"}}}}'
        if ((Write-SafeDiagnostic -Data $hostile) -cne 'SAFE_DIAGNOSTIC STAGE=OTHER HTTP=OTHER AZURE=OTHER') { throw 'SELFTEST_DIAGNOSTIC_LEAK' }
        if ((Write-SafeDiagnostic -Data $null) -cne 'SAFE_DIAGNOSTIC STAGE=OTHER HTTP=OTHER AZURE=OTHER') { throw 'SELFTEST_DIAGNOSTIC_MISSING' }
        Write-Output 'DIAGNOSTIC_FLOW_SELFTEST_OK MAX_ONE_NO_RETRY REUSE_REQUIRED ALWAYS_CLOSE ENUMS_ONLY'
        Write-Output 'REUSE_FLOW_SELFTEST_OK NO_GENERATION_NO_UPLOAD GATE_BEFORE_INPUT ROLLBACK_CONFIRMED MAX_FOUR_NO_RETRY'
        Write-Output 'SELFTEST_OK STDIN_ISOLATED OUTPUT_CAPTURED NONZERO_REJECTED NO_REMOTE_NO_TOKEN'
        exit 0
    }
    if (-not $IsWindows -or -not [Environment]::UserInteractive -or
        [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'PRIVATE_UI_UNAVAILABLE' }
    Add-Type -AssemblyName System.Windows.Forms
    # Verify an interactive form can be created before generating/uploading a token.
    $probeForm = [Windows.Forms.Form]::new(); $null = $probeForm.Handle; $probeForm.Dispose()
    $script:configPath = Join-Path $workerRoot 'wrangler.toml'
    $script:config = [IO.File]::ReadAllText($script:configPath)
    foreach ($pattern in @('(?m)^name = "bilingual-auditor-translation"\r?$',
        '(?m)^database_id = "003ed1e0-0471-40e3-b54e-a3d37e211440"\r?$',
        '(?m)^MONTHLY_CHARACTER_BUDGET = "1000000"\r?$', '(?m)^REQUESTS_PER_MINUTE = "6"\r?$',
        '(?m)^AZURE_TIER_CONFIRMED = ""\r?$', '(?m)^SAFE_UPSTREAM_DIAGNOSTICS = ""\r?$', '(?m)^\[observability\]\r?\nenabled = false\r?$')) {
        if ($config -notmatch $pattern) { throw 'LOCAL_CONFIG_GATE_FAILED' }
    }
    Invoke-TrialFlow -Reuse:$ReuseExistingToken -Diagnostic:$DiagnosticOnce
} catch {
    # An untrusted CLI/HTTP exception must never reach a console or PowerShell error stream.
        $script:failure = $true
        Write-Output "PRIVATE_TRIAL_STOPPED PHASE=$($script:phase) SAFE_FAILURE (no raw diagnostics)"
} finally {
    if (-not $ReuseExistingToken -and $script:secretAttempted -and $null -ne $script:personalToken) {
        try { Show-PrivateConfiguration } catch { $script:failure = $true; Write-Output 'PRIVATE_UI_FAILED NO_SECRET_OUTPUT' }
    }
    $script:personalToken = $null
}
if ($script:failure) { exit 1 }
