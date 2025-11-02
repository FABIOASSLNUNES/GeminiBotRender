import express from 'express';
import fetch from 'node-fetch';
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from 'baileys';
import qrcode from 'qrcode-terminal';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let botStarted = false;
let sock = null;

// Simple HTML form to capture the key before QR
const formHTML = (msg = '') => `
<html><head><meta charset="utf-8"><title>Configurar Gemini Key</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:720px;margin:auto}
  input,button{font-size:16px;padding:10px} input{width:100%;margin:8px 0}
  .ok{color:#0a0}.err{color:#b00}
  code{background:#f7f7f7;padding:2px 6px;border-radius:4px}
</style></head><body>
  <h2>Configurar chave da Gemini</h2>
  ${msg ? `<p class="${msg.startsWith('✅')?'ok':'err'}">${msg}</p>` : ''}
  <form method="post">
    <label>Sua GEMINI_API_KEY (começa com <code>AIza</code>)</label>
    <input name="key" placeholder="AIza..." required value="${GEMINI_API_KEY || ''}"/>
    <button type="submit">Salvar e iniciar bot</button>
  </form>
  <p>Após salvar, veja os logs do Render para escanear o QR e conectar o WhatsApp.</p>
  <p>Healthcheck: <code>/ping</code></p>
</body></html>`;

app.get('/setup', (req,res)=>{
  res.set('Content-Type','text/html; charset=utf-8');
  res.send(formHTML());
});

app.post('/setup', async (req,res)=>{
  const { key } = req.body || {};
  if(!key || !/^AIza/.test(key)) {
    res.set('Content-Type','text/html; charset=utf-8');
    return res.status(400).send(formHTML('❌ Chave inválida. Cole uma chave que comece com AIza.'));
  }
  GEMINI_API_KEY = key.trim();
  process.env.GEMINI_API_KEY = GEMINI_API_KEY;
  if(!botStarted) {
    startBot().catch(err=>console.error('Erro ao iniciar bot:', err));
  }
  res.set('Content-Type','text/html; charset=utf-8');
  res.send(formHTML('✅ Chave salva. O bot está iniciando. Abra os Logs do Render para escanear o QR.'));
});

app.get('/ping', (req,res)=> res.send('ok'));

// --- Gemini call
async function callGemini(userText){
  if(!GEMINI_API_KEY) return 'A IA não está configurada. Acesse /setup e salve sua key.';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [ { parts: [ { text: userText || 'olá' } ] } ]
  };
  try{
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || 'Não consegui resposta da IA agora (verifique a key ou o limite).';
  }catch(e){
    console.error('Erro Gemini:', e);
    return 'Erro ao chamar a IA.';
  }
}

async function startBot() {
  if(botStarted) return;
  botStarted = true;

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: undefined,
    browser: Browsers.appropriate('Chrome'),
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect })=>{
    if(qr){
      try{
        qrcode.generate(qr, { small: true });
      }catch{}
      console.log('[QR] Escaneie o código acima no WhatsApp (Dispositivos Conectados).');
    }
    if(connection) console.log('[Conn]', connection);
    if(lastDisconnect) console.log('[Disc]', lastDisconnect?.error?.message || 'disconnected');
  });

  sock.ev.on('messages.upsert', async (msgUp)=>{
    const m = msgUp.messages?.[0];
    if(!m) return;
    if(m.key?.fromMe) return;
    const from = m.key.remoteJid;
    const text = m?.message?.conversation
      || m?.message?.extendedTextMessage?.text
      || m?.message?.ephemeralMessage?.message?.extendedTextMessage?.text
      || '';

    console.log('[MSG]', from, text);
    const reply = await callGemini(text || 'Responda cordialmente.');
    try{
      await sock.sendMessage(from, { text: reply });
      console.log('[Bot] respondeu.');
    }catch(e){
      console.error('Falha ao enviar resposta:', e);
    }
  });

  console.log('Bot iniciado. Aguardando conexão...');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{
  console.log('HTTP ok na porta', PORT);
  // Inicializa bot somente se a key já existir
  if(GEMINI_API_KEY) startBot().catch(console.error);
  else console.log('Acesse /setup para informar a GEMINI_API_KEY antes do QR.');
});
