# 🌐 Device & Port Mesh Manager

ระบบรวม IP ทุกเครื่อง และควบคุมการเปิด/ปิด/Forward Port จาก Windows สู่ WSL2 ผ่าน Cloudflare Worker และหน้าเว็บแบบ Realtime

## 📁 โครงสร้างโปรเจกต์
- `worker/` - โค้ด Cloudflare Worker และ KV Binding
- `windows-agent/` - สคริปต์ PowerShell สำหรับรันเป็น Windows Service
- `.github/workflows/` - CI/CD Auto-deploy สู่ Cloudflare เมื่อ Git Push

## 🚀 วิธีติดตั้ง Windows Service
เปิด PowerShell ด้วย **Run as Administrator** แล้วรัน:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\windows-agent\install-service.ps1
```

## 🔐 ข้อมูลเชื่อมต่อ
- Web Dashboard: `https://ip-status-board.gool-bkksol.workers.dev/?pass=view-1234`
- Update Key: `upd-9876`
- View Key: `view-1234`
