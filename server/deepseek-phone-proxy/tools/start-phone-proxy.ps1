#requires -Version 7.5
[CmdletBinding()]
param(
    [switch]$SelfTest, [switch]$RunProxy, [switch]$CnyAccountConfirmed,
    [switch]$InitializePhoneLedger, [string]$InterfaceId='',
    [string]$BindAddress='', [string]$AllowedClientAddress='',
    [ValidateRange(1024,65535)][int]$Port=8765
)

# No tracing, transcript, raw exception, credential logging, or clipboard access.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue'
$script:root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:nodePath=$null; $script:child=$null; $script:read=$null; $script:errorDrain=$null
$script:phase='mode'; $script:started=$false; $script:failed=$false; $script:terminal=$false; $script:ready=$false
$script:totalOutput=0; $script:sessionClock=$null

function Assert-That([bool]$Condition) { if (-not $Condition) { throw 'PHONE_PROXY_SAFE_REJECTION' } }
function Assert-Fields($Frame,[string[]]$Required,[string[]]$Optional=@()) {
    Assert-That ($Frame -is [Collections.IDictionary])
    foreach ($name in $Required) { Assert-That ($Frame.Contains($name)) }
    foreach ($name in $Frame.Keys) { Assert-That ($name -cin ($Required+$Optional)) }
}
function Test-Int($Value,[long]$Min,[long]$Max) {
    return ($Value -is [int] -or $Value -is [long]) -and $Value -ge $Min -and $Value -le $Max
}
function Assert-Limits($Limits) {
    Assert-Fields $Limits @('maxInputCodePoints','maxAttempts','maxBudgetMicroCny')
    Assert-That ((Test-Int $Limits.maxInputCodePoints 1000 1000) -and (Test-Int $Limits.maxAttempts 20 20) -and
        (Test-Int $Limits.maxBudgetMicroCny 3000000 3000000))
}
function Assert-Budget($Budget) {
    Assert-Fields $Budget @('attempts','reservedMicroCny','remainingAttempts','remainingReserveMicroCny')
    Assert-That ((Test-Int $Budget.attempts 0 20) -and (Test-Int $Budget.reservedMicroCny 0 3000000) -and
        (Test-Int $Budget.remainingAttempts 0 20) -and (Test-Int $Budget.remainingReserveMicroCny 0 3000000))
    Assert-That ($Budget.remainingAttempts -eq 20-$Budget.attempts -and
        $Budget.remainingReserveMicroCny -eq 3000000-$Budget.reservedMicroCny -and
        $Budget.reservedMicroCny -eq $Budget.attempts*150000)
}
function Assert-IsoDate($Value) {
    Assert-That ($Value -is [string] -and $Value -cmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$')
    $date=[DateTimeOffset]::MinValue
    Assert-That ([DateTimeOffset]::TryParse($Value,[ref]$date))
}
function Assert-Check($Frame) {
    Assert-Fields $Frame @('event','policySha256','ledgerId','ledgerInitialized','limits','budget','policyExpiresAt')
    Assert-That ($Frame.event -ceq 'PHONE_PROXY_CHECK_OK' -and $Frame.policySha256 -is [string] -and
        $Frame.policySha256 -cmatch '^[a-f0-9]{64}$' -and $Frame.ledgerId -is [string] -and
        $Frame.ledgerId -cmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -and
        $Frame.ledgerInitialized -is [bool])
    Assert-Limits $Frame.limits; Assert-Budget $Frame.budget; Assert-IsoDate $Frame.policyExpiresAt
    Assert-That ([DateTimeOffset]::Parse($Frame.policyExpiresAt) -gt [DateTimeOffset]::UtcNow)
}
function Assert-SnapshotUnchanged($Before,$After) {
    Assert-Check $Before; Assert-Check $After
    foreach ($name in @('policySha256','ledgerId','policyExpiresAt')) { Assert-That ($Before[$name] -ceq $After[$name]) }
    foreach ($name in @('attempts','reservedMicroCny','remainingAttempts','remainingReserveMicroCny')) {
        Assert-That ($Before.budget[$name] -ceq $After.budget[$name])
    }
}
function Convert-SafeFrame([string]$Line) {
    Assert-That ($Line.Length -gt 0 -and $Line.Length -le 8192)
    $frame=ConvertFrom-Json -InputObject $Line -AsHashtable -Depth 8 -DateKind String
    Assert-That ($frame -is [Collections.IDictionary] -and $frame.Contains('event') -and $frame.event -is [string])
    return $frame
}
function Assert-Credentials([string]$Key,[string]$Token) {
    Assert-That (-not [string]::IsNullOrEmpty($Key) -and $Key.Length -le 512 -and $Key -cnotmatch '[^\x21-\x7e]')
    Assert-That ($Token -cmatch '^[A-Za-z0-9_-]{32,256}$' -and $Token -cne $Key)
}
function New-MemoryCertificate([string]$Address) {
    $ip=[Net.IPAddress]::Parse($Address)
    Assert-That ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork)
    $rsa=[Security.Cryptography.RSA]::Create(2048); $cert=$null
    try {
        $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=BilingualAuditor temporary phone proxy',$rsa,
            [Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
        $usage=[Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage,$true))
        $oids=[Security.Cryptography.OidCollection]::new(); $null=$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$true))
        $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddIpAddress($ip)
        $request.CertificateExtensions.Add($san.Build())
        $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-2),[DateTimeOffset]::UtcNow.AddHours(4))
        return @{certificatePem=$cert.ExportCertificatePem();privateKeyPem=$rsa.ExportPkcs8PrivateKeyPem();
            certificateSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($cert.RawData)).ToLowerInvariant()}
    } finally { if ($null -ne $cert) { $cert.Dispose() }; $rsa.Dispose() }
}
function Test-PrivateIPv4([Net.IPAddress]$IP) {
    if ($IP.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $b=$IP.GetAddressBytes()
    return $b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168)
}
function Test-SameSubnet([Net.IPAddress]$A,[Net.IPAddress]$B,[Net.IPAddress]$Mask) {
    $aBytes=$A.GetAddressBytes(); $bBytes=$B.GetAddressBytes(); $maskBytes=$Mask.GetAddressBytes()
    for ($i=0;$i -lt 4;$i++) { if (($aBytes[$i] -band $maskBytes[$i]) -ne ($bBytes[$i] -band $maskBytes[$i])) { return $false } }
    return $true
}
function Get-HotspotCandidates {
    foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($nic.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up -or
            $nic.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Wireless80211) { continue }
        $props=$nic.GetIPProperties()
        foreach ($uni in $props.UnicastAddresses) {
            if (-not (Test-PrivateIPv4 $uni.Address)) { continue }
            foreach ($gw in $props.GatewayAddresses) {
                if (-not (Test-PrivateIPv4 $gw.Address) -or $gw.Address.Equals($uni.Address) -or
                    -not (Test-SameSubnet $uni.Address $gw.Address $uni.IPv4Mask)) { continue }
                # Neither SSID nor local account/interface display name is displayed or logged.
                [pscustomobject]@{InterfaceId=$nic.Id;InterfaceIndex=$props.GetIPv4Properties().Index;
                    BindAddress=$uni.Address.ToString();AllowedClientAddress=$gw.Address.ToString();Mask=$uni.IPv4Mask.ToString()}
            }
        }
    }
}
function Assert-CurrentScope($Scope) {
    $matches=@(Get-HotspotCandidates | Where-Object { $_.InterfaceId -ceq $Scope.InterfaceId -and
        $_.BindAddress -ceq $Scope.BindAddress -and $_.AllowedClientAddress -ceq $Scope.AllowedClientAddress })
    Assert-That ($matches.Count -eq 1)
}
function Select-HotspotScope {
    $candidates=@(Get-HotspotCandidates)
    if ($InterfaceId -or $BindAddress -or $AllowedClientAddress) {
        Assert-That ([bool]$InterfaceId -and [bool]$BindAddress -and [bool]$AllowedClientAddress)
        $candidates=@($candidates | Where-Object { $_.InterfaceId -ceq $InterfaceId -and
            $_.BindAddress -ceq $BindAddress -and $_.AllowedClientAddress -ceq $AllowedClientAddress })
    }
    if ($candidates.Count -eq 0) {
        $null=[Windows.Forms.MessageBox]::Show('请先让电脑连接本人的手机热点，再运行。需要活动 Wi-Fi、私有 IPv4 和同网段手机网关；无法确认时不会收集凭证。','尚未找到可用手机热点')
        throw 'NO_HOTSPOT_SCOPE'
    }
    $form=[Windows.Forms.Form]::new()
    try {
        $form.Text='确认本人手机热点'; $form.Width=720; $form.Height=280; $form.StartPosition='CenterScreen'
        $label=[Windows.Forms.Label]::new(); $label.SetBounds(16,12,670,65)
        $label.Text='请选择当前本人手机热点所在的 Wi-Fi 接口，并确认下列网关就是手机。只允许该手机 IP。电脑若连的是路由器或其他网络，请取消。'
        $list=[Windows.Forms.ComboBox]::new(); $list.SetBounds(16,85,670,32); $list.DropDownStyle='DropDownList'
        foreach ($scope in $candidates) { $null=$list.Items.Add("接口 #$($scope.InterfaceIndex) | 电脑 $($scope.BindAddress) | 手机网关 $($scope.AllowedClientAddress)") }
        if ($candidates.Count -eq 1) { $list.SelectedIndex=0 }
        $yes=[Windows.Forms.Button]::new(); $yes.SetBounds(310,150,240,36); $yes.Text='确认网关是本人手机'; $yes.DialogResult='OK'
        $no=[Windows.Forms.Button]::new(); $no.SetBounds(570,150,110,36); $no.Text='取消'; $no.DialogResult='Cancel'
        $form.Controls.AddRange(@($label,$list,$yes,$no)); $form.CancelButton=$no
        Assert-That ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK -and $list.SelectedIndex -ge 0)
        $result=$candidates[$list.SelectedIndex]; Assert-CurrentScope $result; return $result
    } finally { $form.Dispose() }
}
function New-NodeStartInfo([ValidateSet('check','serve')][string]$Mode,[switch]$Initialize) {
    $start=[Diagnostics.ProcessStartInfo]::new(); $start.FileName=$script:nodePath; $start.WorkingDirectory=$script:root
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    foreach ($arg in @('--use-env-proxy','tools/run-phone-proxy.mjs',"--$Mode",'--cny-account-confirmed')) { $start.ArgumentList.Add($arg) }
    if ($Initialize) { Assert-That ($Mode -ceq 'check'); $start.ArgumentList.Add('--initialize-ledger') }
    foreach ($name in @($start.Environment.Keys)) {
        if ($name -match '(?i)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|NODE_|DEBUG|COVERAGE|WRANGLER_OUTPUT|SSL_CERT|OPENSSL_CONF|ALL_PROXY)') { $null=$start.Environment.Remove($name) }
    }
    $start.Environment['HTTP_PROXY']='http://127.0.0.1:7897'; $start.Environment['HTTPS_PROXY']='http://127.0.0.1:7897'
    $start.Environment['http_proxy']='http://127.0.0.1:7897'; $start.Environment['https_proxy']='http://127.0.0.1:7897'
    $start.Environment['NO_PROXY']='localhost,127.0.0.1,::1'; $start.Environment['no_proxy']='localhost,127.0.0.1,::1'
    return $start
}
function Stop-ProcessSafely($Process) {
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            try { $Process.StandardInput.WriteLine('{"event":"STOP_PHONE_PROXY"}'); $Process.StandardInput.Flush() } catch {}
            try { $Process.StandardInput.Close() } catch {}
            if (-not $Process.WaitForExit(3000)) { $Process.Kill($true); $null=$Process.WaitForExit(3000) }
        }
    } catch { try { $Process.Kill($true) } catch {} }
}
function Get-PhoneSnapshot([switch]$Initialize) {
    $p=[Diagnostics.Process]::new(); $p.StartInfo=New-NodeStartInfo check -Initialize:$Initialize
    $drain=$null
    try {
        $null=$p.Start(); $drain=$p.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null); $p.StandardInput.Close()
        $read=$p.StandardOutput.ReadLineAsync(); Assert-That ($read.Wait(15000))
        $line=$read.GetAwaiter().GetResult(); $frame=Convert-SafeFrame $line; $line=$null; Assert-Check $frame
        $end=$p.StandardOutput.ReadLineAsync(); Assert-That ($end.Wait(5000)); Assert-That ($null -eq $end.GetAwaiter().GetResult())
        Assert-That ($p.WaitForExit(5000) -and $p.ExitCode -eq 0)
        $null=$drain.GetAwaiter().GetResult() # Suppress VoidTaskResult, including real initialized-ledger checks.
        return $frame
    } finally { Stop-ProcessSafely $p; $p.Dispose() }
}
function Start-PhoneChild($Bootstrap) {
    Assert-That ($null -eq $script:child)
    $script:child=[Diagnostics.Process]::new(); $script:child.StartInfo=New-NodeStartInfo serve
    try {
        $null=$script:child.Start(); $script:started=$true
        $script:errorDrain=$script:child.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $payload=ConvertTo-Json -InputObject $Bootstrap -Compress -Depth 8
        $script:child.StandardInput.WriteLine($payload); $script:child.StandardInput.Flush()
        # Keep stdin open for the lifetime of the window. Parent death => EOF => child hard stop.
        $script:read=$script:child.StandardOutput.ReadLineAsync(); $script:sessionClock=[Diagnostics.Stopwatch]::StartNew()
    } catch { Stop-PhoneChild; throw 'PHONE_CHILD_START_FAILED' }
    finally { $payload=$null; $Bootstrap=$null }
}
function Stop-PhoneChild {
    if ($null -ne $script:child) {
        Stop-ProcessSafely $script:child
        try { if ($null -ne $script:errorDrain -and $script:errorDrain.IsCompleted) { $null=$script:errorDrain.GetAwaiter().GetResult() } } catch {}
        $script:child.Dispose(); $script:child=$null
    }
    $script:read=$null; $script:errorDrain=$null
    if ($null -ne $script:sessionClock) { $script:sessionClock.Stop() }
}
function Close-PhoneSession($Timer) {
    if ($null -ne $Timer) { $Timer.Stop() }
    Stop-PhoneChild
}
function Assert-ServeFrame($Frame,$Snapshot,$Scope,[string]$Fingerprint) {
    switch -CaseSensitive ($Frame.event) {
        'PHONE_PROXY_READY' {
            Assert-Fields $Frame @('event','endpoint','certificateSha256','bindAddress','allowedClientAddress','port','sessionId','sessionExpiresAt','policyExpiresAt','limits','budget','ledgerId')
            Assert-That (-not $script:ready -and -not $script:terminal -and $Frame.endpoint -ceq "https://$($Scope.BindAddress):$Port/translate" -and
                $Frame.certificateSha256 -ceq $Fingerprint -and $Frame.bindAddress -ceq $Scope.BindAddress -and
                $Frame.allowedClientAddress -ceq $Scope.AllowedClientAddress -and (Test-Int $Frame.port $Port $Port) -and $Frame.ledgerId -ceq $Snapshot.ledgerId -and
                $Frame.sessionId -is [string] -and $Frame.sessionId -cmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -and $Frame.policyExpiresAt -ceq $Snapshot.policyExpiresAt)
            Assert-IsoDate $Frame.sessionExpiresAt; Assert-Limits $Frame.limits; Assert-Budget $Frame.budget
            $expiry=[DateTimeOffset]::Parse($Frame.sessionExpiresAt)
            Assert-That ($expiry -gt [DateTimeOffset]::UtcNow -and $expiry -le [DateTimeOffset]::UtcNow.AddHours(2).AddSeconds(10))
            foreach ($name in @('attempts','reservedMicroCny','remainingAttempts','remainingReserveMicroCny')) { Assert-That ($Frame.budget[$name] -ceq $Snapshot.budget[$name]) }
            $script:ready=$true
        }
        'PHONE_PROXY_BUDGET' {
            Assert-Fields $Frame @('event','ledgerId','budget') @('usage','estimatedPeakCostMicroCny')
            Assert-That ($script:ready -and -not $script:terminal -and $Frame.ledgerId -ceq $Snapshot.ledgerId)
            Assert-Budget $Frame.budget
            if ($Frame.Contains('usage')) {
                Assert-Fields $Frame.usage @('promptTokens','completionTokens')
                Assert-That ((Test-Int $Frame.usage.promptTokens 0 32768) -and (Test-Int $Frame.usage.completionTokens 0 4096))
            }
            if ($Frame.Contains('estimatedPeakCostMicroCny')) {
                Assert-That ($Frame.Contains('usage') -and (Test-Int $Frame.estimatedPeakCostMicroCny 0 98304) -and
                    $Frame.estimatedPeakCostMicroCny -eq $Frame.usage.promptTokens*2+$Frame.usage.completionTokens*8)
            }
        }
        'PHONE_PROXY_STOPPED' {
            Assert-Fields $Frame @('event','reason') @('ledgerId','budget')
            Assert-That (-not $script:terminal -and $Frame.reason -cin @('USER_STOP','PARENT_EOF','SESSION_EXPIRED','INTERRUPTED','SERVER_ERROR','START_FAILED','INPUT_INVALID','INPUT_TIMEOUT'))
            if ($Frame.Contains('ledgerId')) { Assert-That ($Frame.ledgerId -ceq $Snapshot.ledgerId) }
            if ($Frame.Contains('budget')) { Assert-Budget $Frame.budget }
            $script:terminal=$true
        }
        'PHONE_PROXY_FAILED' {
            Assert-Fields $Frame @('event','reason')
            Assert-That ($Frame.reason -cin @('GATE_FAILED','INPUT_OR_START_FAILED'))
            throw 'PHONE_CHILD_SAFE_FAILURE'
        }
        default { throw 'PHONE_CHILD_UNKNOWN_OUTPUT' }
    }
}
function Get-FirewallReviewText($Scope) {
    # This is a public scope description only. No firewall mutation, UAC, or global Node permission.
    return "防火墙审阅范围（未执行）：入站 TCP $Port；程序为当前核验的 Node 可执行文件；本地 $($Scope.BindAddress)；远端仅手机 $($Scope.AllowedClientAddress)；Wi-Fi 接口 #$($Scope.InterfaceIndex)。如系统要求允许 Node 访问所有网络，请取消，另行确认窄规则。"
}
function Show-PhoneProxy($Scope,$Before) {
    $form=[Windows.Forms.Form]::new(); $timer=[Windows.Forms.Timer]::new()
    $keyBox=[Windows.Forms.TextBox]::new(); $tokenBox=[Windows.Forms.TextBox]::new()
    $state=@{certificate=$null;snapshot=$Before;scope=$Scope;failure=$false;inputDeadline=[DateTimeOffset]::UtcNow.AddMinutes(5);lastBudget=$Before.budget}
    try {
        $form.Text='DeepSeek 本人手机临时 HTTPS 代理'; $form.Width=850; $form.Height=680; $form.StartPosition='CenterScreen'
        $intro=[Windows.Forms.Label]::new(); $intro.SetBounds(16,12,800,95)
        $intro.Text="只在电脑输入官方 DeepSeek API Key 和既有个人代理访问凭证（可从本人密码管理器粘贴）。两个字段均掩码，不生成或更换凭证。手机仅填写 URL、证书指纹和既有个人访问凭证。`r`n独立新预算 ¥3、最多20次中文尝试，每次≤1000 Unicode码点；失败/手动重试占次数，无自动重试。会话最多2小时；重启不重置预算。纯英文不调用。"
        $keyLabel=[Windows.Forms.Label]::new(); $keyLabel.SetBounds(16,112,800,24); $keyLabel.Text='DeepSeek 官方 API Key（服务商密钥，仅电脑）'
        $keyBox.SetBounds(16,140,800,28); $keyBox.UseSystemPasswordChar=$true; $keyBox.MaxLength=512
        $tokenLabel=[Windows.Forms.Label]::new(); $tokenLabel.SetBounds(16,181,800,24); $tokenLabel.Text='既有个人代理访问凭证（32–256位base64url，不是上面的API Key）'
        $tokenBox.SetBounds(16,209,800,28); $tokenBox.UseSystemPasswordChar=$true; $tokenBox.MaxLength=256
        $start=[Windows.Forms.Button]::new(); $start.SetBounds(16,252,220,36); $start.Text='启动已批准的临时代理'
        $stop=[Windows.Forms.Button]::new(); $stop.SetBounds(250,252,160,36); $stop.Text='停止并关闭'; $stop.Add_Click({$form.Close()})
        $status=[Windows.Forms.TextBox]::new(); $status.SetBounds(16,305,800,300); $status.Multiline=$true; $status.ReadOnly=$true; $status.ScrollBars='Vertical'
        $status.Text=(Get-FirewallReviewText $Scope)+"`r`n当前累计尝试 $($Before.budget.attempts)/20；预留 $($Before.budget.reservedMicroCny) 微元/3000000。就绪状态不代表服务商 Key 已验证；不会自动发模型请求。"
        $form.Controls.AddRange(@($intro,$keyLabel,$keyBox,$tokenLabel,$tokenBox,$start,$stop,$status))
        $start.Add_Click({
            $bootstrap=$null; $key=$null; $token=$null
            try {
                $script:phase='recheck'; Assert-CurrentScope $state.scope
                $after=Get-PhoneSnapshot; Assert-SnapshotUnchanged $state.snapshot $after
                Assert-That ($after.budget.remainingAttempts -gt 0 -and $after.budget.remainingReserveMicroCny -gt 0)
                $key=$keyBox.Text; $token=$tokenBox.Text; Assert-Credentials $key $token
                $state.certificate=New-MemoryCertificate $state.scope.BindAddress
                $bootstrap=@{event='START_PHONE_PROXY';apiKey=$key;accessToken=$token;bindAddress=$state.scope.BindAddress;
                    allowedClientAddress=$state.scope.AllowedClientAddress;port=$Port;certificatePem=$state.certificate.certificatePem;
                    privateKeyPem=$state.certificate.privateKeyPem;policySha256=$after.policySha256;ledgerId=$after.ledgerId}
                $keyBox.Clear(); $tokenBox.Clear(); $keyBox.Enabled=$false; $tokenBox.Enabled=$false; $start.Enabled=$false
                $script:phase='serving'; Start-PhoneChild $bootstrap
                $status.Text='启动中；尚未证明手机已连接。'+"`r`n"+(Get-FirewallReviewText $state.scope)
            } catch {
                $state.failure=$true; $script:failed=$true; Stop-PhoneChild
                $status.Text='安全停止。未显示原始错误；若已启动则调用情况未知，请先核验同一账本。关闭后检查参数与账本，不要重复初始化。'
                $start.Enabled=$false
            } finally {
                $keyBox.Clear(); $tokenBox.Clear(); $key=$null; $token=$null
                if ($null -ne $bootstrap) { $bootstrap.Clear() }; $bootstrap=$null
                if ($null -ne $state.certificate) { $state.certificate.privateKeyPem=$null; $state.certificate.certificatePem=$null }
            }
        })
        $timer.Interval=100
        $timer.Add_Tick({
            try {
                if (-not $script:started) { if ([DateTimeOffset]::UtcNow -gt $state.inputDeadline) { $form.Close() }; return }
                if ($null -eq $script:child) { return }
                if ($script:sessionClock.Elapsed.TotalHours -ge 2) { Stop-PhoneChild; $status.Text='两小时会话已结束。预算账本保留。'; return }
                Assert-CurrentScope $state.scope
                if (-not $script:ready -and $script:sessionClock.Elapsed.TotalSeconds -gt 20) { throw 'READY_TIMEOUT' }
                if ($script:read.IsCompleted) {
                    $line=$script:read.GetAwaiter().GetResult()
                    if ($null -eq $line) {
                        Assert-That $script:terminal; Stop-PhoneChild; $status.AppendText("`r`n代理已停止；账本保留。"); return
                    }
                    $script:totalOutput+=$line.Length; Assert-That ($script:totalOutput -le 131072)
                    $frame=Convert-SafeFrame $line; $line=$null
                    Assert-ServeFrame $frame $state.snapshot $state.scope $state.certificate.certificateSha256
                    if ($frame.event -ceq 'PHONE_PROXY_READY') {
                        $status.Text="临时 HTTPS 已监听（未验证手机/服务商连接）。`r`nURL：$($frame.endpoint)`r`n证书 SHA-256：$($frame.certificateSha256)`r`n手机只配置上面的公开值与既有个人访问凭证。勿向手机填写 DeepSeek API Key。`r`n会话到期：$($frame.sessionExpiresAt)`r`n"+(Get-FirewallReviewText $state.scope)
                        Write-Output "PHONE_PROXY_READY URL=$($frame.endpoint) CERT_SHA256=$($frame.certificateSha256)" | Out-Host
                    }
                    if ($frame.Contains('budget')) {
                        Assert-That ($frame.budget.attempts -ge $state.lastBudget.attempts -and $frame.budget.reservedMicroCny -ge $state.lastBudget.reservedMicroCny)
                        $state.lastBudget=$frame.budget
                        $status.AppendText("`r`n累计尝试 $($frame.budget.attempts)/20；预算预留 $($frame.budget.reservedMicroCny)/3000000 微元（不等于实际账单）。")
                    }
                    if ($script:terminal) { Stop-PhoneChild; $status.AppendText("`r`n代理已停止；账本保留。"); return }
                    $script:read=$script:child.StandardOutput.ReadLineAsync()
                }
            } catch {
                $state.failure=$true; $script:failed=$true; Stop-PhoneChild
                $status.Text='代理安全停止：协议、进程或网络范围检查未通过。调用数量未知；沿用原账本检查，禁止重新初始化。'
            }
        })
        $form.Add_FormClosing({Close-PhoneSession $timer})
        $form.Add_Shown({$timer.Start(); Write-Output 'PHONE_PROXY_PRIVATE_INPUT_READY NO_MODEL_REQUEST_STARTED' | Out-Host})
        $null=$form.ShowDialog()
    } finally {
        $timer.Stop(); $timer.Dispose(); Stop-PhoneChild; $keyBox.Clear(); $tokenBox.Clear(); $state.Clear(); $form.Dispose()
    }
}

function Invoke-PhoneSelfTest {
    # Synthetic credentials/certificate and child fixtures only; no GUI, real NIC, ledger, model, or firewall access.
    . (Join-Path $PSScriptRoot '../test/launcher-selftest.ps1')
}

try {
    Assert-That ($SelfTest -xor $RunProxy)
    Assert-That ($MyInvocation.InvocationName -cne '.')
    if ($SelfTest) {
        Assert-That (-not ($CnyAccountConfirmed -or $InitializePhoneLedger -or $InterfaceId -or $BindAddress -or $AllowedClientAddress))
        $script:nodePath=(Get-Command node -CommandType Application).Source
        Invoke-PhoneSelfTest
    } else {
        Assert-That ($CnyAccountConfirmed -and $IsWindows -and [Environment]::UserInteractive -and
            [Threading.Thread]::CurrentThread.GetApartmentState() -eq [Threading.ApartmentState]::STA)
        $script:nodePath=(Get-Command node -CommandType Application).Source
        Add-Type -AssemblyName System.Windows.Forms
        $script:phase='network_scope'; $scope=Select-HotspotScope
        $script:phase='preflight'; $before=Get-PhoneSnapshot -Initialize:$InitializePhoneLedger
        Assert-That ($before.budget.remainingAttempts -gt 0 -and $before.budget.remainingReserveMicroCny -gt 0)
        $script:phase='private_input'; Show-PhoneProxy $scope $before
    }
} catch {
    $script:failed=$true
    if ($script:started) { Write-Output "PHONE_PROXY_SAFE_STOP PHASE=$($script:phase) CALL_COUNT_UNKNOWN CHECK_SAME_LEDGER" }
    else { Write-Output "PHONE_PROXY_SAFE_STOP PHASE=$($script:phase) NO_MODEL_REQUEST_STARTED" }
} finally { Stop-PhoneChild; $Error.Clear() }
if ($script:failed) { exit 1 }
