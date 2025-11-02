GeminiBot Render
=================

• Web service para Render que:
  - Pergunta a GEMINI_API_KEY em /setup ANTES do QR;
  - Mostra o QR no Log do Render (qrcode-terminal);
  - Conecta via Baileys (sem Puppeteer/Chrome);
  - Responde mensagens usando o modelo gemini-1.5-flash (v1beta).

COMANDOS (local):
  npm install
  npm start
  -> acesse http://localhost:3000/setup, cole sua AIza..., salve e veja o QR no terminal.

EM PRODUÇÃO (Render):
  Build Command: npm install
  Start Command: npm start
  Acesse https://SEUAPP.onrender.com/setup para colar a chave.
