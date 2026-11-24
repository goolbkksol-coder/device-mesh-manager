param (
    [switch]$Once = $false
)

# ==========================================
# Windows Agent for Device & Port Management
# ==========================================
$WORKER_URL = "https://ip-status-board.gool-bkksol.workers.dev/api/heartbeat"
$UPDATE_KEY = "upd-9876"
$DEVICE_NAME = $env:COMPUTERNAME

function Get-WslNetworkInfo {
    $info = @{
        wslIp       = "-"
        tailscaleIp = "-"
    }

    try {
        # 1. ลองดึงผ่าน wsl command
        $rawWsl = wsl.exe -d Ubuntu -e hostname -I 2>$null
        if (-not $rawWsl) {
            $rawWsl = wsl.exe -e hostname -I 2>$null
        }

        if ($rawWsl) {
            $tokens = ($rawWsl.Trim() -split '\s+')
            foreach ($t in $tokens) {
                if ($t -match '^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
                    $info.tailscaleIp = $t
                } elseif ($t -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' -and $info.wslIp -eq "-") {
                    $info.wslIp = $t
                }
            }
        }

        # 2. ตรวจสอบ Tailscale IP เพิ่มเติมถ้ายังไม่ได้
        if ($info.tailscaleIp -eq "-") {
            $ts = wsl.exe -d Ubuntu -e /usr/bin/tailscale ip -4 2>$null
            if ($ts -and $ts -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
                $info.tailscaleIp = $ts.Trim()
            }
        }
    } catch {}

    return $info
}

function Get-LanIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 2>$null | Where-Object {
            $_.InterfaceAlias -notmatch 'vEthernet' -and
            $_.InterfaceAlias -notmatch 'Loopback' -and
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
    if (-not $port) { return }
    $targetIp = if ($wslIp -and $wslIp -ne "-") { $wslIp } else { "127.0.0.1" }
    Write-Host "[+] เปิด Port: $port -> Target ($targetIp)" -ForegroundColor Green

    # 1. ผูก Port Proxy (ข้ามไป WSL2 หรือ Localhost ในกรณี Mirrored Mode)
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$targetIp connectport=$port

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
    $netInfo = Get-WslNetworkInfo
    $lanIp = Get-LanIp
    $activePorts = Get-ActivePortProxies

    $payload = @{
        device      = $DEVICE_NAME
        lanIp       = $lanIp
        wslIp       = $netInfo.wslIp
        tailscaleIp = $netInfo.tailscaleIp
        activePorts = $activePorts
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $WORKER_URL -Method POST -Headers @{ "x-update-key" = $UPDATE_KEY } -Body $payload -ContentType "application/json" -TimeoutSec 5
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Heartbeat Sent (WSL: $($netInfo.wslIp), Tailscale: $($netInfo.tailscaleIp), Ports: $($activePorts -join ','))" -ForegroundColor Cyan

        if ($response.command) {
            $cmd = $response.command
            Write-Host "ได้รับคำสั่ง: $($cmd.action) Port: $($cmd.port)" -ForegroundColor Yellow
            if ($cmd.action -eq "OPEN") {
                Open-WslPort -port $cmd.port -wslIp $netInfo.wslIp
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
