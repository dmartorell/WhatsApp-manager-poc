import { Hono } from 'hono';
import { config } from './config.js';

export const webhook = new Hono();

// GET /webhook - Verificación de Meta
webhook.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === config.waVerifyToken) {
    console.log('✅ Webhook verificado correctamente');
    return c.text(challenge || '');
  }

  console.log('❌ Verificación fallida');
  return c.text('Forbidden', 403);
});

// POST /webhook - Recepción de mensajes
webhook.post('/webhook', async (c) => {
  const body = await c.req.json();

  console.log('📩 Webhook recibido:', JSON.stringify(body, null, 2));

  // Extraer mensaje si existe
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;

  if (messages && messages.length > 0) {
    const message = messages[0];
    const from = message.from;
    const messageType = message.type;

    console.log('─'.repeat(50));
    console.log(`📱 Mensaje de: ${from}`);
    console.log(`📝 Tipo: ${messageType}`);

    if (messageType === 'text') {
      console.log(`💬 Texto: ${message.text.body}`);
    } else if (messageType === 'image') {
      console.log(`🖼️  Imagen recibida (ID: ${message.image.id})`);
    } else if (messageType === 'document') {
      console.log(`📄 Documento recibido (ID: ${message.document.id})`);
    }

    console.log('─'.repeat(50));
  }

  // Meta requiere respuesta 200 rápida
  return c.text('OK', 200);
});
