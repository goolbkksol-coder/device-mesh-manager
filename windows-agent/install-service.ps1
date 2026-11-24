# ตรวจสอบสิทธิ์ Administrator
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "กำลังขอสิทธิ์ Administrator (UAC)..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit 0
}

$TaskName = "WslPortMeshAgent"
$ScriptPath = Join-Path $PSScriptRoot "agent.ps1"

Write-Host "กำลังอัปเดตและติดตั้ง Windows Scheduled Task '$TaskName'..." -ForegroundColor Cyan

# หยุดและลบ Task เก่าออกก่อน
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue 2>$null
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue 2>$null

# Action: รัน PowerShell แบบ Hidden
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

# Trigger: รันตอนผู้ใช้ล็อกอิน (At Logon)
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# Settings: ให้รันตลอดเวลา ไม่จำกัดเวลา timeout
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

# Principal: รันด้วยสิทธิ์ Highest ของผู้ใช้ปัจจุบัน เพื่อให้เข้าถึง WSL2 และคำสั่ง netsh/firewall ได้พร้อมกัน
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest

# ลงทะเบียน Task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

# สั่งเริ่มการทำงานทันที
Start-ScheduledTask -TaskName $TaskName

Write-Host "✅ ติดตั้งและเริ่มทำงาน Service เรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "Task กำลังทำงานภายใต้ผู้ใช้ $currentUser ด้วยสิทธิ์สูงสุด (Highest Privileges)" -ForegroundColor Gray
