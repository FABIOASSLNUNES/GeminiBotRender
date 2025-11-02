import baileys, { useMultiFileAuthState, fetchLatestBaileysVersion } from "baileys";
import fetch from "node-fetch";
import readlineSync from "readline-sync";
import express from "express";
import P from "pino";

const { default: makeWASocket } = baileys;

/**
 * Simple logger helper
 */
const log = (...args) => console.log(...args);

/**
 * Runtime Gemini API key (in-memory)
 * - Prefer environment var
 * - If TTY available, ask in terminal
 * - Otherwise, expose /setup webpage to submit the key
 */
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
let BOT_STARTED = false;

/**
 * Minimal HTTP server for Render/health and setup
 */
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (_, res) => {
  res.type("text/plain").send(
`🤖 Gemini WhatsApp Bot
Status: ${BOT_STARTED ? "online" : "aguardando chave"}
Rotas úteis:
- GET  /           -> status
- GET  /ping       -> ok
- GET  /setup      -> form HTML para inserir a GEMINI_API_KEY (se não houver TTY)
- POST /setup      -> { key: "SUA_CHAVE" } (content-type: application/json ou form)
`
  );
});

app.get("/ping", (_, res) => res.send("ok"));

app.get("/setup", (_, res) => {
  res.type("html").send(`
    <!doctype html>
    <html lang="pt-br">
      <meta charset="utf-8"/>
      <title>Configurar GEMINI_API_KEY</title>
      <body style="font-family:system-ui,Segoe UI,Arial;padding:24px;max-width:640px">
        <h1>🔑 Configurar GEMINI_API_KEY</h1>
        <p>Insira sua chave da Gemini para iniciar o bot. A chave fica apenas em memória até o próximo restart.</p>
        <form method="post" action="/setup">
          <label>GEMINI_API_KEY</label><br/>
          <input name="key" style="width:100%;padding:8px" placeholder="AIza..."/><br/><br/>
          <button type="submit" style="padding:10px 16px">Salvar e iniciar bot</button>
        </form>
        <p style="margin-top:16px;color:#666">Dica: você também pode definir a variável de ambiente GEMINI_API_KEY no painel do Render.</p>
      </body>
    </html>
  `);
});

app.post("/setup", async (req, res) => {
  try {
    const key = (req.body && (req.body.key || req.body.GEMINI_API_KEY)) || "";
    if (!key || typeof key !== "string") {
      return res.status(400).json({ ok: false, error: "Chave inválida" });
    }
    GEMINI_API_KEY = key.trim();
    log("🔐 GEMINI_API_KEY recebida via /setup");
    if (!BOT_STARTED) {
      await startBot();
    }
    res.json({ ok: true, status: "Bot iniciado", tip: "Veja os logs para o QR do WhatsApp." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🌐 Servidor HTTP ativo na porta ${PORT}.`);
  if (!GEMINI_API_KEY) {
    log("🔑 Nenhuma GEMINI_API_KEY encontrada.");
    if (process.stdin.isTTY) {
      // Interactive (local): ask in terminal
      const k = readlineSync.question("Digite sua GEMINI_API_KEY: ");
      if (k && k.trim()) {
        GEMINI_API_KEY = k.trim();
        startBot();
      } else {
        log("❌ Chave não informada. Acesse /setup para inserir via navegador.");
      }
    } else {
      // Non-interactive (Render): guide to /setup
      log("➡️  Em ambiente não-interativo. Abra a URL do serviço e vá até /setup para inserir a chave.");
    }
  } else {
    startBot();
  }
});

/**
 * Gemini call helper
 */
async function callGemini(text) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }]
        })
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ IA não respondeu.";
  } catch (e) {
    console.error("Gemini error:", e);
    return "❌ Erro ao conectar com a IA.";
  }
}

/**
 * WhatsApp bot
 */
async function startBot() {
  if (BOT_STARTED) return;
  if (!GEMINI_API_KEY) {
    log("❌ Impossível iniciar o bot sem GEMINI_API_KEY.");
    return;
  }
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      printQRInTerminal: true,
      logger: P({ level: "silent" }),
      auth: state,
      version
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (msg) => {
      const m = msg.messages && msg.messages[0];
      if (!m || !m.message || m.key.fromMe) return;
      const text =
        m.message.conversation ||
        (m.message.extendedTextMessage && m.message.extendedTextMessage.text) ||
        "";
      if (!text) return;
      log("💬", text);

      const reply = await callGemini(text);
      await sock.sendMessage(m.key.remoteJid, { text: reply });
      log("🤖", reply);
    });

    BOT_STARTED = true;
    log("✅ Bot iniciado. Aguarde o QR no terminal/logs para conectar o WhatsApp.");
  } catch (e) {
    console.error("startBot error:", e);
    log("❌ Falha ao iniciar o bot. Verifique a chave e as dependências.");
  }
}
