require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_FILE = path.join(__dirname, 'data.json');
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'quran_academy_verify';
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || 'change_me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_too';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ students: {}, nextId: 1 }));
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function getOrCreateStudent(db, phone, name) {
  let entry = Object.values(db.students).find(s => s.phone === phone);
  if (entry) return entry;
  const id = 'ST' + db.nextId++;
  entry = { id, phone, name: name || 'نامعلوم', messages: [] };
  db.students[id] = entry;
  saveDB(db);
  return entry;
}

function checkPass(req, res, expected) {
  if (req.query.pass !== expected) {
    res.status(401).send('غلط پاس ورڈ۔ لنک میں ?pass=آپکاپاسورڈ لگائیں۔');
    return false;
  }
  return true;
}

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

app.post('/webhook', (req, res) => {
  const db = loadDB();
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (messages) {
      messages.forEach(msg => {
        const phone = msg.from;
        const name = value.contacts?.[0]?.profile?.name;
        const student = getOrCreateStudent(db, phone, name);
        student.messages.push({
          direction: 'in',
          text: msg.text?.body || '[غیر متن پیغام]',
          time: new Date().toISOString()
        });
      });
      saveDB(db);
    }
  } catch (e) {
    console.error('Webhook error:', e);
  }
  res.sendStatus(200);
});

app.get('/agent', (req, res) => {
  if (!checkPass(req, res, AGENT_PASSWORD)) return;
  const db = loadDB();
  const rows = Object.values(db.students).map(s => {
    const last = s.messages.slice(-1)[0];
    return `
    <li style="margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:8px;">
      <b>${s.id}</b> — ${s.name}<br>
      <span style="color:#666">${last ? last.text : ''}</span>
      <form method="POST" action="/agent/reply?pass=${req.query.pass}">
        <input type="hidden" name="id" value="${s.id}">
        <input type="text" name="text" placeholder="جواب لکھیں" style="width:70%">
        <button>بھیجیں</button>
      </form>
    </li>`;
  }).join('');
  res.send(`<html dir="rtl"><body style="font-family:sans-serif;max-width:500px;margin:20px auto">
    <h2>ایجنٹ ان باکس (نمبر چھپا ہوا)</h2>
    <ul style="list-style:none;padding:0">${rows || '<p>ابھی کوئی پیغام نہیں</p>'}</ul>
  </body></html>`);
});

app.post('/agent/reply', async (req, res) => {
  if (!checkPass(req, res, AGENT_PASSWORD)) return;
  const db = loadDB();
  const { id, text } = req.body;
  const student = db.students[id];
  if (!student) return res.status(404).send('نہیں ملا');
  await sendWhatsAppMessage(student.phone, text);
  student.messages.push({ direction: 'out', text, time: new Date().toISOString() });
  saveDB(db);
  res.redirect('/agent?pass=' + req.query.pass);
});

app.get('/admin', (req, res) => {
  if (!checkPass(req, res, ADMIN_PASSWORD)) return;
  const db = loadDB();
  const rows = Object.values(db.students).map(s => `
    <li style="margin-bottom:16px;padding:12px;border:1px solid #ddd;border-radius:8px;">
      <b>${s.id}</b> — ${s.name} — <span style="direction:ltr;display:inline-block">${s.phone}</span><br>
      ${s.messages.map(m => `[${m.direction}] ${m.text}`).join('<br>')}
    </li>`).join('');
  res.send(`<html dir="rtl"><body style="font-family:sans-serif;max-width:500px;margin:20px auto">
    <h2>ایڈمن (مکمل نمبر نظر آئیں گے)</h2>
    <ul style="list-style:none;padding:0">${rows || '<p>ابھی کوئی طالب علم نہیں</p>'}</ul>
  </body></html>`);
});

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    })
  });
}

app.get('/', (req, res) => res.send('Server chal raha hai ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
