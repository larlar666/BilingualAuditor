#requires -Version 7.0
[CmdletBinding()]
param([switch]$SelfTest, [switch]$InitializeTrialSecrets, [switch]$ReuseExistingSecrets, [switch]$CnyAccountConfirmed)

# Never enable tracing/transcription or print ErrorRecord/CLI output/credential values.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'; $DebugPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue'
$workerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$worker = 'bilingual-auditor-deepseek-trial'
$account = 'd06ab0448a151f1907b09bf22da3649a'
$endpoint = 'https://bilingual-auditor-deepseek-trial.anrannarna.workers.dev/translate'
# Contract is deliberately pinned; never enable an arbitrary value returned by a file/response.
$guardName = 'DEEPSEEK_TRIAL_ENABLED'
$guardEnabledValue = 'CNY1_FOUR_FIXED_CASES_V1'
$script:personalToken = $null; $script:apiKey = $null
$script:phase = 'precheck'; $script:closeNeeded = $false; $script:failure = $false
$script:secretUploadComplete = $false

function Invoke-CapturedProcess {
    param([string]$Executable, [string[]]$Arguments, [AllowNull()][string]$InputText = $null)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable; $start.WorkingDirectory = $workerRoot
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($entry in @{
        CLOUDFLARE_ACCOUNT_ID=$account; CLOUDFLARE_API_BASE_URL='https://api.cloudflare.com/client/v4'; WRANGLER_WRITE_LOGS='false'; WRANGLER_LOG_SANITIZE='true';
        WRANGLER_SEND_METRICS='false'; WRANGLER_SEND_ERROR_REPORTS='false'; WRANGLER_LOG='log'; CI='true';
        HTTP_PROXY='http://127.0.0.1:7897'; HTTPS_PROXY='http://127.0.0.1:7897'; NO_PROXY='localhost,127.0.0.1,::1'
    }.GetEnumerator()) { $start.Environment[$entry.Key] = $entry.Value }
    $null = $start.Environment.Remove('WRANGLER_OUTPUT_FILE_PATH')
    $null = $start.Environment.Remove('WRANGLER_OUTPUT_FILE_DIRECTORY')
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    try {
        $null = $process.Start()
        $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
        if ($null -ne $InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(120000)) { $process.Kill($true); throw 'PROCESS_TIMEOUT' }
        $output = $outTask.GetAwaiter().GetResult(); $null = $errTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'CAPTURED_PROCESS_FAILED' }
        return $output
    } finally { $process.Dispose() }
}

function Invoke-Wrangler {
    param([string[]]$Command, [AllowNull()][string]$InputText = $null)
    return Invoke-CapturedProcess -Executable $script:nodePath -Arguments (@($script:wranglerPath) + $Command) -InputText $InputText
}

function Read-VerifiedContract {
    $raw = Invoke-CapturedProcess -Executable $script:nodePath -Arguments @('tools/read-trial-contract.mjs','--read')
    $contract = ConvertFrom-Json -InputObject $raw
    if ($contract.maxAttempts -ne 4 -or $contract.totalMicroCny -ne 1000000 -or
        $contract.reservationMicroCny -ne 250000 -or @($contract.cases).Count -ne 4 -or
        $contract.proofSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'TRIAL_PROOF_GATE_FAILED' }
    foreach ($case in $contract.cases) {
        if ($case.id -cnotmatch '^[a-z_]{1,24}$' -or $case.text -isnot [string] -or
            $case.requestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'TRIAL_PROOF_GATE_FAILED' }
    }
    return $contract
}

function Assert-ContractCurrent {
    param([string]$ExpectedHash)
    $current=Read-VerifiedContract
    if ($current.proofSha256 -cne $ExpectedHash) { throw 'TRIAL_PROOF_CHANGED' }
}

function Get-ProductionVersion {
    $raw = Invoke-Wrangler -Command @('deployments','status','--json','--name',$worker)
    $deployment = ConvertFrom-Json -InputObject $raw
    if (@($deployment.versions).Count -ne 1 -or $deployment.versions[0].percentage -ne 100 -or
        $deployment.versions[0].version_id -cnotmatch '^[a-f0-9-]{36}$') { throw 'PRODUCTION_NOT_SINGLE_VERSION' }
    return [string]$deployment.versions[0].version_id
}

function Assert-ProductionState {
    param([string]$Version, [ValidateSet('closed','enabled')][string]$Guard = 'closed',
        [switch]$RequireSecrets, [switch]$RejectSecrets)
    $raw = Invoke-Wrangler -Command @('versions','view',$Version,'--json','--name',$worker)
    $metadata = ConvertFrom-Json -InputObject $raw
    $bindings = @($metadata.resources.bindings)
    $guards = @($bindings | Where-Object { $_.name -ceq $guardName })
    $expected = ''; if ($Guard -ceq 'enabled') { $expected = $guardEnabledValue }
    if ($guards.Count -ne 1 -or $guards[0].type -cne 'plain_text' -or $guards[0].text -cne $expected) { throw 'TRIAL_GUARD_STATE_FAILED' }
    $db = @($bindings | Where-Object { $_.name -ceq 'DB' })
    if ($db.Count -ne 1 -or $db[0].type -cne 'd1' -or $db[0].id -cne $script:databaseId) { throw 'TRIAL_DB_GATE_FAILED' }
    # Inspect only name/type for secret bindings, never their values.
    foreach ($name in @('ACCESS_TOKEN','DEEPSEEK_API_KEY')) {
        $matches = @($bindings | Where-Object { $_.name -ceq $name } | ForEach-Object { [pscustomobject]@{ Name=[string]$_.name; Type=[string]$_.type } })
        if ($RejectSecrets -and $matches.Count -ne 0) { throw 'EXISTING_SECRET_REQUIRES_EXPLICIT_REUSE' }
        if ($RequireSecrets -and $matches.Count -ne 1) { throw 'SECRET_TYPE_GATE_FAILED' }
        if ($matches.Count -gt 1 -or ($matches.Count -eq 1 -and $matches[0].Type -cne 'secret_text')) { throw 'SECRET_TYPE_GATE_FAILED' }
    }
}

function Read-PrivateCredentials {
    param([switch]$IncludeApiKey)
    $form = [Windows.Forms.Form]::new(); $timer = [Windows.Forms.Timer]::new()
    $personal = [Windows.Forms.TextBox]::new(); $key = [Windows.Forms.TextBox]::new()
    try {
        $form.Text = 'DeepSeek 短合成试验：本机私密输入（请勿截图）'
        $form.Width = 760; $form.Height = 330; $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
        $label = [Windows.Forms.Label]::new(); $label.SetBounds(16,12,710,68)
        $label.Text = "仅用于 $worker。复用已保存的本人访问凭证，不生成新凭证。最多四个固定短合成样本、总预留不超过 ¥1，结束关闭。取消或五分钟超时停止。"
        $personalLabel = [Windows.Forms.Label]::new(); $personalLabel.SetBounds(16,84,710,22); $personalLabel.Text = '已保存的本人访问凭证（不是 Azure Key）'
        $personal.SetBounds(16,109,710,26); $personal.UseSystemPasswordChar=$true; $personal.MaxLength=256
        $keyLabel = [Windows.Forms.Label]::new(); $keyLabel.SetBounds(16,147,710,22)
        $keyLabel.Text = 'DeepSeek 官方 API Key（仅上传本 Worker 的加密 Secret）'
        $key.SetBounds(16,172,710,26); $key.UseSystemPasswordChar=$true; $key.MaxLength=512
        $keyLabel.Visible=[bool]$IncludeApiKey; $key.Visible=[bool]$IncludeApiKey
        $ok = [Windows.Forms.Button]::new(); $ok.SetBounds(400,224,200,34)
        $ok.Text = '继续已批准试验'; if ($IncludeApiKey) { $ok.Text='上传加密 Secret 并继续' }
        $ok.DialogResult=[Windows.Forms.DialogResult]::OK
        $cancel = [Windows.Forms.Button]::new(); $cancel.SetBounds(616,224,110,34); $cancel.Text='取消'; $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel
        $form.Controls.AddRange(@($label,$personalLabel,$personal,$keyLabel,$key,$ok,$cancel)); $form.AcceptButton=$ok; $form.CancelButton=$cancel
        $timer.Interval=300000; $timer.Add_Tick({ $form.DialogResult=[Windows.Forms.DialogResult]::Cancel; $form.Close() })
        $form.Add_Shown({ $timer.Start(); Write-Output 'DEEPSEEK_PRIVATE_INPUT_READY' | Out-Host })
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'PRIVATE_INPUT_CANCELLED' }
        if ($personal.Text -cnotmatch '^[A-Za-z0-9_-]{32,256}$') { throw 'PERSONAL_TOKEN_FORMAT_FAILED' }
        if ($IncludeApiKey -and $key.Text -cnotmatch '^[\x21-\x7E]{16,512}$') { throw 'API_KEY_FORMAT_FAILED' }
        $script:personalToken=$personal.Text
        if ($IncludeApiKey) { $script:apiKey=$key.Text }
    } finally { $timer.Stop(); $timer.Dispose(); $personal.Clear(); $key.Clear(); $form.Dispose() }
}

function Upload-InitialSecrets {
    # Values go only to stdin of this fixed CLI command, never argv/environment/files.
    $script:phase='secret_upload'; $script:closeNeeded=$true
    $null = Invoke-Wrangler -Command @('secret','put','ACCESS_TOKEN','--name',$worker) -InputText $script:personalToken
    $null = Invoke-Wrangler -Command @('secret','put','DEEPSEEK_API_KEY','--name',$worker) -InputText $script:apiKey
    $script:apiKey=$null; $script:secretUploadComplete=$true
    $version=Get-ProductionVersion; Assert-ProductionState -Version $version -RequireSecrets
    Write-Output "SECRET_TYPES=OK VERSION=$version"
}

function Set-TrialGuard {
    param([switch]$Enable)
    $content=$script:config
    if ($Enable) { $content=$content.Replace('DEEPSEEK_TRIAL_ENABLED = ""', "DEEPSEEK_TRIAL_ENABLED = `"$guardEnabledValue`"") }
    [IO.File]::WriteAllText($script:configPath,$content,[Text.UTF8Encoding]::new($false))
    $null=Invoke-Wrangler -Command @('deploy','--name',$worker)
}

function Invoke-SyntheticCase {
    param([string]$Name,[string]$Text,[switch]$Unauthorized)
    $requestId=[guid]::NewGuid().ToString(); $response=$null
    $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post,$endpoint)
    $deadline=[Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(60))
    try {
        if (-not $Unauthorized) { $request.Headers.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$script:personalToken) }
        $request.Content=[Net.Http.StringContent]::new((@{text=$Text;requestId=$requestId}|ConvertTo-Json -Compress),[Text.Encoding]::UTF8,'application/json')
        $response=$script:http.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$deadline.Token).GetAwaiter().GetResult()
        $status=[int]$response.StatusCode
        if ($response.Content.Headers.ContentLength -gt 1000000) { throw 'RESPONSE_TOO_LARGE' }
        $stream=$response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult(); $memory=[IO.MemoryStream]::new()
        try {
            $buffer=[byte[]]::new(8192)
            while ($true) {
                $count=$stream.ReadAsync($buffer,0,$buffer.Length,$deadline.Token).GetAwaiter().GetResult()
                if ($count -eq 0) { break }
                if ($memory.Length+$count -gt 1000000) { throw 'RESPONSE_TOO_LARGE' }
                $memory.Write($buffer,0,$count)
            }
            $data=ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($memory.ToArray()))
        } finally { $stream.Dispose(); $memory.Dispose() }
        $code='OK'
        if ($status -ne 200) {
            $code='UNRECOGNIZED_ERROR'
            $allowed=@('INVALID_REQUEST','TEXT_TOO_LONG','UNAUTHORIZED','QUOTA_EXCEEDED','RATE_LIMITED','SERVICE_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_ERROR','PRESERVATION_FAILED','TRIAL_ONLY','TRIAL_SAMPLE_NOT_ALLOWED','TRIAL_EXHAUSTED')
            if ($null -ne $data.PSObject.Properties['error'] -and $null -ne $data.error.PSObject.Properties['code'] -and $data.error.code -cin $allowed) { $code=[string]$data.error.code }
        }
        # Name is from the verified fixed fixture contract, code is a fixed allowlist constant.
        Write-Output "CASE=$Name STATUS=$status CODE=$code"
        if ($Unauthorized) {
            if ($status -ne 401 -or $code -cne 'UNAUTHORIZED') { throw 'UNAUTHORIZED_GATE_FAILED' }
            return
        }
        if ($status -ne 200 -or $data.requestId -cne $requestId -or $data.translation -isnot [string] -or
            -not $data.translation.Trim() -or $data.translation.Length -gt 20000) { throw 'SYNTHETIC_CASE_FAILED' }
        if ($data.translation.Contains($script:personalToken,[StringComparison]::Ordinal)) { throw 'RESPONSE_CONTRACT_FAILED' }
        # Do not print generated text: all reporting remains fixed statuses.
        Write-Output "CASE=$Name RESPONSE_CONTRACT=OK"
    } finally { if ($null -ne $response) { $response.Dispose() }; $deadline.Dispose(); $request.Dispose() }
}

function Invoke-TrialFlow {
    param([switch]$Initialize,[switch]$Reuse,[switch]$CnyConfirmed)
    if (-not $CnyConfirmed) { throw 'CNY_ACCOUNT_CONFIRMATION_REQUIRED' }
    if ([bool]$Initialize -eq [bool]$Reuse) { throw 'EXPLICIT_SECRET_MODE_REQUIRED' }
    $script:closeNeeded=$false; $script:secretUploadComplete=$false
    try {
        # Fail BEFORE metadata mutation/UI/Secret upload if the real proof is absent/stale.
        $script:phase='proof'; $contract=Read-VerifiedContract
        $script:phase='precheck'; $version=Get-ProductionVersion
        if ($Initialize) { Assert-ProductionState -Version $version -RejectSecrets }
        else { Assert-ProductionState -Version $version -RequireSecrets; $script:secretUploadComplete=$true }
        Write-Output "PRECHECK_VERSION=$version PROOF=OK FIXED_TOTAL_CNY=1 MAX_FOUR_NO_RETRY"
        if ($Initialize) {
            Assert-ContractCurrent -ExpectedHash $contract.proofSha256
            Read-PrivateCredentials -IncludeApiKey
            Assert-ContractCurrent -ExpectedHash $contract.proofSha256
            Upload-InitialSecrets
        }
        # Recheck exact full request hashes after any user interaction and before enable.
        Assert-ContractCurrent -ExpectedHash $contract.proofSha256
        $script:phase='guard_deploy'; $script:closeNeeded=$true; Set-TrialGuard -Enable
        $version=Get-ProductionVersion; Assert-ProductionState -Version $version -Guard enabled -RequireSecrets
        Write-Output "ENABLED_VERSION=$version"
        $handler=[Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect=$false
        $script:http=[Net.Http.HttpClient]::new($handler); $script:http.Timeout=[TimeSpan]::FromSeconds(60)
        try {
            $script:phase='unauthorized'; Invoke-SyntheticCase -Name unauthorized -Text $contract.cases[0].text -Unauthorized
            if ($Reuse) {
                Assert-ContractCurrent -ExpectedHash $contract.proofSha256
                $script:phase='private_input'; Read-PrivateCredentials
            }
            $script:phase='synthetic_tests'
            foreach ($case in $contract.cases) {
                Assert-ContractCurrent -ExpectedHash $contract.proofSha256
                Invoke-SyntheticCase -Name $case.id -Text $case.text
            }
        } finally { $script:http.Dispose() }
    } finally {
        if ($script:closeNeeded) {
            try {
                $closingFrom=$script:phase; $script:phase='close'; Set-TrialGuard
                $version=Get-ProductionVersion; Assert-ProductionState -Version $version -RequireSecrets:$script:secretUploadComplete
                Write-Output "TRIAL_CLOSED_VERSION=$version PRODUCTION=100 GUARD=CLOSED"
                $script:closeNeeded=$false; $script:phase=$closingFrom
            } catch { Write-Output 'TRIAL_CLOSE_UNCONFIRMED MANUAL_CHECK_REQUIRED'; throw 'TRIAL_CLOSE_FAILED' }
        }
    }
}

function Invoke-FlowSelfTest {
    function Read-VerifiedContract {
        if ($script:test.fail -ceq 'proof') { throw 'MISSING_REAL_PROOF' }
        if (($script:test.fail -ceq 'proof_after_input' -and $script:test.input -gt 0) -or
            ($script:test.fail -ceq 'proof_before_second' -and $script:test.paid -gt 0)) { throw 'EXPIRED_PROOF' }
        $proofHash=('a'*64)
        if ($script:test.fail -ceq 'proof_changed_after_input' -and $script:test.input -gt 0) { $proofHash=('b'*64) }
        return [pscustomobject]@{ proofSha256=$proofHash; cases=@(
            [pscustomobject]@{id='chinese';text='合成中文'},[pscustomobject]@{id='mixed';text='合成 API'},
            [pscustomobject]@{id='spelling';text='合成 I has a apple.'},[pscustomobject]@{id='literal';text='合成 URL'}) }
    }
    function Get-ProductionVersion { return '00000000-0000-0000-0000-000000000000' }
    function Assert-ProductionState {
        param($Version,$Guard,[switch]$RequireSecrets,[switch]$RejectSecrets)
        if ($script:test.fail -ceq 'existing' -and $RejectSecrets) { throw 'EXISTING_SECRET_REQUIRES_EXPLICIT_REUSE' }
        if ($script:test.fail -ceq 'confirm_close' -and $script:test.close -gt 0) { throw 'CLOSE_CONFIRM_FAILED' }
        if ($Guard -ceq 'enabled') { $script:test.confirmEnabled++ } else { $script:test.confirmClosed++ }
    }
    function Read-PrivateCredentials {
        param([switch]$IncludeApiKey)
        $script:test.input++; $script:test.events.Add('input')
        if ($script:test.fail -ceq 'input') { throw 'PRIVATE_INPUT_CANCELLED' }
        $script:personalToken='SELFTEST_FIXED_NONSECRET_SENTINEL_0000'
        if ($IncludeApiKey) { $script:apiKey='SELFTEST_FIXED_NONSECRET_API_KEY' }
    }
    function Upload-InitialSecrets {
        $script:closeNeeded=$true; $script:test.upload++
        if ($script:test.fail -ceq 'upload') { throw 'UPLOAD_FAILED' }
        $script:secretUploadComplete=$true
    }
    function Set-TrialGuard {
        param([switch]$Enable)
        if ($Enable) { $script:test.open++; if ($script:test.fail -ceq 'deploy') { throw 'DEPLOY_FAILED' } }
        else { $script:test.close++; if ($script:test.fail -ceq 'close') { throw 'CLOSE_DEPLOY_FAILED' } }
    }
    function Invoke-SyntheticCase {
        param($Name,$Text,[switch]$Unauthorized)
        $script:test.events.Add([string]$Name)
        if (-not $Unauthorized) { $script:test.paid++ }
        if ($script:test.fail -ceq $Name) { throw 'CASE_FAILED' }
    }
    function Invoke-Wrangler { throw 'SELFTEST_REAL_CLI_FORBIDDEN' }
    foreach ($reuse in @($false,$true)) {
        $failures=@('','proof','existing','input','proof_after_input','proof_changed_after_input','proof_before_second','deploy','unauthorized','chinese','mixed','spelling','literal','close','confirm_close')
        if (-not $reuse) { $failures+='upload' }
        foreach ($failure in $failures) {
            if ($reuse -and $failure -ceq 'existing') { continue }
            $script:test=@{fail=$failure;input=0;upload=0;open=0;close=0;paid=0;confirmEnabled=0;confirmClosed=0;events=[Collections.Generic.List[string]]::new()}
            $script:closeNeeded=$false; $script:secretUploadComplete=$false; $caught=$false
            try { $null=Invoke-TrialFlow -Initialize:(-not $reuse) -Reuse:$reuse -CnyConfirmed } catch { $caught=$true }
            if ($caught -ne [bool]$failure -or $script:test.paid -gt 4) { throw 'SELFTEST_FLOW_FAILED' }
            if ($failure -in @('proof','existing')) {
                if ($script:test.input -ne 0 -or $script:test.upload -ne 0 -or $script:test.open -ne 0 -or $script:test.paid -ne 0) { throw 'SELFTEST_PRECHECK_SIDE_EFFECT' }
            } elseif (-not $reuse -and $failure -ceq 'input') {
                if ($script:test.upload -ne 0 -or $script:test.open -ne 0 -or $script:test.paid -ne 0) { throw 'SELFTEST_CANCEL_MUTATED' }
            } elseif (-not $reuse -and $failure -in @('proof_after_input','proof_changed_after_input')) {
                if ($script:test.upload -ne 0 -or $script:test.open -ne 0 -or $script:test.paid -ne 0) { throw 'SELFTEST_EXPIRED_PROOF_MUTATED' }
            } elseif ($failure -in @('close','confirm_close')) {
                if ($script:test.close -ne 1 -or -not $script:closeNeeded -or $script:test.paid -ne 4) { throw 'SELFTEST_CLOSE_FAILURE_NOT_REPORTED' }
            } else {
                if ($script:test.close -ne 1 -or $script:closeNeeded) { throw 'SELFTEST_CLOSE_FAILED' }
            }
            if (-not $failure -and ($script:test.paid -ne 4 -or $script:test.open -ne 1)) { throw 'SELFTEST_MAXIMUM_FAILED' }
            if ($reuse -and $failure -notin @('proof','deploy','unauthorized') -and
                $script:test.events.IndexOf('input') -le $script:test.events.IndexOf('unauthorized')) { throw 'SELFTEST_INPUT_BEFORE_401' }
            if ($reuse -and $script:test.upload -ne 0) { throw 'SELFTEST_REUSE_UPLOADED' }
            if ($failure -ceq 'proof_before_second' -and $script:test.paid -ne 1) { throw 'SELFTEST_EXPIRED_PROOF_RETRIED' }
            if ($failure -in @('chinese','mixed','spelling','literal') -and $script:test.events[-1] -cne $failure) { throw 'SELFTEST_RETRIED' }
        }
    }
    $rejected=0
    foreach ($both in @($false,$true)) { try { $null=Invoke-TrialFlow -Initialize:$both -Reuse:$both -CnyConfirmed } catch { $rejected++ } }
    if ($rejected -ne 2) { throw 'SELFTEST_EXPLICIT_MODE_FAILED' }
    $currencyRejected=$false
    try { $null=Invoke-TrialFlow -Reuse } catch { if ($_.Exception.Message -ceq 'CNY_ACCOUNT_CONFIRMATION_REQUIRED') { $currencyRejected=$true } }
    if (-not $currencyRejected) { throw 'SELFTEST_CURRENCY_CONFIRMATION_FAILED' }
    Remove-Variable test -Scope Script
    $script:personalToken=$null; $script:apiKey=$null; $script:phase='precheck'
}

function Invoke-UploadSelfTest {
    function Invoke-Wrangler {
        param([string[]]$Command,[AllowNull()][string]$InputText)
        if ($Command.Count -ne 5 -or $Command[0] -cne 'secret' -or $Command[1] -cne 'put' -or
            $Command[3] -cne '--name' -or $Command[4] -cne $worker) { throw 'SELFTEST_UPLOAD_TARGET' }
        if ($Command[2] -ceq 'ACCESS_TOKEN' -and $InputText -ceq 'SELFTEST_FIXED_NONSECRET_SENTINEL_0000') { $script:uploadTest.personal++ }
        elseif ($Command[2] -ceq 'DEEPSEEK_API_KEY' -and $InputText -ceq 'SELFTEST_FIXED_NONSECRET_API_KEY') { $script:uploadTest.api++ }
        else { throw 'SELFTEST_UPLOAD_STDIN' }
        if ($Command -ccontains $InputText) { throw 'SELFTEST_UPLOAD_ARGV_LEAK' }
        return ''
    }
    function Get-ProductionVersion { return '00000000-0000-0000-0000-000000000000' }
    function Assert-ProductionState { param($Version,[switch]$RequireSecrets) if (-not $RequireSecrets) { throw 'SELFTEST_UPLOAD_CONFIRM' } }
    $script:uploadTest=@{personal=0;api=0}; $script:personalToken='SELFTEST_FIXED_NONSECRET_SENTINEL_0000'; $script:apiKey='SELFTEST_FIXED_NONSECRET_API_KEY'
    try {
        $null=Upload-InitialSecrets
        if ($script:uploadTest.personal -ne 1 -or $script:uploadTest.api -ne 1 -or $null -ne $script:apiKey -or -not $script:secretUploadComplete) { throw 'SELFTEST_UPLOAD_FAILED' }
    } finally {
        Remove-Variable uploadTest -Scope Script
        $script:personalToken=$null; $script:apiKey=$null; $script:closeNeeded=$false; $script:phase='precheck'
    }
}

try {
    if (-not $SelfTest -and ([bool]$InitializeTrialSecrets -eq [bool]$ReuseExistingSecrets)) { throw 'EXPLICIT_SECRET_MODE_REQUIRED' }
    if (-not $SelfTest -and -not $CnyAccountConfirmed) { $script:phase='currency_confirmation'; throw 'CNY_ACCOUNT_CONFIRMATION_REQUIRED' }
    $script:nodePath=(Get-Command node -CommandType Application).Source
    if ($SelfTest) {
        $sentinel='SELFTEST_FIXED_NONSECRET_SENTINEL'
        $probe="let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{console.error('DO_NOT_LEAK');console.log(JSON.stringify({stdin:s,args:process.argv.slice(1),logs:process.env.WRANGLER_WRITE_LOGS,metrics:process.env.WRANGLER_SEND_METRICS,reports:process.env.WRANGLER_SEND_ERROR_REPORTS}));});"
        $captured=@(Invoke-CapturedProcess -Executable $script:nodePath -Arguments @('-e',$probe) -InputText $sentinel)
        if ($captured.Count -ne 1) { throw 'SELFTEST_CAPTURE_LEAK' }
        $check=ConvertFrom-Json -InputObject $captured[0]
        if ($check.stdin -cne $sentinel -or @($check.args).Count -ne 0 -or $check.logs -cne 'false' -or $check.metrics -cne 'false' -or $check.reports -cne 'false') { throw 'SELFTEST_STDIN_FAILED' }
        $failed=$false
        try { $null=Invoke-CapturedProcess -Executable $script:nodePath -Arguments @('-e',"console.error('DO_NOT_LEAK');process.exit(7)") } catch { $failed=$true }
        if (-not $failed) { throw 'SELFTEST_NONZERO_ACCEPTED' }
        Invoke-UploadSelfTest
        Invoke-FlowSelfTest
        Write-Output 'DEEPSEEK_PRIVATE_TOOL_SELFTEST_OK NO_GENERATION STDIN_ONLY CAPTURED_OUTPUT EXPLICIT_REUSE PROOF_BEFORE_MUTATION MAX_FOUR_NO_RETRY ALWAYS_CLOSE NO_REMOTE_NO_GUI'
    } else {
        if (-not $IsWindows -or -not [Environment]::UserInteractive -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'PRIVATE_UI_UNAVAILABLE' }
        # Must have the verified proof before any UI or remote request.
        $script:phase='proof'; $null=Read-VerifiedContract
        Add-Type -AssemblyName System.Windows.Forms
        $script:wranglerPath=[IO.Path]::GetFullPath((Join-Path $workerRoot '../translation-worker/node_modules/wrangler/bin/wrangler.js'))
        if (-not [IO.File]::Exists($script:wranglerPath)) { throw 'PINNED_WRANGLER_MISSING' }
        $packagePath=[IO.Path]::GetFullPath((Join-Path $workerRoot '../translation-worker/node_modules/wrangler/package.json'))
        $package=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($packagePath))
        if ($package.version -cne '4.158.0') { throw 'PINNED_WRANGLER_VERSION_MISMATCH' }
        $script:configPath=Join-Path $workerRoot 'wrangler.toml'; $script:config=[IO.File]::ReadAllText($script:configPath)
        foreach ($pattern in @('(?m)^name = "bilingual-auditor-deepseek-trial"\r?$','(?m)^DEEPSEEK_TRIAL_ENABLED = ""\r?$','(?m)^\[observability\]\r?\nenabled = false\r?$','(?m)^database_name = "bilingual-auditor-deepseek-trial-budget"\r?$')) {
            if ($script:config -notmatch $pattern) { throw 'LOCAL_CONFIG_GATE_FAILED' }
        }
        $matches=[regex]::Matches($script:config,'(?m)^database_id = "([a-f0-9-]{36})"\r?$')
        if ($matches.Count -ne 1) { throw 'LOCAL_DB_GATE_FAILED' }
        $script:databaseId=$matches[0].Groups[1].Value
        if ($script:databaseId -ceq '00000000-0000-0000-0000-000000000000' -or $script:databaseId -ceq '003ed1e0-0471-40e3-b54e-a3d37e211440') { throw 'INDEPENDENT_DB_REQUIRED' }
        Invoke-TrialFlow -Initialize:$InitializeTrialSecrets -Reuse:$ReuseExistingSecrets -CnyConfirmed:$CnyAccountConfirmed
    }
} catch {
    $script:failure=$true
    Write-Output "DEEPSEEK_PRIVATE_TRIAL_STOPPED PHASE=$($script:phase) SAFE_FAILURE"
} finally { $script:personalToken=$null; $script:apiKey=$null }
if ($script:failure) { exit 1 }
