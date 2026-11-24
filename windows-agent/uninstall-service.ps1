$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsPrincipal]::Administrator)
if (-not $isAdmin) {
    Write-Error "กรุณาเปิด PowerShell ด้วยสิทธิ์ Run as Administrator เพื่อถอนการติดตั้ง"
    exit 1
}

$TaskName = "WslPortMeshAgent"

Write-Host "กำลังถอนการติดตั้ง '$TaskName'..." -ForegroundColor Yellow
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "✅ ถอนการติดตั้งเรียบร้อยแล้ว" -ForegroundColor Green
