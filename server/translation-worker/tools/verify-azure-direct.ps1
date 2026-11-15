#requires -Version 7.0
[CmdletBinding()]
param([switch]$SelfTest, [switch]$RunTrial)

# Run in a fresh pwsh -NoProfile -STA process. Never enable tracing/transcription.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$script:endpoint = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hans&to=en&textType=plain'
$script:region = 'eastasia'
$script:sample = '今天天气很好，我们一起去公园散步。'
$script:azureKey = $null
$script:attempts = 0
$script:received = $false
$script:maximumResponseBytes = 1000000

function Assert-DirectConfiguration {
    if ($script:endpoint -cne 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hans&to=en&textType=plain' -or
        $script:region -cne 'eastasia' -or $script:sample -cne '今天天气很好，我们一起去公园散步。') {
        throw 'FIXED_CONFIGURATION_REQUIRED'
    }
}

function Assert-HeaderKey {
    param([AllowNull()][string]$Key)
    # Validate locally before any send; never include the rejected value in an error.
    if ([string]::IsNullOrEmpty($Key) -or $Key.Length -gt 512 -or $Key -cmatch '[^\x21-\x7e]') {
        throw 'KEY_HEADER_FORMAT_INVALID'
    }
    $probe = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $script:endpoint)
    try { $probe.Headers.Add('Ocp-Apim-Subscription-Key', $Key) }
    finally { $probe.Dispose() }
}

function Read-DirectAzureKey {
    $form = [Windows.Forms.Form]::new()
    $timer = [Windows.Forms.Timer]::new()
    $box = [Windows.Forms.TextBox]::new()
    try {
        $form.Text = 'BilingualAuditor Azure 本机直连验证（请勿截图）'
        $form.Width = 760; $form.Height = 252; $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
        $label = [Windows.Forms.Label]::new()
        $label.SetBounds(16, 12, 710, 76)
        $label.Text = "请输入 ba-lar 的 Azure Translator Key（不是本人访问凭证）。仅在本机内存使用。`r`n固定区域 eastasia、官方端点；只发送一次已批准的短中文合成文本，不重试。`r`n取消、关闭或五分钟未确认均不发送请求。请勿发送 Key 或窗口截图到聊天。"
        $box.SetBounds(16, 96, 710, 28); $box.UseSystemPasswordChar = $true; $box.MaxLength = 512
        $ok = [Windows.Forms.Button]::new()
        $ok.SetBounds(465, 145, 125, 32); $ok.Text = '直连验证一次'; $ok.DialogResult = [Windows.Forms.DialogResult]::OK
        $cancel = [Windows.Forms.Button]::new()
        $cancel.SetBounds(606, 145, 120, 32); $cancel.Text = '取消'; $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
        $form.Controls.AddRange(@($label, $box, $ok, $cancel)); $form.AcceptButton = $ok; $form.CancelButton = $cancel
        $timer.Interval = 300000
        $timer.Add_Tick({ $form.DialogResult = [Windows.Forms.DialogResult]::Cancel; $form.Close() })
        $form.Add_Shown({ $timer.Start(); Write-Output 'AZURE_DIRECT_KEY_INPUT_READY' | Out-Host })
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'KEY_INPUT_CANCELLED' }
        Assert-HeaderKey -Key $box.Text
        $script:azureKey = $box.Text
    } finally { $timer.Stop(); $timer.Dispose(); $box.Clear(); $form.Dispose() }
}

function New-DirectClient {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    # Use the user's existing system proxy and normal certificate validation.
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(40)
    return [pscustomobject]@{ Client = $client; Handler = $handler }
}

function Get-SafeHttpStatus {
    param([int]$Status)
    foreach ($known in @(200,300,301,302,303,304,307,308,400,401,403,405,408,415,429,500,502,503,504)) {
        if ($Status -eq $known) { return [string]$known }
    }
    return 'OTHER'
}

function Get-SafeAzureCode {
    param($Data)
    if ($Data -isnot [Collections.IDictionary] -or $Data['error'] -isnot [Collections.IDictionary]) { return 'OTHER' }
    $candidate = $Data['error']['code']
    if ($candidate -isnot [string] -and $candidate -isnot [int] -and $candidate -isnot [long]) { return 'OTHER' }
    foreach ($known in @('400000','400001','400002','400003','400004','400005','400006',
        '400018','400019','400020','400021','400023','400035','400036','400042','400043',
        '400050','400064','400070','400071','400072','400073','400074','400075','400077',
        '400079','400080','401000','401015','403000','403001','405000','408001','408002',
        '415000','429000','429001','429002','500000','503000')) {
        if ([string]$candidate -ceq $known) { return $known }
    }
    return 'OTHER'
}

function New-SafeResult {
    param([bool]$Success, [string]$Stage, [string]$HttpStatus = 'OTHER', [string]$AzureCode = 'OTHER', [string]$Translation = '')
    return [pscustomobject]@{ Success=$Success; Stage=$Stage; HttpStatus=$HttpStatus; AzureCode=$AzureCode; Translation=$Translation }
}

function Invoke-DirectOnce {
    param([Net.Http.HttpClient]$Client)
    $request = $null; $response = $null; $deadline = $null
    $stage = 'configuration'; $safeStatus = 'OTHER'
    try {
        Assert-DirectConfiguration
        Assert-HeaderKey -Key $script:azureKey
        if ($script:attempts -ne 0) { return New-SafeResult $false 'single_request_gate' }
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $script:endpoint)
        $request.Headers.Add('Ocp-Apim-Subscription-Key', $script:azureKey)
        $request.Headers.Add('Ocp-Apim-Subscription-Region', $script:region)
        $body = ConvertTo-Json -InputObject @(@{ Text = $script:sample }) -Compress
        $request.Content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
        $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(40))
        $stage = 'transport'
        $script:attempts++
        $response = $Client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        $script:received = $true
        $status = [int]$response.StatusCode
        $safeStatus = Get-SafeHttpStatus $status
        if ($status -ge 300 -and $status -lt 400) { return New-SafeResult $false 'http_redirect_rejected' $safeStatus }
        $stage = 'response_decode'
        if ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $script:maximumResponseBytes) {
            return New-SafeResult $false 'response_limit' $safeStatus
        }
        $stream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
        $memory = [IO.MemoryStream]::new()
        try {
            $buffer = [byte[]]::new(8192)
            while ($true) {
                $count = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()
                if ($count -eq 0) { break }
                if ($memory.Length + $count -gt $script:maximumResponseBytes) { return New-SafeResult $false 'response_limit' $safeStatus }
                $memory.Write($buffer, 0, $count)
            }
            $raw = [Text.UTF8Encoding]::new($false, $true).GetString($memory.ToArray())
        } finally { $memory.Dispose(); $stream.Dispose() }
        $data = ConvertFrom-Json -InputObject $raw -AsHashtable -NoEnumerate -Depth 12
        if ($status -ne 200) { return New-SafeResult $false 'http' $safeStatus (Get-SafeAzureCode $data) }
        $stage = 'response_shape'
        if ($data -isnot [Array] -or $data.Count -ne 1 -or $data[0] -isnot [Collections.IDictionary]) {
            return New-SafeResult $false $stage $safeStatus
        }
        $translations = $data[0]['translations']
        if ($translations -isnot [Array] -or $translations.Count -ne 1 -or $translations[0] -isnot [Collections.IDictionary] -or
            $translations[0]['to'] -cne 'en' -or $translations[0]['text'] -isnot [string]) {
            return New-SafeResult $false $stage $safeStatus
        }
        $translation = [string]$translations[0]['text']
        if (-not $translation.Trim() -or $translation.Length -gt 10000 -or
            $translation.Contains($script:azureKey, [StringComparison]::Ordinal)) {
            return New-SafeResult $false $stage $safeStatus
        }
        return New-SafeResult $true 'complete' '200' 'OK' $translation
    } catch {
        if ($null -ne $deadline -and ($deadline.IsCancellationRequested -or $_.Exception -is [OperationCanceledException] -or
            $_.Exception.InnerException -is [OperationCanceledException])) { $stage = 'timeout' }
        return New-SafeResult $false $stage $safeStatus
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $request) { $request.Dispose() }
        if ($null -ne $deadline) { $deadline.Dispose() }
    }
}

function Invoke-DirectFlow {
    $pair = $null
    try {
        Assert-DirectConfiguration
        Read-DirectAzureKey
        $pair = New-DirectClient
        $result = Invoke-DirectOnce -Client $pair.Client
        Write-Output "AZURE_DIRECT_RESULT STAGE=$($result.Stage) HTTP=$($result.HttpStatus) AZURE=$($result.AzureCode) ATTEMPTS=$script:attempts RESPONSE_RECEIVED=$script:received"
        if ($result.Success) {
            # This is solely the fixed synthetic sample's translation, escaped for console output.
            Write-Output "AZURE_DIRECT_SYNTHETIC_TRANSLATION=$($result.Translation | ConvertTo-Json -Compress)"
        } else { $script:failed = $true }
    } catch {
        Write-Output "AZURE_DIRECT_STOPPED SAFE_INPUT_OR_CONFIGURATION_FAILURE ATTEMPTS=$script:attempts"
        $script:failed = $true
    } finally {
        if ($null -ne $pair) { $pair.Client.Dispose() }
        $script:azureKey = $null
    }
}

function Invoke-DirectSelfTest {
    if ($null -eq ('AzureDirectFixtureHandlerV1' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
public sealed class AzureDirectProbeContentV1 : HttpContent {
    public static int Reads;
    protected override bool TryComputeLength(out long length) { length=0; return false; }
    protected override Task SerializeToStreamAsync(Stream stream, TransportContext context) {
        Reads++; throw new InvalidOperationException("DO_NOT_LEAK_BODY");
    }
}
public sealed class AzureDirectUnknownLengthContentV1 : HttpContent {
    protected override bool TryComputeLength(out long length) { length=0; return false; }
    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext context) {
        var bytes=new byte[1000001]; await stream.WriteAsync(bytes,0,bytes.Length);
    }
}
public sealed class AzureDirectFixtureHandlerV1 : HttpMessageHandler {
    public int Calls; public string Body; public string Uri; public string Region; public string Method;
    public string Kind;
    public AzureDirectFixtureHandlerV1(string kind) { Kind=kind; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
        Calls++; Uri=request.RequestUri.AbsoluteUri; Method=request.Method.Method;
        Region=String.Join("",request.Headers.GetValues("Ocp-Apim-Subscription-Region"));
        Body=await request.Content.ReadAsStringAsync();
        if (Kind=="transport") throw new HttpRequestException("DO_NOT_LEAK_PRIVATE");
        if (Kind=="timeout") throw new TaskCanceledException("DO_NOT_LEAK_PRIVATE");
        var response=new HttpResponseMessage(HttpStatusCode.OK);
        if (Kind=="redirect") { response.StatusCode=HttpStatusCode.Redirect; response.Content=new AzureDirectProbeContentV1(); return response; }
        if (Kind=="oversize") { response.Content=new StringContent(new String('x',1000001)); return response; }
        if (Kind=="oversize_stream") { response.Content=new AzureDirectUnknownLengthContentV1(); return response; }
        if (Kind=="bad_json") { response.Content=new StringContent("DO_NOT_LEAK_PRIVATE"); return response; }
        if (Kind=="unknown_status") { response.StatusCode=(HttpStatusCode)599; response.Content=new StringContent("{\"error\":{\"code\":\"DO_NOT_LEAK_PRIVATE\",\"message\":\"DO_NOT_LEAK_PRIVATE\"}}"); return response; }
        if (Kind=="auth") { response.StatusCode=HttpStatusCode.Unauthorized; response.Content=new StringContent("{\"error\":{\"code\":401000,\"message\":\"DO_NOT_LEAK_PRIVATE\"}}"); return response; }
        if (Kind=="shape") { response.Content=new StringContent("[{\"translations\":[{\"to\":\"zh\",\"text\":\"DO_NOT_LEAK_PRIVATE\"}]}]"); return response; }
        if (Kind=="key_echo") { response.Content=new StringContent("[{\"translations\":[{\"to\":\"en\",\"text\":\"synthetic-key-only\"}]}]"); return response; }
        response.Content=new StringContent("[{\"translations\":[{\"to\":\"en\",\"text\":\"The weather is nice today.\"}]}]");
        return response;
    }
}
'@
    }
    function Check-DirectTest { param([bool]$Condition) if (-not $Condition) { throw 'SELFTEST_ASSERTION_FAILED' } }
    foreach ($invalid in @('', "bad`r`nkey", '含中文', ' has-space', 'has space')) {
        $rejected = $false
        try { Assert-HeaderKey $invalid } catch { $rejected = $true }
        Check-DirectTest $rejected
    }
    $originalRegion = $script:region
    try {
        $script:region = 'other'; $rejected = $false
        try { Assert-DirectConfiguration } catch { $rejected = $true }
        Check-DirectTest $rejected
    } finally { $script:region = $originalRegion }
    $pair = New-DirectClient
    try { Check-DirectTest (-not $pair.Handler.AllowAutoRedirect -and $pair.Client.Timeout.TotalSeconds -eq 40) }
    finally { $pair.Client.Dispose() }
    foreach ($kind in @('success','transport','timeout','redirect','oversize','oversize_stream','bad_json','unknown_status','auth','shape','key_echo')) {
        $script:attempts = 0; $script:received = $false; $script:azureKey = 'synthetic-key-only'
        $handler = [AzureDirectFixtureHandlerV1]::new($kind)
        $client = [Net.Http.HttpClient]::new($handler)
        try {
            $result = Invoke-DirectOnce -Client $client
            Check-DirectTest ($handler.Calls -eq 1 -and $script:attempts -eq 1)
            Check-DirectTest ($handler.Uri -ceq $script:endpoint -and $handler.Region -ceq 'eastasia' -and $handler.Method -ceq 'POST')
            $sent = ConvertFrom-Json -InputObject $handler.Body -AsHashtable -NoEnumerate
            Check-DirectTest ($sent.Count -eq 1 -and $sent[0]['Text'] -ceq $script:sample)
            $safe = $result | ConvertTo-Json -Compress
            Check-DirectTest (-not $safe.Contains('DO_NOT_LEAK') -and -not $safe.Contains('synthetic-key-only'))
            switch ($kind) {
                'success' { Check-DirectTest ($result.Success -and $result.Translation -ceq 'The weather is nice today.') }
                'timeout' { Check-DirectTest (-not $result.Success -and $result.Stage -ceq 'timeout') }
                'redirect' { Check-DirectTest (-not $result.Success -and $result.Stage -ceq 'http_redirect_rejected' -and [AzureDirectProbeContentV1]::Reads -eq 0) }
                'oversize' { Check-DirectTest ($result.Stage -ceq 'response_limit') }
                'oversize_stream' { Check-DirectTest ($result.Stage -ceq 'response_limit') }
                'auth' { Check-DirectTest ($result.HttpStatus -ceq '401' -and $result.AzureCode -ceq '401000') }
                'unknown_status' { Check-DirectTest ($result.HttpStatus -ceq 'OTHER' -and $result.AzureCode -ceq 'OTHER') }
                default { Check-DirectTest (-not $result.Success) }
            }
            $second = Invoke-DirectOnce -Client $client
            Check-DirectTest (-not $second.Success -and $second.Stage -ceq 'single_request_gate' -and $handler.Calls -eq 1)
        } finally { $client.Dispose(); $script:azureKey = $null }
    }
    $script:attempts = 0
    function Read-DirectAzureKey { throw 'SYNTHETIC_CANCEL' }
    function New-DirectClient { throw 'CANCEL_MUST_NOT_CREATE_CLIENT' }
    $output = @(Invoke-DirectFlow)
    Check-DirectTest ($script:attempts -eq 0 -and $null -eq $script:azureKey -and $output.Count -eq 1)
    Write-Output 'AZURE_DIRECT_SELFTEST_OK FIXED_SAMPLE_MAX_ONE CANCEL_ZERO KEY_HEADER_GATE REDIRECT_REJECTED BOUNDED_RESPONSE TIMEOUT ENUMS_ONLY NO_GUI_NO_NETWORK_NO_REAL_KEY'
}

$script:failed = $false
try {
    if ($SelfTest -eq $RunTrial -or $MyInvocation.InvocationName -eq '.') { throw 'EXPLICIT_MODE_REQUIRED' }
    if ($SelfTest) { Invoke-DirectSelfTest; $script:failed = $false }
    else {
        if (-not $IsWindows -or -not [Environment]::UserInteractive -or
            [Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'INTERACTIVE_WINDOWS_STA_REQUIRED' }
        Add-Type -AssemblyName System.Windows.Forms
        Invoke-DirectFlow
    }
} catch {
    [Console]::Error.WriteLine('AZURE_DIRECT_TOOL_FAILED SAFE_FAILURE')
    $script:failed = $true
} finally {
    $script:azureKey = $null
    $Error.Clear()
}
if ($script:failed) { exit 1 }
