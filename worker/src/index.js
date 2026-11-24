export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Windows Agent Check-in & รับคำสั่ง (Heartbeat)
    if (request.method === "POST" && url.pathname === "/api/heartbeat") {
      const key = request.headers.get("x-update-key");
      if (key !== env.UPDATE_KEY) return new Response("Unauthorized", { status: 401 });

      const data = await request.json().catch(() => ({}));
      const device = String(data.device || "windows-host").replace(/[^a-zA-Z0-9_-]/g, "");

      // ดึงคำสั่งที่ค้างอยู่ (Pending Commands) ถ้ามี
      let pendingCmd = null;
      if (env.IP_STORE) {
        const cmdRaw = await env.IP_STORE.get(`cmd:${device}`);
        pendingCmd = cmdRaw ? JSON.parse(cmdRaw) : null;
        if (pendingCmd) {
          // ลบคำสั่งเมื่อส่งให้ Agent รับไปทำแล้ว
          await env.IP_STORE.delete(`cmd:${device}`);
        }

        // บันทึกสถานะเครื่องล่าสุด
        const payload = {
          device,
          publicIp: data.publicIp || request.headers.get("CF-Connecting-IP") || "-",
          lanIp: data.lanIp || "-",
          wslIp: data.wslIp || "-",
          activePorts: Array.isArray(data.activePorts) ? data.activePorts : [],
          updatedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
        };
        await env.IP_STORE.put(`dev:${device}`, JSON.stringify(payload));
      }

      return Response.json({ ok: true, command: pendingCmd });
    }

    // 2. รับคำสั่งเปิด/ปิด/เพิ่ม Port จากหน้าเว็บ
    if (request.method === "POST" && url.pathname === "/api/port-action") {
      const key = request.headers.get("x-view-key");
      if (key !== env.VIEW_KEY) return new Response("Unauthorized", { status: 401 });

      const body = await request.json().catch(() => ({}));
      const { device, action, port } = body; // action: "OPEN" | "CLOSE"
      
      if (!device || !action || !port) {
        return Response.json({ ok: false, error: "ข้อมูลไม่ครบถ้วน" }, { status: 400 });
      }

      if (env.IP_STORE) {
        await env.IP_STORE.put(`cmd:${device}`, JSON.stringify({
          action,
          port: parseInt(port, 10),
          requestedAt: Date.now()
        }));
      }

      return Response.json({ ok: true, message: `ส่งคำสั่ง ${action} port ${port} แล้ว` });
    }

    // 3. หน้า Dashboard (UI สวยงาม พร้อมปุ่มจัดการ Port)
    const pass = url.searchParams.get("pass") || "";
    if (pass !== env.VIEW_KEY) {
      return new Response(loginPage(Boolean(pass)), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    let devices = [];
    if (env.IP_STORE) {
      const list = await env.IP_STORE.list({ prefix: "dev:" });
      devices = await Promise.all(
        list.keys.map(async k => {
          const val = await env.IP_STORE.get(k.name);
          return val ? JSON.parse(val) : null;
        })
      );
    }

    return new Response(dashboardPage(devices.filter(Boolean), env.VIEW_KEY), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

function loginPage(wrong) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Device & Port Manager</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; background: #0f172a; color: #fff; margin: 0; }
    form { background: #1e293b; padding: 32px; border-radius: 12px; width: 320px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h3 { margin-top: 0; color: #38bdf8; }
    input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; margin: 16px 0; box-sizing: border-box; font-size: 15px; }
    button { width: 100%; padding: 12px; background: #0284c7; color: #fff; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 15px; }
    button:hover { background: #0369a1; }
    .err { color: #f87171; font-size: 13px; margin-top: 10px; }
  </style>
</head>
<body>
  <form method="GET">
    <h3>🔐 Device Manager</h3>
    <p style="font-size: 13px; color: #94a3b8;">กรุณาใส่รหัสผ่านเพื่อเข้าสู่ระบบควบคุม</p>
    <input type="password" name="pass" placeholder="ใส่รหัส VIEW_KEY" required autofocus />
    <button type="submit">เข้าสู่แดชบอร์ด</button>
    ${wrong ? '<div class="err">❌ รหัสผ่านไม่ถูกต้อง</div>' : ''}
  </form>
</body>
</html>`;
}

function dashboardPage(devices, viewKey) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Device & Port Manager</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 16px; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
    th { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; background: #0f172a; }
    code { background: #334155; padding: 3px 8px; border-radius: 4px; color: #38bdf8; font-family: monospace; }
    .btn { padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; font-size: 13px; transition: 0.15s; }
    .btn-green { background: #16a34a; color: #fff; }
    .btn-green:hover { background: #15803d; }
    .btn-red { background: #dc2626; color: #fff; }
    .btn-red:hover { background: #b91c1c; }
    input { background: #0f172a; border: 1px solid #334155; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 9999px; font-size: 12px; background: rgba(34,197,94,0.15); color: #4ade80; }
  </style>
</head>
<body>
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px;">
    <h2>📡 รายการเครื่อง & ควบคุม Port (WSL2 / Windows)</h2>
    <button onclick="location.reload()" style="background:#334155; border:none; color:#f8fafc; padding:8px 14px; border-radius:6px; cursor:pointer;">🔄 รีเฟรช</button>
  </div>

  ${devices.length === 0 ? '<div class="card" style="text-align:center; color:#94a3b8;">ยังไม่มีเครื่องส่ง Heartbeat เข้ามา</div>' : ''}

  ${devices.map(d => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 8px;">
        <h3 style="margin:0; color:#38bdf8; display:flex; align-items:center; gap:8px;">
          💻 ${escapeHtml(d.device)}
          <span class="status-badge">● Online</span>
        </h3>
        <span style="font-size:12px; color:#94a3b8;">อัปเดตล่าสุด: ${escapeHtml(d.updatedAt)}</span>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 18px 0; background: #0f172a; padding: 14px; border-radius: 8px;">
        <div><small style="color:#94a3b8;">Public IP</small><br><code>${escapeHtml(d.publicIp)}</code></div>
        <div><small style="color:#94a3b8;">LAN IP (Windows)</small><br><code>${escapeHtml(d.lanIp)}</code></div>
        <div><small style="color:#94a3b8;">WSL2 IP</small><br><code>${escapeHtml(d.wslIp)}</code></div>
      </div>

      <h4 style="margin: 16px 0 8px 0;">🔌 รายการ Port ที่ Forward สู่ WSL2:</h4>
      <table>
        <thead>
          <tr>
            <th>Port</th>
            <th>ปลายทาง (Target)</th>
            <th>สถานะ</th>
            <th>การทำงาน</th>
          </tr>
        </thead>
        <tbody>
          ${(d.activePorts || []).map(p => `
            <tr>
              <td><b>${p}</b></td>
              <td><code>${escapeHtml(d.wslIp)}:${p}</code></td>
              <td><span style="color:#4ade80;">● กำลังเปิด</span></td>
              <td>
                <button class="btn btn-red" onclick="sendAction('${escapeHtml(d.device)}', 'CLOSE', ${p})">ปิด Port</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="4" style="color:#94a3b8; text-align:center; padding: 16px;">ยังไม่มี Port ที่เปิดใช้งาน</td></tr>'}
        </tbody>
      </table>

      <div style="margin-top: 18px; display:flex; gap: 10px; align-items:center; flex-wrap:wrap;">
        <input type="number" id="newPort-${escapeHtml(d.device)}" placeholder="ระบุพอร์ต เช่น 3000, 8080" style="width: 220px;" min="1" max="65535">
        <button class="btn btn-green" onclick="addPort('${escapeHtml(d.device)}')">+ สั่งเปิด Port นี้</button>
      </div>
    </div>
  `).join('')}

  <script>
    async function sendAction(device, action, port) {
      if (!confirm('ยืนยัน ' + action + ' port ' + port + '?')) return;
      try {
        const res = await fetch('/api/port-action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-view-key': '${viewKey}'
          },
          body: JSON.stringify({ device, action, port })
        });
        const data = await res.json();
        alert(data.message + '\\n(ระบบ Agent ใน Windows จะซิงค์ภายใน 10 วินาที)');
      } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
      }
    }

    function addPort(device) {
      const input = document.getElementById('newPort-' + device);
      const port = input.value.trim();
      if (!port) return alert('กรุณากรอกหมายเลข Port');
      sendAction(device, 'OPEN', parseInt(port, 10));
      input.value = '';
    }
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
