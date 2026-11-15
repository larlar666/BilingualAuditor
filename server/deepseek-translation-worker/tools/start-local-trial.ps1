#requires -Version 7.0
[CmdletBinding()]
param([switch]$SelfTest, [switch]$RunTrial, [switch]$CnyAccountConfirmed, [switch]$InitializeLocalLedger)

# Never enable tracing/transcription or print a raw child stream/ErrorRecord.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue'
$script:workerRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:apiKey=$null; $script:phase='mode'; $script:failed=$false; $script:runStarted=$false
$script:caseIds=@('chinese','mixed','spelling','literal')
$script:authority='LOCAL_SQLITE_V1'; $script:nodePath=$null

function Assert-ApiKey {
    param([AllowNull()][string]$Key)
    if ([string]::IsNullOrEmpty($Key) -or $Key.Length -gt 512 -or $Key -cmatch '[^\x21-\x7e]') { throw 'API_KEY_FORMAT_FAILED' }
    $probe=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post,'https://api.deepseek.com/chat/completions')
    try { $probe.Headers.Add('Authorization',"Bearer $Key") } finally { $probe.Dispose() }
}

function Read-LocalApiKey {
    $form=[Windows.Forms.Form]::new(); $box=[Windows.Forms.TextBox]::new(); $timer=[Windows.Forms.Timer]::new()
    try {
        $form.Text='DeepSeek 本机直连试验（请勿截图）'; $form.Width=780; $form.Height=300
        $form.StartPosition='CenterScreen'; $form.TopMost=$true
        $label=[Windows.Forms.Label]::new(); $label.SetBounds(16,12,730,120)
        $label.Text="请输入 DeepSeek 官方开放平台的 API Key。这里不需要 Azure Key 或个人访问凭证。`r`nKey 只在本机进程内使用，不上传 Cloudflare。仅固定短合成文本，最多四次、总预留 ¥1；首错停止、不重试。`r`n预算账本保留累计记录，不能因重开窗口而重置。取消或五分钟超时不发模型请求。"
        $box.SetBounds(16,138,730,28); $box.UseSystemPasswordChar=$true; $box.MaxLength=512
        $ok=[Windows.Forms.Button]::new(); $ok.SetBounds(425,192,190,34); $ok.Text='开始已批准的本机试验'; $ok.DialogResult=[Windows.Forms.DialogResult]::OK
        $cancel=[Windows.Forms.Button]::new(); $cancel.SetBounds(630,192,116,34); $cancel.Text='取消'; $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel
        $form.Controls.AddRange(@($label,$box,$ok,$cancel)); $form.AcceptButton=$ok; $form.CancelButton=$cancel
        $timer.Interval=300000; $timer.Add_Tick({ $form.DialogResult=[Windows.Forms.DialogResult]::Cancel; $form.Close() })
        $form.Add_Shown({ $timer.Start(); Write-Output 'DEEPSEEK_LOCAL_KEY_INPUT_READY' | Out-Host })
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'KEY_INPUT_CANCELLED' }
        Assert-ApiKey -Key $box.Text
        $script:apiKey=$box.Text
    } finally { $timer.Stop(); $timer.Dispose(); $box.Clear(); $form.Dispose() }
}

function Assert-Fields {
    param([Collections.IDictionary]$Frame,[string[]]$Required,[string[]]$Optional=@())
    foreach ($name in $Required) { if (-not $Frame.Contains($name)) { throw 'LOCAL_PROTOCOL_FAILED' } }
    foreach ($name in $Frame.Keys) { if ($name -cnotin ($Required+$Optional)) { throw 'LOCAL_PROTOCOL_FAILED' } }
}
function Test-IntegerRange {
    param($Value,[long]$Minimum,[long]$Maximum)
    return ($Value -is [int] -or $Value -is [long]) -and $Value -ge $Minimum -and $Value -le $Maximum
}
function Convert-SafeFrame {
    param([string]$Line)
    if ($Line.Length -gt 100000 -or -not $Line.Trim()) { throw 'LOCAL_PROTOCOL_FAILED' }
    $frame=ConvertFrom-Json -InputObject $Line -AsHashtable -Depth 8
    if ($frame -isnot [Collections.IDictionary] -or $frame['event'] -isnot [string]) { throw 'LOCAL_PROTOCOL_FAILED' }
    return $frame
}
function Assert-CheckFrame {
    param([Collections.IDictionary]$Frame)
    Assert-Fields $Frame @('event','executionAuthority','attempts','reservedMicroCny','sampleMask','remainingCaseIds','ledgerInitialized','proofSha256','ledgerId')
    if ($Frame['event'] -cne 'LOCAL_TRIAL_CHECK_OK' -or $Frame['executionAuthority'] -cne $script:authority -or
        -not (Test-IntegerRange $Frame['attempts'] 0 4) -or
        -not (Test-IntegerRange $Frame['reservedMicroCny'] 0 1000000) -or
        $Frame['reservedMicroCny'] -ne $Frame['attempts']*250000 -or
        -not (Test-IntegerRange $Frame['sampleMask'] 0 15) -or $Frame['ledgerInitialized'] -isnot [bool] -or
        $Frame['proofSha256'] -isnot [string] -or $Frame['proofSha256'] -cnotmatch '^[a-f0-9]{64}$' -or
        $Frame['ledgerId'] -isnot [string] -or $Frame['ledgerId'] -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or
        $Frame['remainingCaseIds'] -isnot [Array]) { throw 'LOCAL_CHECK_FAILED' }
    $ids=@($Frame['remainingCaseIds'])
    if ($ids.Count -ne 4-$Frame['attempts'] -or (@($ids|Select-Object -Unique)).Count -ne $ids.Count) { throw 'LOCAL_CHECK_FAILED' }
    $last=-1
    foreach ($id in $ids) {
        if ($id -isnot [string] -or $id -cnotin $script:caseIds) { throw 'LOCAL_CHECK_FAILED' }
        $index=[Array]::IndexOf($script:caseIds,$id)
        if ($index -le $last) { throw 'LOCAL_CHECK_FAILED' }; $last=$index
    }
    for ($i=0; $i -lt 4; $i++) {
        if ((($Frame['sampleMask'] -band (1 -shl $i)) -eq 0) -ne ($script:caseIds[$i] -cin $ids)) { throw 'LOCAL_CHECK_FAILED' }
    }
}
function Assert-SnapshotUnchanged {
    param([Collections.IDictionary]$Before,[Collections.IDictionary]$After)
    Assert-CheckFrame $Before; Assert-CheckFrame $After
    foreach ($name in @('proofSha256','ledgerId','attempts','reservedMicroCny','sampleMask')) {
        if ($Before[$name] -cne $After[$name]) { throw 'LOCAL_STATE_CHANGED' }
    }
    if ((@($Before['remainingCaseIds']) -join ',') -cne (@($After['remainingCaseIds']) -join ',')) { throw 'LOCAL_STATE_CHANGED' }
}

function New-NodeStartInfo {
    param([ValidateSet('check','run')][string]$Mode,[switch]$Initialize)
    $start=[Diagnostics.ProcessStartInfo]::new(); $start.FileName=$script:nodePath; $start.WorkingDirectory=$script:workerRoot
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    foreach ($argument in @('--use-env-proxy','tools/run-local-trial.mjs',"--$Mode",'--cny-account-confirmed')) { $start.ArgumentList.Add($argument) }
    if ($Initialize) {
        if ($Mode -cne 'check') { throw 'INITIALIZE_REQUIRES_CHECK' }
        $start.ArgumentList.Add('--initialize-ledger')
    }
    foreach ($name in @('DEEPSEEK_API_KEY','AZURE_TRANSLATOR_KEY','AZURE_API_KEY','OPENAI_API_KEY','CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY',
        'NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','WRANGLER_OUTPUT_FILE_PATH','WRANGLER_OUTPUT_FILE_DIRECTORY')) { $null=$start.Environment.Remove($name) }
    $start.Environment['HTTP_PROXY']='http://127.0.0.1:7897'; $start.Environment['HTTPS_PROXY']='http://127.0.0.1:7897'
    $start.Environment['NO_PROXY']='localhost,127.0.0.1,::1'
    return $start
}

function Invoke-LocalNode {
    param([ValidateSet('check','run')][string]$Mode,[switch]$Initialize,[AllowNull()][string]$InputText=$null,
        [Collections.IDictionary]$Snapshot=$null)
    $process=[Diagnostics.Process]::new(); $process.StartInfo=New-NodeStartInfo -Mode $Mode -Initialize:$Initialize
    $clock=[Diagnostics.Stopwatch]::StartNew(); $limit=30000; if ($Mode -ceq 'run') { $limit=240000 }
    $checkFrame=$null; $terminal=$null; $seen=[Collections.Generic.List[string]]::new(); $totalCharacters=0; $caseFailed=$false
    try {
        $null=$process.Start()
        # Drain stderr without retaining, displaying, or logging arbitrary child exceptions.
        $errorDrain=$process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if ($null -ne $InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        $read=$process.StandardOutput.ReadLineAsync()
        while ($true) {
            if ($clock.ElapsedMilliseconds -gt $limit) { throw 'LOCAL_PROCESS_TIMEOUT' }
            if (-not $read.Wait(100)) { continue }
            $line=$read.GetAwaiter().GetResult()
            if ($null -eq $line) { break }
            $totalCharacters+=$line.Length
            if ($totalCharacters -gt 400000) { throw 'LOCAL_PROTOCOL_FAILED' }
            $frame=Convert-SafeFrame $line
            if ($Mode -ceq 'check') {
                if ($null -ne $checkFrame) { throw 'LOCAL_PROTOCOL_FAILED' }
                Assert-CheckFrame $frame; $checkFrame=$frame
            } else {
                if ($null -ne $terminal) { throw 'LOCAL_PROTOCOL_FAILED' }
                if ($frame['event'] -ceq 'LOCAL_TRIAL_CASE') {
                    if ($caseFailed) { throw 'LOCAL_FIRST_FAILURE_STOP_REQUIRED' }
                    Assert-CaseFrame -Frame $frame -Snapshot $Snapshot -Seen $seen
                    Write-SafeCase -Frame $frame
                    if ($frame['status'] -ne 200) { $caseFailed=$true }
                } else {
                    if ($caseFailed -and $frame['event'] -ceq 'LOCAL_TRIAL_COMPLETE') { throw 'LOCAL_FIRST_FAILURE_STOP_REQUIRED' }
                    Assert-TerminalFrame -Frame $frame -Snapshot $Snapshot -Seen $seen
                    Write-SafeTerminal -Frame $frame
                    $terminal=$frame
                }
            }
            $line=$null; $frame=$null; $read=$process.StandardOutput.ReadLineAsync()
        }
        $remaining=[Math]::Max(1,$limit-[int]$clock.ElapsedMilliseconds)
        if (-not $process.WaitForExit($remaining)) { throw 'LOCAL_PROCESS_TIMEOUT' }
        $null = $errorDrain.GetAwaiter().GetResult()
        if ($Mode -ceq 'check') {
            if ($process.ExitCode -ne 0 -or $null -eq $checkFrame) { throw 'LOCAL_PREFLIGHT_FAILED' }
            return $checkFrame
        }
        if ($null -eq $terminal) { throw 'LOCAL_TERMINAL_MISSING' }
        if ($process.ExitCode -ne 0 -or $terminal['event'] -cne 'LOCAL_TRIAL_COMPLETE') { throw 'LOCAL_TRIAL_STOPPED' }
        Write-Output 'DEEPSEEK_LOCAL_TRIAL_COMPLETE NO_KEY_STORED NO_CLOUDFLARE'
    } finally {
        if ($null -ne $process -and $null -ne $process.StartInfo) {
            try { if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit(5000)|Out-Null } } catch {}
        }
        $InputText=$null; $line=$null; $process.Dispose(); $clock.Stop()
    }
}

# These routines accept only the explicit local runner protocol, never arbitrary JSON.
function Assert-CaseFrame {
    param([Collections.IDictionary]$Frame,[Collections.IDictionary]$Snapshot,[Collections.Generic.List[string]]$Seen)
    Assert-Fields $Frame @('event','caseId','status','code') @('translation','usage','estimatedPeakCostMicroCny','upstreamStatus')
    if ($Frame['event'] -cne 'LOCAL_TRIAL_CASE' -or $Frame['caseId'] -isnot [string] -or
        $Frame['caseId'] -cnotin $script:caseIds -or $Frame['caseId'] -cnotin @($Snapshot['remainingCaseIds']) -or
        $Seen.Contains($Frame['caseId']) -or $Seen.Count -ge 4 -or
        -not (Test-IntegerRange $Frame['status'] 100 599)) { throw 'LOCAL_CASE_PROTOCOL_FAILED' }
    $expected=@($Snapshot['remainingCaseIds'])[$Seen.Count]
    if ($Frame['caseId'] -cne $expected) { throw 'LOCAL_CASE_ORDER_FAILED' }
    if ($Frame['status'] -eq 200) {
        if (-not $Frame.Contains('translation') -or $Frame['translation'] -isnot [string] -or
            -not $Frame['translation'].Trim() -or $Frame['translation'].Length -gt 16384 -or $Frame['code'] -cne 'OK') { throw 'LOCAL_CASE_PROTOCOL_FAILED' }
        if ($null -ne $script:apiKey -and $Frame['translation'].Contains($script:apiKey,[StringComparison]::Ordinal)) { throw 'LOCAL_CASE_PROTOCOL_FAILED' }
    } else {
        if (-not $Frame.Contains('code') -or $Frame['code'] -cnotin @('INVALID_REQUEST','TEXT_TOO_LONG','UNAUTHORIZED','QUOTA_EXCEEDED',
            'SERVICE_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_ERROR','PRESERVATION_FAILED','RATE_LIMITED','LOCAL_RESULT_INVALID') -or $Frame.Contains('translation')) { throw 'LOCAL_CASE_PROTOCOL_FAILED' }
    }
    if ($Frame.Contains('usage')) { Assert-UsageFrame $Frame['usage'] }
    if ($Frame.Contains('estimatedPeakCostMicroCny')) {
        if (-not $Frame.Contains('usage') -or -not (Test-IntegerRange $Frame['estimatedPeakCostMicroCny'] 0 69632) -or
            $Frame['estimatedPeakCostMicroCny'] -ne $Frame['usage']['promptTokens']*2+$Frame['usage']['completionTokens']*8) { throw 'LOCAL_USAGE_PROTOCOL_FAILED' }
    }
    if ($Frame.Contains('upstreamStatus') -and $Frame['upstreamStatus'] -cne 'OTHER') {
        if (-not (Test-IntegerRange $Frame['upstreamStatus'] 100 599) -or
            $Frame['upstreamStatus'] -notin @(200,400,401,402,403,404,408,422,429,500,502,503,504)) { throw 'LOCAL_CASE_PROTOCOL_FAILED' }
    }
    $Seen.Add([string]$Frame['caseId'])
}
function Assert-UsageFrame {
    param($Usage)
    if ($Usage -isnot [Collections.IDictionary]) { throw 'LOCAL_USAGE_PROTOCOL_FAILED' }
    Assert-Fields $Usage @('promptTokens','completionTokens')
    if (-not (Test-IntegerRange $Usage['promptTokens'] 1 32768) -or
        -not (Test-IntegerRange $Usage['completionTokens'] 1 512)) { throw 'LOCAL_USAGE_PROTOCOL_FAILED' }
}
function Write-SafeCase {
    param([Collections.IDictionary]$Frame)
    Write-Output "DEEPSEEK_LOCAL_CASE ID=$($Frame['caseId']) HTTP=$($Frame['status'])"
    if ($Frame['code'] -cne 'OK') { Write-Output "DEEPSEEK_LOCAL_SAFE_ERROR=$($Frame['code'])" }
    if ($Frame.Contains('translation')) { Write-Output "DEEPSEEK_LOCAL_SYNTHETIC_TRANSLATION=$($Frame['translation']|ConvertTo-Json -Compress)" }
    if ($Frame.Contains('usage')) {
        $usage=$Frame['usage']
        Write-Output "DEEPSEEK_LOCAL_USAGE INPUT=$($usage['promptTokens']) OUTPUT=$($usage['completionTokens'])"
    }
    if ($Frame.Contains('estimatedPeakCostMicroCny')) { Write-Output "DEEPSEEK_LOCAL_PEAK_ESTIMATE_MICRO_CNY=$($Frame['estimatedPeakCostMicroCny'])" }
    if ($Frame.Contains('upstreamStatus')) { Write-Output "DEEPSEEK_LOCAL_UPSTREAM_HTTP=$($Frame['upstreamStatus'])" }
}
function Assert-TerminalFrame {
    param([Collections.IDictionary]$Frame,[Collections.IDictionary]$Snapshot,[Collections.Generic.List[string]]$Seen)
    Assert-Fields $Frame @('event','ledgerId','attempts','reservedMicroCny','sampleMask','remainingCaseIds','upstreamAttempts') @('reason')
    if ($Frame['event'] -cnotin @('LOCAL_TRIAL_COMPLETE','LOCAL_TRIAL_STOPPED') -or
        $Frame['ledgerId'] -cne $Snapshot['ledgerId'] -or
        -not (Test-IntegerRange $Frame['attempts'] 0 4) -or
        -not (Test-IntegerRange $Frame['reservedMicroCny'] 0 1000000) -or
        $Frame['reservedMicroCny'] -ne $Frame['attempts']*250000 -or $Frame['attempts'] -lt $Snapshot['attempts'] -or
        -not (Test-IntegerRange $Frame['sampleMask'] 0 15) -or $Frame['remainingCaseIds'] -isnot [Array] -or
        -not (Test-IntegerRange $Frame['upstreamAttempts'] 0 4) -or
        $Frame['upstreamAttempts'] -gt @($Snapshot['remainingCaseIds']).Count -or
        $Frame['upstreamAttempts'] -gt $Seen.Count+1) { throw 'LOCAL_TERMINAL_PROTOCOL_FAILED' }
    $summaryCheck=@{event='LOCAL_TRIAL_CHECK_OK';executionAuthority=$script:authority;attempts=$Frame['attempts'];
        reservedMicroCny=$Frame['reservedMicroCny'];sampleMask=$Frame['sampleMask'];remainingCaseIds=$Frame['remainingCaseIds'];
        ledgerInitialized=$false;proofSha256=$Snapshot['proofSha256'];ledgerId=$Snapshot['ledgerId']}
    Assert-CheckFrame $summaryCheck
    if ($Frame['event'] -ceq 'LOCAL_TRIAL_COMPLETE' -and
        ($Seen.Count -ne @($Snapshot['remainingCaseIds']).Count -or $Frame['attempts'] -ne 4 -or $Frame.Contains('reason') -or
         $Frame['upstreamAttempts'] -ne $Seen.Count)) { throw 'LOCAL_TERMINAL_PROTOCOL_FAILED' }
    if ($Frame['event'] -ceq 'LOCAL_TRIAL_STOPPED' -and (-not $Frame.Contains('reason') -or
        $Frame['reason'] -cnotin @('LOCAL_GATE_FAILED','KEY_INPUT_INVALID','INPUT_TIMEOUT','INTERRUPTED','LOCAL_RESULT_INVALID',
            'INVALID_REQUEST','TEXT_TOO_LONG','UNAUTHORIZED','QUOTA_EXCEEDED','SERVICE_UNAVAILABLE','UPSTREAM_TIMEOUT','UPSTREAM_ERROR','PRESERVATION_FAILED','RATE_LIMITED'))) { throw 'LOCAL_TERMINAL_PROTOCOL_FAILED' }
}
function Write-SafeTerminal {
    param([Collections.IDictionary]$Frame)
    Write-Output "DEEPSEEK_LOCAL_LEDGER ATTEMPTS=$($Frame['attempts']) RESERVED_MICRO_CNY=$($Frame['reservedMicroCny']) MASK=$($Frame['sampleMask']) UPSTREAM_ATTEMPTS_THIS_RUN=$($Frame['upstreamAttempts'])"
    if ($Frame.Contains('reason')) { Write-Output "DEEPSEEK_LOCAL_STOP_REASON=$($Frame['reason'])" }
}

function Get-LocalSnapshot {
    param([switch]$Initialize)
    return Invoke-LocalNode -Mode check -Initialize:$Initialize
}
function Invoke-LocalFlow {
    param([switch]$Initialize)
    $inputJson=$null
    try {
        $script:phase='preflight'
        $before=Get-LocalSnapshot -Initialize:$Initialize
        if (@($before['remainingCaseIds']).Count -eq 0) { throw 'LOCAL_TRIAL_ALREADY_COMPLETE' }
        $script:phase='private_input'; Read-LocalApiKey
        $script:phase='recheck'
        $after=Get-LocalSnapshot
        Assert-SnapshotUnchanged $before $after
        Assert-ApiKey $script:apiKey
        $inputJson=@{apiKey=$script:apiKey;proofSha256=$after['proofSha256'];ledgerId=$after['ledgerId']}|ConvertTo-Json -Compress
        $script:phase='trial'; $script:runStarted=$true
        Invoke-LocalNode -Mode run -InputText $inputJson -Snapshot $after
    } finally { $inputJson=$null; $script:apiKey=$null }
}

function Assert-SelfTest {
    param([bool]$Condition)
    if (-not $Condition) { throw 'LOCAL_LAUNCHER_SELFTEST_FAILED' }
}
function Invoke-ProtocolSelfTests {
    param([Collections.IDictionary]$Snapshot)
    # Only a synthetic process fixture is launched. It has no model/network/ledger code.
    $script:fixtureProgram=@'
const mode=process.argv[1]; let input='';
for await (const chunk of process.stdin) input+=chunk;
const data=JSON.parse(input);
if(Object.keys(data).sort().join(',')!=='apiKey,ledgerId,proofSha256') process.exit(9);
const ids=['chinese','mixed','spelling','literal'];
const emit=x=>console.log(JSON.stringify(x));
const one=(id,status=200)=>({event:'LOCAL_TRIAL_CASE',caseId:id,status,code:status===200?'OK':'UPSTREAM_ERROR',...(status===200?{translation:'Synthetic translation',usage:{promptTokens:100,completionTokens:20},estimatedPeakCostMicroCny:360}:{}),upstreamStatus:status===200?200:401});
const stop=(n,reason)=>({event:'LOCAL_TRIAL_STOPPED',ledgerId:data.ledgerId,attempts:n,reservedMicroCny:n*250000,sampleMask:(1<<n)-1,remainingCaseIds:ids.slice(n),upstreamAttempts:n,reason});
if(mode==='check-existing'||mode==='check-initialized'){emit({event:'LOCAL_TRIAL_CHECK_OK',executionAuthority:'LOCAL_SQLITE_V1',proofSha256:data.proofSha256,ledgerId:data.ledgerId,attempts:0,reservedMicroCny:0,sampleMask:0,remainingCaseIds:ids,ledgerInitialized:mode==='check-initialized'});}
else if(mode==='raw'){console.log(data.apiKey);setTimeout(()=>{},10000);}
else if(mode==='echo'){emit({...one('chinese'),translation:data.apiKey});setTimeout(()=>{},10000);}
else if(mode==='stderr'){console.error(data.apiKey);emit(stop(0,'KEY_INPUT_INVALID'));process.exitCode=1;}
else if(mode==='failure'){emit(one('chinese',502));emit(stop(1,'UPSTREAM_ERROR'));process.exitCode=1;}
else if(mode==='invalid-result'){emit(stop(1,'LOCAL_RESULT_INVALID'));process.exitCode=1;}
else if(mode==='after-failure'){emit(one('chinese',502));emit(one('mixed'));setTimeout(()=>{},10000);}
else {for(const id of ids)emit(one(id));emit({event:'LOCAL_TRIAL_COMPLETE',ledgerId:data.ledgerId,attempts:4,reservedMicroCny:1000000,sampleMask:15,remainingCaseIds:[],upstreamAttempts:4});}
'@
    function New-NodeStartInfo {
        param($Mode,[switch]$Initialize)
        $start=[Diagnostics.ProcessStartInfo]::new(); $start.FileName=$script:nodePath; $start.WorkingDirectory=$script:workerRoot
        $start.UseShellExecute=$false; $start.CreateNoWindow=$true
        $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
        foreach ($arg in @('--input-type=module','-e',$script:fixtureProgram,$script:fixtureMode)) { $start.ArgumentList.Add($arg) }
        foreach ($name in @('NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','DEEPSEEK_API_KEY','AZURE_TRANSLATOR_KEY','AZURE_API_KEY')) { $null=$start.Environment.Remove($name) }
        return $start
    }
    $script:nodePath=(Get-Command node -CommandType Application -ErrorAction Stop).Source
    $checkInput=@{apiKey=$script:apiKey;proofSha256=$Snapshot['proofSha256'];ledgerId=$Snapshot['ledgerId']}|ConvertTo-Json -Compress
    foreach ($fixtureMode in @('check-existing','check-initialized')) {
        $script:fixtureMode=$fixtureMode
        # Exercise the real subprocess/drain pipeline, not a mocked snapshot function.
        $frames=@(Invoke-LocalNode -Mode check -InputText $checkInput)
        Assert-SelfTest ($frames.Count -eq 1 -and $frames[0] -is [Collections.IDictionary])
        Assert-SelfTest ($frames[0]['ledgerInitialized'] -eq ($fixtureMode -ceq 'check-initialized'))
    }
    $checkInput=$null
    foreach ($fixtureMode in @('success','failure','invalid-result','raw','echo','stderr','after-failure')) {
        $script:fixtureMode=$fixtureMode; $caught=$false
        $inputJson=@{apiKey=$script:apiKey;proofSha256=$Snapshot['proofSha256'];ledgerId=$Snapshot['ledgerId']}|ConvertTo-Json -Compress
        $clock=[Diagnostics.Stopwatch]::StartNew()
        $items=@(try { Invoke-LocalNode -Mode run -InputText $inputJson -Snapshot $Snapshot } catch { $caught=$true })
        Assert-SelfTest (@($items|Where-Object { $_ -isnot [string] }).Count -eq 0)
        $rendered=$items -join "`n"
        $clock.Stop(); $inputJson=$null
        Assert-SelfTest ($caught -eq ($fixtureMode -cne 'success'))
        Assert-SelfTest (-not $rendered.Contains($script:apiKey))
        Assert-SelfTest ($clock.ElapsedMilliseconds -lt 8000)
        if ($fixtureMode -ceq 'success') { Assert-SelfTest ($rendered.Contains('DEEPSEEK_LOCAL_TRIAL_COMPLETE')) }
        if ($fixtureMode -ceq 'after-failure') { Assert-SelfTest (-not $rendered.Contains('ID=mixed')) }
    }
    $script:fixtureProgram=$null; $script:fixtureMode=$null
}
function Invoke-LauncherSelfTest {
    $script:nodePath='node'
    $snapshot=@{event='LOCAL_TRIAL_CHECK_OK';executionAuthority='LOCAL_SQLITE_V1';attempts=0;reservedMicroCny=0;sampleMask=0;
        remainingCaseIds=@('chinese','mixed','spelling','literal');ledgerInitialized=$true;proofSha256=('a'*64);ledgerId='00000000-0000-4000-8000-000000000001'}
    Assert-CheckFrame $snapshot
    $same=$snapshot.Clone(); $same['ledgerInitialized']=$false; Assert-SnapshotUnchanged $snapshot $same
    foreach ($field in @('proofSha256','ledgerId','attempts','reservedMicroCny','remainingCaseIds')) {
        $bad=$same.Clone()
        switch ($field) {
            proofSha256 { $bad[$field]='b'*64 }
            ledgerId { $bad[$field]='00000000-0000-4000-8000-000000000002' }
            attempts { $bad[$field]=1 }
            reservedMicroCny { $bad[$field]=250000 }
            remainingCaseIds { $bad[$field]=@('mixed','chinese','spelling','literal') }
        }
        $rejected=$false; try { Assert-SnapshotUnchanged $snapshot $bad } catch { $rejected=$true }
        Assert-SelfTest $rejected
    }
    $script:apiKey='SYNTHETIC_LOCAL_KEY_DO_NOT_LEAK'
    $start=New-NodeStartInfo -Mode run
    Assert-SelfTest (-not (($start.ArgumentList -join ' ').Contains($script:apiKey)))
    Assert-SelfTest (-not $start.Environment.ContainsKey('DEEPSEEK_API_KEY') -and -not $start.Environment.ContainsKey('AZURE_TRANSLATOR_KEY'))
    $init=New-NodeStartInfo -Mode check -Initialize
    Assert-SelfTest ($init.ArgumentList.Contains('--initialize-ledger') -and -not $start.ArgumentList.Contains('--initialize-ledger'))
    $seen=[Collections.Generic.List[string]]::new()
    foreach ($id in $script:caseIds) {
        $frame=@{event='LOCAL_TRIAL_CASE';caseId=$id;status=200;code='OK';translation='Synthetic translation';usage=@{promptTokens=100;completionTokens=20};estimatedPeakCostMicroCny=360;upstreamStatus=200}
        Assert-CaseFrame $frame $snapshot $seen
        $safe=@(Write-SafeCase $frame)-join "`n"
        Assert-SelfTest (-not $safe.Contains($script:apiKey))
    }
    Assert-TerminalFrame @{event='LOCAL_TRIAL_COMPLETE';ledgerId=$snapshot['ledgerId'];attempts=4;reservedMicroCny=1000000;sampleMask=15;remainingCaseIds=@();upstreamAttempts=4} $snapshot $seen
    $rejected=$false; try { Assert-CaseFrame @{event='LOCAL_TRIAL_CASE';caseId='chinese';status=200;code='OK';translation='x'} $snapshot $seen } catch { $rejected=$true }; Assert-SelfTest $rejected
    foreach ($hostile in @(
        @{event='LOCAL_TRIAL_CASE';caseId='chinese';status=200;code='OK';translation=$script:apiKey},
        @{event='LOCAL_TRIAL_CASE';caseId='chinese';status=502;code='DO_NOT_LEAK_PRIVATE'},
        @{event='LOCAL_TRIAL_CASE';caseId='chinese';status=200;code='OK';translation='x';raw='DO_NOT_LEAK_PRIVATE'},
        @{event='LOCAL_TRIAL_CASE';caseId='chinese';status=200;code='OK';translation='x';usage=@{promptTokens=32769;completionTokens=0}}
    )) {
        $rejected=$false; try { Assert-CaseFrame $hostile $snapshot ([Collections.Generic.List[string]]::new()) } catch { $rejected=$true }; Assert-SelfTest $rejected
    }
    Invoke-ProtocolSelfTests -Snapshot $snapshot
    function Get-LocalSnapshot {
        param([switch]$Initialize)
        $script:testChecks++; if ($Initialize) { $script:testInitializations++ }
        if ($script:testFailure -ceq 'preflight' -or ($script:testChecks -eq 2 -and $script:testFailure -ceq 'expired')) { throw 'SYNTHETIC_PROOF_REJECTED' }
        $value=$script:testSnapshot.Clone()
        if ($script:testChecks -eq 2 -and $script:testFailure -ceq 'changed') { $value['proofSha256']='b'*64 }
        return $value
    }
    function Read-LocalApiKey {
        $script:testInputs++
        if ($script:testFailure -ceq 'cancel') { throw 'SYNTHETIC_CANCEL' }
        $script:apiKey='SYNTHETIC_LOCAL_KEY_DO_NOT_LEAK'
    }
    function Invoke-LocalNode {
        param($Mode,[switch]$Initialize,$InputText,$Snapshot)
        Assert-SelfTest ($Mode -ceq 'run' -and -not $Initialize)
        $data=ConvertFrom-Json -InputObject $InputText -AsHashtable
        Assert-SelfTest ($data.Count -eq 3 -and $data['apiKey'] -ceq $script:apiKey -and
            $data['proofSha256'] -ceq $Snapshot['proofSha256'] -and $data['ledgerId'] -ceq $Snapshot['ledgerId'])
        $script:testRuns++
        if ($script:testFailure -ceq 'run') { throw 'SYNTHETIC_CHILD_FAILURE' }
    }
    $script:testSnapshot=$snapshot
    foreach ($failure in @('','preflight','cancel','changed','expired','run')) {
        $script:testFailure=$failure; $script:testChecks=0; $script:testInitializations=0; $script:testInputs=0; $script:testRuns=0
        $script:apiKey=$null; $script:runStarted=$false; $caught=$false
        try { Invoke-LocalFlow -Initialize } catch { $caught=$true }
        Assert-SelfTest ($caught -eq [bool]$failure)
        Assert-SelfTest ($script:testInitializations -eq 1)
        if ($failure -ceq 'preflight') { Assert-SelfTest ($script:testInputs -eq 0) }
        if ($failure -in @('preflight','cancel','changed','expired')) { Assert-SelfTest ($script:testRuns -eq 0) }
        else { Assert-SelfTest ($script:testRuns -eq 1) }
        Assert-SelfTest ($null -eq $script:apiKey)
    }
    Write-Output 'DEEPSEEK_LOCAL_LAUNCHER_SELFTEST_OK CNY_REQUIRED PROOF_BEFORE_INPUT RECHECK_BEFORE_RUN STDIN_ONLY NO_UPLOAD NO_GENERATION MAX_FOUR_PROTOCOL FIRST_FAILURE_NO_RETRY NO_GUI_NO_NETWORK'
}

try {
    if ($SelfTest -eq $RunTrial -or ($SelfTest -and ($CnyAccountConfirmed -or $InitializeLocalLedger)) -or $MyInvocation.InvocationName -eq '.') { throw 'EXPLICIT_MODE_REQUIRED' }
    if ($SelfTest) { Invoke-LauncherSelfTest }
    else {
        if (-not $CnyAccountConfirmed) { throw 'CNY_ACCOUNT_CONFIRMATION_REQUIRED' }
        if (-not $IsWindows -or -not [Environment]::UserInteractive -or
            [Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'INTERACTIVE_WINDOWS_STA_REQUIRED' }
        $script:nodePath=(Get-Command node -CommandType Application -ErrorAction Stop).Source
        Add-Type -AssemblyName System.Windows.Forms
        Invoke-LocalFlow -Initialize:$InitializeLocalLedger
    }
} catch {
    $script:failed=$true
    if ($script:runStarted) { Write-Output "DEEPSEEK_LOCAL_STOPPED PHASE=$($script:phase) SAFE_FAILURE EXECUTION_MAY_BE_PARTIAL CHECK_LEDGER_BEFORE_RESUME" }
    else { Write-Output "DEEPSEEK_LOCAL_STOPPED PHASE=$($script:phase) SAFE_FAILURE NO_MODEL_REQUEST_STARTED" }
} finally { $script:apiKey=$null; $Error.Clear() }
if ($script:failed) { exit 1 }
