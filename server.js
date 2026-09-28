require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'quran_academy_verify';
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || 'change_me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_too';
const TZ = 'Asia/Karachi';

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ایجنٹ کو کوئی لمبا نمبر نظر نہ آئے (پروفائل نام یا ایرر میں بھی نہیں)
const hideNums = s => String(s == null ? '' : s).replace(/\+?\d[\d\s\-]{6,}\d/g, '•••');

const fmt = ts => {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch (e) { return new Date(ts).toISOString(); }
};

// ---------- tiny JSON "database" ----------
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.students = db.students || {};
      db.nextId = db.nextId || 1;
      return db;
    }
  } catch (e) { console.error('loadDB error', e); }
  return { students: {}, nextId: 1 };
}
function saveDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function getOrCreateStudent(db, phone, name) {
  let s = Object.values(db.students).find(x => x.phone === phone);
  if (!s) {
    const id = 'ST' + db.nextId++;
    s = { id, phone, name: name || '', nickname: '', note: '', unread: 0, lastAt: Date.now(), messages: [] };
    db.students[id] = s;
  } else if (name && s.name !== name) {
    s.name = name;
  }
  return s;
}

// ---------- page layout ----------
const CSS = `
:root{--g:#1f6f54;--g2:#e7f3ee;--gold:#b58a2f;--ink:#1d2a24;--mut:#6b7b73;--line:#e3e8e4;--bg:#f5f3ec}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","Noto Nastaliq Urdu",Tahoma,sans-serif;line-height:1.6}
.wrap{max-width:560px;margin:0 auto;min-height:100vh;background:#fff;box-shadow:0 0 0 1px var(--line)}
.top{position:sticky;top:0;z-index:5;background:var(--g);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}
.top h1{font-size:1.05rem;margin:0;flex:1}
.top a{color:#fff;text-decoration:none;font-size:1.4rem;padding:0 4px}
.sub{font-size:.78rem;opacity:.85}
.search{padding:10px 12px;border-bottom:1px solid var(--line)}
.search input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}
.chat{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;align-items:center}
.chat:active{background:var(--g2)}
.av{width:44px;height:44px;border-radius:50%;background:var(--g2);color:var(--g);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}
.ci{flex:1;min-width:0}
.r1{display:flex;justify-content:space-between;gap:8px;align-items:center}
.nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm{font-size:.72rem;color:var(--mut);white-space:nowrap}
.pv{flex:1;min-width:0;font-size:.86rem;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.id{font-size:.72rem;color:var(--gold);font-weight:700;direction:ltr;display:inline-block}
.bd{background:#d93025;color:#fff;border-radius:999px;font-size:.72rem;padding:0 7px;min-width:20px;text-align:center;font-weight:700}
.empty{padding:40px 20px;text-align:center;color:var(--mut)}
.note{padding:6px 14px;font-size:.82rem;background:#fff8e1;border-bottom:1px solid var(--line);white-space:pre-wrap}
.thread{direction:ltr;display:flex;flex-direction:column;gap:6px;padding:12px;height:calc(100vh - 240px);height:calc(100dvh - 240px);min-height:240px;overflow-y:auto;background:#efeae2}
.b{max-width:82%;padding:7px 10px;border-radius:10px;font-size:.95rem;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.b.in{align-self:flex-start;background:#fff}
.b.out{align-self:flex-end;background:#d9fdd3}
.b.fail{background:#fde2e0}
.ts{font-size:.68rem;color:var(--mut);margin-top:2px;text-align:right}
.reply{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:#fff;position:sticky;bottom:0}
.reply textarea{flex:1;padding:10px;border:1px solid var(--line);border-radius:12px;font:inherit;resize:none;height:46px}
.reply button,.btn{background:var(--g);color:#fff;border:0;border-radius:12px;padding:0 16px;font:inherit;font-weight:700}
details{border-bottom:1px solid var(--line);padding:8px 14px;font-size:.88rem}
summary{cursor:pointer;color:var(--g);font-weight:700}
details input,details textarea{width:100%;margin:6px 0;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit}
.card{margin:16px;padding:16px;border:1px solid var(--line);border-radius:12px}
.adm{padding:12px 14px;border-bottom:1px solid var(--line)}
.adm .ph{direction:ltr;display:inline-block;font-weight:700}
.adm .m{font-size:.85rem;margin:3px 0;white-space:pre-wrap}
`;

function page(title, body) {
  return `<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

function getPass(req) {
  return (req.body && req.body.pass) || (req.query && req.query.pass) || '';
}
function auth(req, res, expected) {
  if (getPass(req) !== expected) {
    res.status(401).send(page('لاگ اِن',
      '<div class="card"><p>غلط پاس ورڈ۔ لنک کے آخر میں <b dir="ltr">?pass=آپ کا پاس ورڈ</b> لگائیں۔</p></div>'));
    return false;
  }
  return true;
}

function extractText(m) {
  if (m.type === 'text') return m.text && m.text.body;
  if (m.type === 'button') return m.button && m.button.text;
  if (m.type === 'interactive') {
    const i = m.interactive || {};
    return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '[انٹرایکٹو جواب]';
  }
  const map = {
    image: '[تصویر]', audio: '[آڈیو]', voice: '[وائس میسج]', video: '[ویڈیو]',
    document: '[فائل]', sticker: '[اسٹیکر]', location: '[لوکیشن]', contacts: '[کانٹیکٹ]', reaction: '[ری ایکشن]'
  };
  return map[m.type] || '[غیر متن پیغام]';
}

function bubble(m) {
  const cls = 'b ' + (m.direction === 'in' ? 'in' : 'out') + (m.failed ? ' fail' : '');
  const tail = m.failed ? ' · ❌ نہیں گیا: ' + hideNums(m.error || '') : '';
  return `<div class="${cls}"><div dir="auto">${esc(m.text)}</div><div class="ts">${esc(fmt(m.ts))}${esc(tail)}</div></div>`;
}

// ---------- 1. Webhook verification (Meta calls this once) ----------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ---------- 2. Incoming WhatsApp messages ----------
app.post('/webhook', (req, res) => {
  try {
    const db = loadDB();
    let changed = false;
    (req.body.entry || []).forEach(entry => (entry.changes || []).forEach(ch => {
      const v = ch.value || {};
      (v.messages || []).forEach(msg => {
        const contact = (v.contacts || []).find(c => c.wa_id === msg.from) || (v.contacts || [])[0] || {};
        const s = getOrCreateStudent(db, msg.from, contact.profile && contact.profile.name);
        if (msg.id && s.messages.some(m => m.wid === msg.id)) return; // Meta retry
        const ts = msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now();
        s.messages.push({ direction: 'in', text: extractText(msg) || '[خالی]', ts, wid: msg.id });
        s.unread = (s.unread || 0) + 1;
        s.lastAt = ts;
        changed = true;
      });
    }));
    if (changed) saveDB(db);
  } catch (e) {
    console.error('Webhook error:', e);
  }
  res.sendStatus(200);
});

// ---------- 3. Agent: chat list (numbers hidden) ----------
app.get('/agent', (req, res) => {
  if (!auth(req, res, AGENT_PASSWORD)) return;
  const pass = getPass(req);
  const list = Object.values(loadDB().students).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const total = list.reduce((n, s) => n + (s.unread || 0), 0);
  const rows = list.map(s => {
    const last = s.messages[s.messages.length - 1];
    const title = s.nickname || hideNums(s.name) || s.id;
    const pv = last ? ((last.direction === 'out' ? 'آپ: ' : '') + last.text) : '';
    const also = s.nickname && s.name ? ' · ' + esc(hideNums(s.name)) : '';
    return `<a class="chat" data-q="${esc((title + ' ' + s.id + ' ' + pv).toLowerCase())}" href="/agent/chat/${esc(s.id)}?pass=${encodeURIComponent(pass)}">
<div class="av">${esc(Array.from(title)[0] || '؟')}</div>
<div class="ci">
<div class="r1"><span class="nm">${esc(title)}</span><span class="tm">${last ? esc(fmt(last.ts)) : ''}</span></div>
<div class="r1"><span class="pv" dir="auto">${esc(pv.slice(0, 80))}</span>${s.unread ? `<span class="bd">${s.unread}</span>` : ''}</div>
<div><span class="id">${esc(s.id)}</span>${also}</div>
</div></a>`;
  }).join('');
  const body = `<div class="top"><h1>ان باکس${total ? ` (${total} نئے)` : ''}</h1><span class="sub">نمبر چھپے ہوئے ہیں</span></div>
<div class="search"><input id="q" placeholder="تلاش کریں (نام یا ST نمبر)" oninput="f()"></div>
${rows || '<div class="empty">ابھی کوئی پیغام نہیں</div>'}
<script>
function f(){var q=document.getElementById('q').value.toLowerCase();document.querySelectorAll('.chat').forEach(function(e){e.style.display=e.dataset.q.indexOf(q)>-1?'':'none'})}
setInterval(function(){if(!document.getElementById('q').value)location.reload()},30000);
</script>`;
  res.send(page('ان باکس', body));
});

// ---------- 4. Agent: one full conversation ----------
app.get('/agent/chat/:id', (req, res) => {
  if (!auth(req, res, AGENT_PASSWORD)) return;
  const pass = getPass(req);
  const db = loadDB();
  const s = db.students[req.params.id];
  if (!s) return res.status(404).send(page('نہیں ملا', '<div class="empty">چیٹ نہیں ملی</div>'));
  if (s.unread) { s.unread = 0; saveDB(db); }
  const title = s.nickname || hideNums(s.name) || s.id;
  const q = 'pass=' + encodeURIComponent(pass);
  const body = `<div class="top"><a href="/agent?${q}">→</a>
<div style="flex:1"><h1>${esc(title)}</h1><div class="sub" dir="ltr">${esc(s.id)}</div></div></div>
${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
<details><summary>نام / نوٹ بدلیں</summary>
<form method="POST" action="/agent/meta">
<input type="hidden" name="pass" value="${esc(pass)}"><input type="hidden" name="id" value="${esc(s.id)}">
<input name="nickname" placeholder="نام (مثلاً: احمد کی والدہ)" value="${esc(s.nickname)}" maxlength="60">
<textarea name="note" rows="2" placeholder="نوٹ (کورس، وقت وغیرہ)" maxlength="500">${esc(s.note)}</textarea>
<button class="btn" style="padding:8px 16px">محفوظ کریں</button></form></details>
<div class="thread" id="th">${s.messages.map(bubble).join('')}</div>
<form class="reply" method="POST" action="/agent/reply">
<input type="hidden" name="pass" value="${esc(pass)}"><input type="hidden" name="id" value="${esc(s.id)}">
<textarea name="text" placeholder="جواب لکھیں" required></textarea><button>بھیجیں</button></form>
<script>
var P=${JSON.stringify(pass).replace(/</g, '\\u003c')},ID=${JSON.stringify(s.id)};
var th=document.getElementById('th');th.scrollTop=th.scrollHeight;var cnt=th.children.length;
function draw(ms){
  var atBottom=th.scrollHeight-th.scrollTop-th.clientHeight<80;th.innerHTML='';
  ms.forEach(function(m){
    var b=document.createElement('div');b.className='b '+(m.dir==='in'?'in':'out')+(m.failed?' fail':'');
    var t=document.createElement('div');t.setAttribute('dir','auto');t.textContent=m.text;
    var x=document.createElement('div');x.className='ts';x.textContent=m.time+(m.failed?' · ❌ نہیں گیا: '+m.err:'');
    b.appendChild(t);b.appendChild(x);th.appendChild(b);
  });
  if(atBottom)th.scrollTop=th.scrollHeight;
}
setInterval(function(){
  fetch('/agent/api/chat/'+ID+'?pass='+encodeURIComponent(P)).then(function(r){return r.ok?r.json():null}).then(function(d){
    if(d&&d.count!==cnt){cnt=d.count;draw(d.messages)}
  }).catch(function(){});
},8000);
</script>`;
  res.send(page(title, body));
});

// live refresh of an open chat
app.get('/agent/api/chat/:id', (req, res) => {
  if (getPass(req) !== AGENT_PASSWORD) return res.status(401).json({ error: 'auth' });
  const db = loadDB();
  const s = db.students[req.params.id];
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.unread) { s.unread = 0; saveDB(db); }
  res.json({
    count: s.messages.length,
    messages: s.messages.map(m => ({
      dir: m.direction, text: m.text, time: fmt(m.ts), failed: !!m.failed, err: hideNums(m.error || '')
    }))
  });
});

// ---------- 5. Agent: nickname + note ----------
app.post('/agent/meta', (req, res) => {
  if (!auth(req, res, AGENT_PASSWORD)) return;
  const db = loadDB();
  const s = db.students[req.body.id];
  if (s) {
    s.nickname = String(req.body.nickname || '').slice(0, 60);
    s.note = String(req.body.note || '').slice(0, 500);
    saveDB(db);
  }
  res.redirect(`/agent/chat/${encodeURIComponent(req.body.id || '')}?pass=${encodeURIComponent(getPass(req))}`);
});

// ---------- 6. Agent sends a reply (server looks up real number) ----------
app.post('/agent/reply', async (req, res) => {
  if (!auth(req, res, AGENT_PASSWORD)) return;
  const pass = getPass(req);
  const id = req.body.id;
  const text = String(req.body.text || '').trim();
  const back = `/agent/chat/${encodeURIComponent(id || '')}?pass=${encodeURIComponent(pass)}`;
  const s0 = loadDB().students[id];
  if (!s0) return res.status(404).send(page('نہیں ملا', '<div class="empty">چیٹ نہیں ملی</div>'));
  if (!text) return res.redirect(back);

  const result = await sendWhatsAppMessage(s0.phone, text);

  // send کے دوران نئے پیغام آ سکتے ہیں، اس لیے ڈیٹا دوبارہ لوڈ کریں
  const db = loadDB();
  const s = db.students[id];
  if (s) {
    s.messages.push({ direction: 'out', text, ts: Date.now(), failed: !result.ok, error: result.ok ? undefined : result.error });
    s.lastAt = Date.now();
    saveDB(db);
  }
  res.redirect(back);
});

// ---------- 7. Admin: full numbers ----------
app.get('/admin', (req, res) => {
  if (!auth(req, res, ADMIN_PASSWORD)) return;
  const list = Object.values(loadDB().students).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const rows = list.map(s => `<div class="adm"><b>${esc(s.id)}</b> — ${esc(s.nickname || s.name)} — <span class="ph">+${esc(s.phone)}</span>
<details><summary>${s.messages.length} پیغامات</summary>
${s.messages.map(m => `<div class="m">${m.direction === 'in' ? '⬅️' : '➡️'} ${esc(m.text)} <span class="tm">${esc(fmt(m.ts))}</span></div>`).join('')}
</details></div>`).join('');
  res.send(page('ایڈمن', `<div class="top"><h1>ایڈمن (مکمل نمبر)</h1></div>${rows || '<div class="empty">ابھی کوئی طالب علم نہیں</div>'}`));
});

// ---------- sending a message out via Meta Cloud API ----------
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, text: { body: text } })
    });
    const raw = await r.text();
    console.log('SEND RESULT', r.status, raw);
    if (r.ok) return { ok: true };
    let msg = raw;
    try { msg = JSON.parse(raw).error.message; } catch (e) { /* keep raw */ }
    return { ok: false, error: msg };
  } catch (e) {
    console.error('SEND ERROR', e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

app.get('/', (req, res) => res.send('Server chal raha hai ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

module.exports = app;
