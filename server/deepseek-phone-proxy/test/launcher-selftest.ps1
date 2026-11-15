# Dot-sourced ONLY inside Invoke-PhoneSelfTest. Uses synthetic data and loopback fixtures.
$script:phase='selftest'
$savedRoot=$script:root
$fixture=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'launcher-child-fixture.mjs'))
$snap=@{event='PHONE_PROXY_CHECK_OK';policySha256=('a'*64);ledgerId='00000000-0000-4000-8000-000000000001';ledgerInitialized=$false;
    limits=@{maxInputCodePoints=1000;maxAttempts=20;maxBudgetMicroCny=3000000};
    budget=@{attempts=2;reservedMicroCny=300000;remainingAttempts=18;remainingReserveMicroCny=2700000};
    policyExpiresAt=[DateTimeOffset]::UtcNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')}
Assert-Check $snap
$same=$snap.Clone(); $same.ledgerInitialized=$true; Assert-SnapshotUnchanged $snap $same
foreach ($field in @('policySha256','ledgerId','policyExpiresAt','budget')) {
    $bad=$snap.Clone()
    switch ($field) {
        policySha256 {$bad[$field]='b'*64}
        ledgerId {$bad[$field]='00000000-0000-4000-8000-000000000003'}
        policyExpiresAt {$bad[$field]=[DateTimeOffset]::UtcNow.AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')}
        budget {$bad[$field]=@{attempts=3;reservedMicroCny=450000;remainingAttempts=17;remainingReserveMicroCny=2550000}}
    }
    $caught=$false; try {Assert-SnapshotUnchanged $snap $bad} catch {$caught=$true}; Assert-That $caught
}
Assert-Credentials 'SYNTHETIC_PROVIDER_KEY' ('SYNTHETIC_PERSONAL_ACCESS_TOKEN_1234567890')
foreach ($pair in @(@('same_credential_with_32_characters_1234','same_credential_with_32_characters_1234'),@('abc',"bad`n"),@("bad`rKey",'SYNTHETIC_PERSONAL_ACCESS_TOKEN_1234567890'))) {
    $caught=$false; try {Assert-Credentials $pair[0] $pair[1]} catch {$caught=$true}; Assert-That $caught
}
# Exercise .NET certificate issuance without a store or private-key file.
$cert=New-MemoryCertificate '127.0.0.1'
$parsed=[Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($cert.certificatePem)
try {
    Assert-That ($cert.certificateSha256 -ceq [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($parsed.RawData)).ToLowerInvariant())
    Assert-That (-not $parsed.HasPrivateKey -and ($parsed.NotAfter.ToUniversalTime()-[DateTime]::UtcNow).TotalHours -le 4.01)
    $bc=@($parsed.Extensions | Where-Object {$_.Oid.Value -ceq '2.5.29.19'})[0]
    Assert-That (-not ([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($bc,$bc.Critical)).CertificateAuthority)
    $san=@($parsed.Extensions | Where-Object {$_.Oid.Value -ceq '2.5.29.17'})[0]
    # DER 30 06 87 04 7f 00 00 01 = single iPAddress SAN 127.0.0.1.
    Assert-That ([Convert]::ToHexString($san.RawData) -ceq '300687047F000001')
    $eku=@($parsed.Extensions | Where-Object {$_.Oid.Value -ceq '2.5.29.37'})[0]
    $ekuParsed=[Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku,$eku.Critical)
    Assert-That ($ekuParsed.EnhancedKeyUsages.Count -eq 1 -and $ekuParsed.EnhancedKeyUsages[0].Value -ceq '1.3.6.1.5.5.7.3.1')
    $pair=[Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($cert.certificatePem,$cert.privateKeyPem)
    try {Assert-That $pair.HasPrivateKey} finally {$pair.Dispose()}
} finally {$parsed.Dispose();$cert.privateKeyPem=$null;$cert.certificatePem=$null;$cert=$null}
Assert-That (Test-PrivateIPv4 ([Net.IPAddress]::Parse('10.251.239.59')))
Assert-That (Test-SameSubnet ([Net.IPAddress]::Parse('10.251.239.59')) ([Net.IPAddress]::Parse('10.251.239.220')) ([Net.IPAddress]::Parse('255.255.255.0')))
Assert-That (-not (Test-PrivateIPv4 ([Net.IPAddress]::Parse('8.8.8.8'))))
Assert-That (-not (Test-SameSubnet ([Net.IPAddress]::Parse('192.168.1.2')) ([Net.IPAddress]::Parse('192.168.2.1')) ([Net.IPAddress]::Parse('255.255.255.0'))))
$startInfo=New-NodeStartInfo serve
Assert-That ($startInfo.CreateNoWindow -and $startInfo.RedirectStandardInput -and -not $startInfo.ArgumentList.Contains('--initialize-ledger'))
Assert-That (-not $startInfo.Environment.ContainsKey('NODE_OPTIONS') -and -not $startInfo.Environment.ContainsKey('DEEPSEEK_API_KEY'))
Assert-That ((New-NodeStartInfo check -Initialize).ArgumentList.Contains('--initialize-ledger'))

# Override process construction only, retaining real subprocess/drain/read/stop routines.
function New-NodeStartInfo {
    param($Mode,[switch]$Initialize)
    $s=[Diagnostics.ProcessStartInfo]::new();$s.FileName=$script:nodePath;$s.UseShellExecute=$false;$s.CreateNoWindow=$true
    $s.RedirectStandardInput=$true;$s.RedirectStandardOutput=$true;$s.RedirectStandardError=$true
    foreach ($arg in @($fixture,$fixtureMode)) {$s.ArgumentList.Add($arg)}
    foreach ($name in @($s.Environment.Keys)) {if($name -match '(?i)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|NODE_OPTIONS|NODE_DEBUG|NODE_V8_COVERAGE)'){$null=$s.Environment.Remove($name)}}
    return $s
}
foreach ($fixtureMode in @('check-existing','check-init')) {
    $items=@(Get-PhoneSnapshot -Initialize:($fixtureMode -ceq 'check-init'))
    Assert-That ($items.Count -eq 1 -and $items[0] -is [Collections.IDictionary])
    Assert-That ($items[0].ledgerInitialized -eq ($fixtureMode -ceq 'check-init'))
}
$fixtureMode='check-extra';$caught=$false
try {$null=Get-PhoneSnapshot} catch {$caught=$true}; Assert-That $caught
$scope=@{BindAddress='127.0.0.1';AllowedClientAddress='127.0.0.1';InterfaceIndex=1;InterfaceId='synthetic'}
$bootstrap=@{event='START_PHONE_PROXY';apiKey='SYNTHETIC_PROVIDER_KEY';accessToken='SYNTHETIC_PERSONAL_ACCESS_TOKEN_1234567890';
    privateKeyPem='SYNTHETIC_PRIVATE_KEY';certificatePem='SYNTHETIC_PUBLIC_CERT';policySha256=$snap.policySha256;ledgerId=$snap.ledgerId;
    bindAddress='127.0.0.1';allowedClientAddress='127.0.0.1';port=$Port;policyExpiresAt=$snap.policyExpiresAt}
foreach ($fixtureMode in @('serve','raw','eof')) {
    $script:ready=$false;$script:terminal=$false;$script:started=$false
    Start-PhoneChild $bootstrap
    try {
        Assert-That ($script:read.Wait(3000));$line=$script:read.GetAwaiter().GetResult()
        if($fixtureMode -ceq 'raw') {
            $caught=$false;try {$null=Convert-SafeFrame $line} catch {$caught=$true};Assert-That $caught
            $p=$script:child;Stop-PhoneChild;Assert-That ($null -eq $script:child)
        } else {
            $frame=Convert-SafeFrame $line;Assert-ServeFrame $frame $snap $scope ('b'*64)
            Assert-That (-not $script:child.HasExited) # stdin remains open after bootstrap.
            if($fixtureMode -ceq 'eof') {
                $script:child.StandardInput.Close();Assert-That ($script:child.WaitForExit(3000))
            } else {
                $script:child.StandardInput.WriteLine('{"event":"STOP_PHONE_PROXY"}');$script:child.StandardInput.Flush()
                $terminalRead=$script:child.StandardOutput.ReadLineAsync();Assert-That ($terminalRead.Wait(3000))
                Assert-ServeFrame (Convert-SafeFrame $terminalRead.GetAwaiter().GetResult()) $snap $scope ('b'*64)
                Assert-That ($script:terminal -and $script:child.WaitForExit(3000))
            }
        }
    } finally {$line=$null;Stop-PhoneChild}
}
$bootstrap.Clear();$script:started=$false;$script:ready=$false;$script:terminal=$false
# Actual TLS listener exists only on loopback with fake provider credentials and no model module.
$allocator=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$allocator.Start();$Port=$allocator.LocalEndpoint.Port;$allocator.Stop()
foreach($shutdown in @('stop','eof','form-close')) {
    $fixtureMode='tls';$cert=New-MemoryCertificate '127.0.0.1'
    $bootstrap=@{event='START_PHONE_PROXY';apiKey='SYNTHETIC_PROVIDER_KEY';accessToken='SYNTHETIC_PERSONAL_ACCESS_TOKEN_1234567890';
        privateKeyPem=$cert.privateKeyPem;certificatePem=$cert.certificatePem;policySha256=$snap.policySha256;ledgerId=$snap.ledgerId;
        bindAddress='127.0.0.1';allowedClientAddress='127.0.0.1';port=$Port;policyExpiresAt=$snap.policyExpiresAt}
    $script:ready=$false;$script:terminal=$false
    Start-PhoneChild $bootstrap;$bootstrap.Clear();$cert.privateKeyPem=$null;$cert.certificatePem=$null
    try {
        Assert-That ($script:read.Wait(5000));Assert-ServeFrame (Convert-SafeFrame $script:read.GetAwaiter().GetResult()) $snap $scope $cert.certificateSha256
        $active=[Net.Sockets.TcpClient]::new();$active.Connect('127.0.0.1',$Port)
        if($shutdown -ceq 'eof') {$script:child.StandardInput.Close();Assert-That ($script:child.WaitForExit(3000))}
        elseif($shutdown -ceq 'form-close') {Close-PhoneSession $null}
        else {Stop-PhoneChild}
        $probe=[Net.Sockets.TcpClient]::new();$closed=$false
        try{$probe.Connect('127.0.0.1',$Port)}catch{$closed=$true}finally{$probe.Dispose();$active.Dispose()}
        Assert-That $closed
    } finally {Stop-PhoneChild;$cert=$null}
}
$script:started=$false;$script:ready=$false;$script:terminal=$false
foreach ($reason in @('INPUT_INVALID','INPUT_TIMEOUT')) {
    $script:terminal=$false
    Assert-ServeFrame @{event='PHONE_PROXY_STOPPED';reason=$reason} $snap $scope ('b'*64)
    Assert-That $script:terminal
}
$script:terminal=$false
foreach ($hostile in @(@{event='UNKNOWN';raw='SYNTHETIC_PRIVATE'},@{event='PHONE_PROXY_STOPPED';reason='SYNTHETIC_PRIVATE'},
    @{event='PHONE_PROXY_BUDGET';ledgerId=$snap.ledgerId;budget=$snap.budget;translation='SYNTHETIC_PRIVATE'})) {
    $caught=$false;try{Assert-ServeFrame $hostile $snap $scope ('b'*64)}catch{$caught=$true};Assert-That $caught
}
# Guard the exact registered close path without opening or displaying any form.
$launcherSource=Get-Content -Raw (Join-Path $savedRoot 'tools/start-phone-proxy.ps1')
Assert-That ($launcherSource.Contains('$form.Add_FormClosing({Close-PhoneSession $timer})'))
Assert-That (-not ($launcherSource -cmatch '(?m)^\s*(?:New-NetFirewallRule|Set-NetFirewall|Import-Certificate|Set-Clipboard|Get-Clipboard)\b'))
Write-Output 'PHONE_PROXY_LAUNCHER_SELFTEST_OK SYNTHETIC_ONLY MEMORY_CERT_SAN_EKU_SHA256 LOOPBACK_TLS_STOP_EOF STDIN_RETAINED UNKNOWN_OUTPUT_REJECTED SINGLE_CHECK_FRAME NO_GUI_NO_MODEL_NO_LEDGER_NO_FIREWALL'
