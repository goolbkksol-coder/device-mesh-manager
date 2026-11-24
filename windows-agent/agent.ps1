param (
    [switch]$Once = $false
)

$WORKER_URL = "https://ip-status-board.gool-bkksol.workers.dev/api/heartbeat"
$UPDATE_KEY = "upd-9876"
$DEVICE_NAME = $env:COMPUTERNAME

function Get-WslNetworkInfo {
    $info = @{ wslIp = "-"; tailscaleIp = "-" }
    try {
        $rawWsl = wsl.exe -d Ubuntu -e hostname -I 2>$null
        if (-not $rawWsl) { $rawWsl = wsl.exe -e hostname -I 2>$null }
        if ($rawWsl) {
            foreach ($t in ($rawWsl.Trim() -split '\s+')) {
                if ($t -match '^100\.\d+\.\d+\.\d+$') { $info.tailscaleIp = $t }
                elseif ($t -match '^\d+\.\d+\.\d+\.\d+$' -and $info.wslIp -eq "-") { $info.wslIp = $t }
            }
        }
        if ($info.tailscaleIp -eq "-") {
            $ts = wsl.exe -d Ubuntu -e /usr/bin/tailscale ip -4 2>$null
            if ($ts -match '^\d+\.\d+\.\d+\.\d+$') { $info.tailscaleIp = $ts.Trim() }
        }
    } catch {}
    return $info
}

function Get-LanIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 2>$null | Where-Object {
            $_.InterfaceAlias -notmatch 'vEthernet|Loopback' -and
            $_.IPAddress -notmatch '^169\.254\.|^127\.'
        } | Select-Object -First 1).IPAddress
        return if ($ip) { $ip } else { "-" }
    } catch { return "-" }
}

function Get-PortProxyPorts {
    # ดึง port ที่ portproxy กำลัง forward อยู่จริง (Active)
    $ports = @()
    try {
        $lines = (netsh interface portproxy show v4tov4 2>$null) -join "`n"
        foreach ($line in ($lines -split "`n")) {
            if ($line -match '^\s*[\d\*]+\s+(\d+)\s+') { $ports += [int]$matches[1] }
        }
    } catch {}
    return $ports
}

function Get-FirewallAllowedPorts {
    # ดึง port ที่ Firewall อนุญาต (WSL_PORT_* rules)
    $ports = @()
    try {
        $rules = Get-NetFirewallRule -DisplayName "WSL_PORT_*" -Enabled True 2>$null
        foreach ($r in $rules) {
            $pf = $r | Get-NetFirewallPortFilter 2>$null
            if ($pf -and $pf.LocalPort -match '^\d+$') {
                $ports += [int]$pf.LocalPort
            }
        }
    } catch {}
    return $ports
}

function Open-WslPort($port, $wslIp) {
    if (-not $port) { return }
    $target = if ($wslIp -and $wslIp -ne "-") { $wslIp } else { "127.0.0.1" }
    Write-Host "[+] เปิด Port $port -> $target" -ForegroundColor Green
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$target connectport=$port
    netsh advfirewall firewall delete rule name="WSL_PORT_$port" 2>$null
    netsh advfirewall firewall add rule name="WSL_PORT_$port" dir=in action=allow protocol=TCP localport=$port 2>$null
}

function Close-WslPort($port) {
    if (-not $port) { return }
    Write-Host "[-] ปิด Port $port" -ForegroundColor Red
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null
    netsh advfirewall firewall delete rule name="WSL_PORT_$port" 2>$null
}

function Step-Agent {
    $net = Get-WslNetworkInfo
    $lan = Get-LanIp
    $activePorts   = @(Get-PortProxyPorts)
    $allowedPorts  = @(Get-FirewallAllowedPorts)

    $payload = @{
        device       = $DEVICE_NAME
        lanIp        = $lan
        wslIp        = $net.wslIp
        tailscaleIp  = $net.tailscaleIp
        activePorts  = $activePorts
        allowedPorts = $allowedPorts
    } | ConvertTo-Json

    try {
        $res = Invoke-RestMethod -Uri $WORKER_URL -Method POST `
            -Headers @{ "x-update-key" = $UPDATE_KEY } `
            -Body $payload -ContentType "application/json" -TimeoutSec 5

        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Heartbeat OK | WSL=$($net.wslIp) TS=$($net.tailscaleIp) | Active=[$($activePorts -join ',')] Allowed=[$($allowedPorts -join ',')]" -ForegroundColor Cyan

        if ($res.command) {
            $cmd = $res.command
            Write-Host ">> CMD: $($cmd.action) port $($cmd.port)" -ForegroundColor Yellow
            if ($cmd.action -eq "OPEN")  { Open-WslPort  $cmd.port $net.wslIp }
            elseif ($cmd.action -eq "CLOSE") { Close-WslPort $cmd.port }
        }
    } catch {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Error: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

if ($Once) { Step-Agent; exit 0 }

Write-Host "Windows Agent starting for $DEVICE_NAME ..." -ForegroundColor Green
while ($true) { Step-Agent; Start-Sleep -Seconds 10 }
