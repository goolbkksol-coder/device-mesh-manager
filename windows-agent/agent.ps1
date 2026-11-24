param (
    [switch]$Once = $false
)

# ==========================================
# Windows Agent for Device & Port Management
# ==========================================
$WORKER_URL = "https://ip-status-board.gool-bkksol.workers.dev/api/heartbeat"
$UPDATE_KEY = "upd-9876"
$DEVICE_NAME = $env:COMPUTERNAME

function Get-WslIp {
    try {
        $raw = wsl -e hostname -I 2>$null
        if ($raw) {
            $ips = $raw.Trim() -split '\s+'
            foreach ($ip in $ips) {
                if ($ip -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
                    return $ip
                }
            }
        }
    } catch {}
    return ""
}

function Get-LanIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 2>$null | Where-Object {
            $_.InterfaceAlias -notmatch 'vEthernet' -and
            $_.IPAddress -notmatch '^169\.254\.' -and
            $_.IPAddress -notmatch '^127\.'
        } | Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}
    return "-"
}

function Get-ActivePortProxies {
    $ports = @()
    try {
        $output = netsh interface portproxy show v4tov4 2>$null
        foreach ($line in $output) {
            if ($line -match '^\s*(\*|0\.0\.0\.0)\s+(\d+)\s+') {
                $ports += [int]$matches[2]
            }
        }
    } catch {}
    return $ports
}

function Open-WslPort($port, $wslIp) {
    if (-not $port -or -not $wslIp) { return }
    Write-Host "[+] เปิด Port: $port -> WSL ($wslIp)" -ForegroundColor Green

    # 1. ผูก Port Proxy
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$wslIp connectport=$port

    # 2. เปิด Firewall Rule
    netsh advfirewall firewall delete rule name="WSL_PORT_$port" 2>$null
    netsh advfirewall firewall add rule name="WSL_PORT_$port" dir=in action=allow protocol=TCP localport=$port 2>$null
}

function Close-WslPort($port) {
    if (-not $port) { return }
    Write-Host "[-] ปิด Port: $port" -ForegroundColor Red
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null
    netsh advfirewall firewall delete rule name="WSL_PORT_$port" 2>$null
}

function Step-Agent {
    $wslIp = Get-WslIp
    $lanIp = Get-LanIp
    $activePorts = Get-ActivePortProxies

    $payload = @{
        device      = $DEVICE_NAME
        lanIp       = $lanIp
        wslIp       = $wslIp
        activePorts = $activePorts
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $WORKER_URL -Method POST -Headers @{ "x-update-key" = $UPDATE_KEY } -Body $payload -ContentType "application/json" -TimeoutSec 5
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Heartbeat Sent (Active Ports: $($activePorts -join ','))" -ForegroundColor Cyan

        if ($response.command) {
            $cmd = $response.command
            Write-Host "ได้รับคำสั่ง: $($cmd.action) Port: $($cmd.port)" -ForegroundColor Yellow
            if ($cmd.action -eq "OPEN" -and $wslIp) {
                Open-WslPort -port $cmd.port -wslIp $wslIp
            } elseif ($cmd.action -eq "CLOSE") {
                Close-WslPort -port $cmd.port
            }
        }
    } catch {
        Write-Host "Heartbeat error: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

if ($Once) {
    Step-Agent
    exit 0
}

Write-Host "Starting Windows Agent for $DEVICE_NAME..." -ForegroundColor Green
while ($true) {
    Step-Agent
    Start-Sleep -Seconds 10
}
