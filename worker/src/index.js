export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/heartbeat") {
      const key = request.headers.get("x-update-key");
      if (key !== env.UPDATE_KEY) return new Response("Unauthorized", { status: 401 });

      const data = await request.json().catch(() => ({}));
      const device = String(data.device || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");

      let pendingCmd = null;
      if (env.IP_STORE) {
        const cmdRaw = await env.IP_STORE.get(`cmd:${device}`);
        pendingCmd = cmdRaw ? JSON.parse(cmdRaw) : null;
        if (pendingCmd) await env.IP_STORE.delete(`cmd:${device}`);

        const payload = {
          device,
          publicIp: request.headers.get("CF-Connecting-IP") || "-",
          lanIp: data.lanIp || "-",
          wslIp: data.wslIp || "-",
          tailscaleIp: data.tailscaleIp || "-",
          activePorts:  Array.isArray(data.activePorts)  ? data.activePorts  : [],
          allowedPorts: Array.isArray(data.allowedPorts) ? data.allowedPorts : [],
          updatedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
        };
        await env.IP_STORE.put(`dev:${device}`, JSON.stringify(payload));
      }
      return Response.json({ ok: true, command: pendingCmd });
    }

    if (request.method === "POST" && url.pathname === "/api/port-action") {
      const key = request.headers.get("x-view-key");
      if (key !== env.VIEW_KEY) return new Response("Unauthorized", { status: 401 });
      const { device, action, port } = await request.json().catch(() => ({}));
      if (!device || !action || !port) return Response.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
      if (env.IP_STORE) await env.IP_STORE.put(`cmd:${device}`, JSON.stringify({ action, port: parseInt(port), requestedAt: Date.now() }));
      return Response.json({ ok: true, message: `ส่งคำสั่ง ${action} port ${port} ไปแล้ว (Agent จะดำเนินการใน ~10 วินาที)` });
    }

    const pass = url.searchParams.get("pass") || "";
    if (pass !== env.VIEW_KEY) {
      return new Response(loginPage(Boolean(pass)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    let devices = [];
    if (env.IP_STORE) {
      const list = await env.IP_STORE.list({ prefix: "dev:" });
      devices = (await Promise.all(list.keys.map(async k => {
        const v = await env.IP_STORE.get(k.name); return v ? JSON.parse(v) : null;
      }))).filter(Boolean);
    }

    return new Response(dashboardPage(devices, env.VIEW_KEY), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};

function loginPage(wrong) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Device Manager</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;background:#0f172a;color:#fff;margin:0}form{background:#1e293b;padding:32px;border-radius:12px;width:320px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,.5)}h3{margin-top:0;color:#38bdf8}input{width:100%;padding:12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#fff;margin:16px 0;box-sizing:border-box;font-size:15px}button{width:100%;padding:12px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:15px}.err{color:#f87171;font-size:13px;margin-top:10px}</style>
</head><body><form method="GET"><h3>🔐 Device Manager</h3><p style="font-size:13px;color:#94a3b8">กรุณาใส่รหัสผ่าน</p><input type="password" name="pass" placeholder="VIEW_KEY" required autofocus/><button type="submit">เข้าสู่แดชบอร์ด</button>${wrong ? '<div class="err">❌ รหัสผ่านไม่ถูกต้อง</div>' : ''}</form></body></html>`;
}

function dashboardPage(devices, viewKey) {
  const E = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const deviceCards = devices.map(d => {
    const activePorts  = d.activePorts  || [];
    const allowedPorts = d.allowedPorts || [];
    // รวม unique ports ทั้งสองชุด
    const allPorts = [...new Set([...activePorts, ...allowedPorts])].sort((a,b) => a-b);

    const portRows = allPorts.map(p => {
      const isActive  = activePorts.includes(p);
      const isAllowed = allowedPorts.includes(p);
      const statusHtml = [
        isActive  ? '<span style="background:rgba(34,197,94,.15);color:#4ade80;padding:2px 8px;border-radius:4px;font-size:12px;">🟢 Forward</span>' : '',
        isAllowed ? '<span style="background:rgba(59,130,246,.15);color:#93c5fd;padding:2px 8px;border-radius:4px;font-size:12px;">🔵 Firewall</span>' : '',
      ].join(' ');
      return `<tr>
        <td><b>${p}</b></td>
        <td><code>${E(d.wslIp)}:${p}</code></td>
        <td>${statusHtml}</td>
        <td><button class="btn btn-red" onclick="sendAction('${E(d.device)}','CLOSE',${p})">ปิด</button></td>
      </tr>`;
    }).join('');

    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;color:#38bdf8;display:flex;align-items:center;gap:8px">💻 ${E(d.device)} <span class="badge">● Online</span></h3>
        <span style="font-size:12px;color:#94a3b8">อัปเดต: ${E(d.updatedAt)}</span>
      </div>
      <div class="ip-grid">
        <div class="ip-box"><small>🌐 Public IP</small><code>${E(d.publicIp)}</code></div>
        <div class="ip-box"><small>🏠 LAN (Windows)</small><code>${E(d.lanIp)}</code></div>
        <div class="ip-box"><small>🛡️ Tailscale</small><code style="color:#4ade80">${E(d.tailscaleIp)}</code></div>
        <div class="ip-box"><small>🐧 WSL2</small><code>${E(d.wslIp)}</code></div>
      </div>

      <div style="display:flex;gap:12px;margin:14px 0 8px;font-size:12px;color:#94a3b8">
        <span>🟢 Forward = portproxy ส่ง traffic จริง</span>
        <span>🔵 Firewall = อนุญาตผ่าน Windows Firewall</span>
      </div>

      <table>
        <thead><tr><th>Port</th><th>ปลายทาง</th><th>สถานะ</th><th>ปิด</th></tr></thead>
        <tbody>${portRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">ยังไม่มี Port ที่จัดการอยู่</td></tr>'}</tbody>
      </table>

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="number" id="p-${E(d.device)}" placeholder="พอร์ต เช่น 3000, 8080" style="width:200px" min="1" max="65535"/>
        <button class="btn btn-green" onclick="addPort('${E(d.device)}')">+ เปิด Port</button>
      </div>
    </div>`;
  }).join('');

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Device & Port Manager</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:30px auto;padding:0 16px;background:#0f172a;color:#f8fafc}
  .card{background:#1e293b;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid #334155}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{padding:11px 14px;text-align:left;border-bottom:1px solid #334155;font-size:14px}
  th{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#0f172a}
  code{background:#334155;padding:3px 8px;border-radius:4px;color:#38bdf8;font-family:monospace}
  .btn{padding:7px 13px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:13px}
  .btn-green{background:#16a34a;color:#fff}.btn-green:hover{background:#15803d}
  .btn-red{background:#dc2626;color:#fff}.btn-red:hover{background:#b91c1c}
  input{background:#0f172a;border:1px solid #334155;color:#fff;padding:8px 12px;border-radius:6px;font-size:14px}
  .badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:9999px;font-size:12px;background:rgba(34,197,94,.15);color:#4ade80}
  .ip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}
  .ip-box{background:#0f172a;padding:12px;border-radius:8px;border:1px solid #334155}
  .ip-box small{color:#94a3b8;display:block;margin-bottom:4px;font-size:12px}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
  <h2>📡 Device & Port Manager</h2>
  <button onclick="location.reload()" style="background:#334155;border:none;color:#f8fafc;padding:8px 14px;border-radius:6px;cursor:pointer">🔄 รีเฟรช</button>
</div>
${devices.length === 0 ? '<div class="card" style="text-align:center;color:#94a3b8">ยังไม่มีเครื่องส่ง Heartbeat</div>' : deviceCards}
<script>
async function sendAction(device,action,port){
  if(!confirm('ยืนยัน '+action+' port '+port+'?'))return;
  const r=await fetch('/api/port-action',{method:'POST',headers:{'Content-Type':'application/json','x-view-key':'${viewKey}'},body:JSON.stringify({device,action,port})}).catch(e=>({ok:false,json:()=>({message:e.message})}));
  const d=await r.json();
  alert(d.message);
  setTimeout(()=>location.reload(),11000);
}
function addPort(device){
  const v=document.getElementById('p-'+device).value.trim();
  if(!v)return alert('กรุณากรอก Port');
  sendAction(device,'OPEN',parseInt(v));
}
</script>
</body></html>`;
}
