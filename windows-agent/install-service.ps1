# ตรวจสอบสิทธิ์ Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsPrincipal]::Administrator)
if (-not $isAdmin) {
    Write-Error "กรุณาเปิด PowerShell ด้วยสิทธิ์ Run as Administrator เพื่อติดตั้ง Service"
    exit 1
}

$TaskName = "WslPortMeshAgent"
$ScriptPath = Join-Path $PSScriptRoot "agent.ps1"

Write-Host "กำลังติดตั้ง Windows Scheduled Task '$TaskName'..." -ForegroundColor Cyan

# Action: รัน PowerShell แบบ Hidden
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

# Trigger: รันตอนเปิดเครื่อง Windows (At Startup)
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: ให้รันตลอดเวลา ไม่จำกัดเวลา timeout
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0

# Principal: รันด้วยสิทธิ์ SYSTEM สูงสุด เพื่อให้สามารถจัดการ netsh และ firewall ได้
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# ลงทะเบียน Task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

# สั่งเริ่มการทำงานทันที
Start-ScheduledTask -TaskName $TaskName

Write-Host "✅ ติดตั้งและเริ่มทำงาน Service เรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "Service จะเริ่มทำงานอัตโนมัติทุกครั้งที่เปิดเครื่อง Windows" -ForegroundColor Gray
