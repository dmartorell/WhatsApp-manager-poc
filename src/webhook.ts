import { Hono } from 'hono';
import { config } from './config.js';
import {
  insertMessage,
  messageExists,
  updateMessageError,
  enqueueEmail,
} from './db.js';
import { downloadAndSaveMedia, DownloadedMedia } from './whatsapp.js';
import { isEmailConfigured } from './email.js';

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

  // Extraer mensaje si existe
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;
  const contacts = value?.contacts;

  if (messages && messages.length > 0) {
    const message = messages[0];
    const waMessageId = message.id;
    const from = message.from;
    const fromName = contacts?.[0]?.profile?.name;
    const messageType = message.type;

    // Deduplicación: ignorar si ya procesamos este mensaje
    if (messageExists(waMessageId)) {
      console.log('⏭️  Mensaje ya procesado:', waMessageId);
      return c.text('OK', 200);
    }

    console.log('─'.repeat(50));
    console.log(`📱 Mensaje de: ${from} (${fromName || 'sin nombre'})`);
    console.log(`📝 Tipo: ${messageType}`);

    let contentText = '';
    let mediaId: string | null = null;
    let downloadedMedia: DownloadedMedia | null = null;

    if (messageType === 'text') {
      contentText = message.text.body;
      console.log(`💬 Texto: ${contentText}`);
    } else if (messageType === 'image') {
      contentText = message.image.caption || '';
      mediaId = message.image.id;
      console.log(`🖼️  Imagen recibida (ID: ${mediaId})`);
    } else if (messageType === 'document') {
      contentText = message.document.caption || '';
      mediaId = message.document.id;
      console.log(`📄 Documento recibido (ID: ${mediaId})`);
    }

    // Descargar multimedia si existe
    if (mediaId) {
      console.log('⬇️  Descargando multimedia...');
      downloadedMedia = await downloadAndSaveMedia(mediaId, waMessageId);
      if (downloadedMedia) {
        console.log(`✅ Multimedia descargado: ${downloadedMedia.filename}`);
      } else {
        console.log('⚠️  No se pudo descargar el multimedia');
      }
    }

    try {
      // Guardar mensaje SIN clasificar (clasificación diferida)
      insertMessage({
        wa_message_id: waMessageId,
        from_phone: from,
        from_name: fromName,
        content_type: messageType,
        content_text: contentText,
        media_url: downloadedMedia?.filePath,
        // category, summary, assigned_to quedan null
        // Se clasificarán cuando se cierre la ventana de contexto
      });
      console.log('💾 Mensaje guardado (pendiente de clasificación)');

      // Encolar para procesamiento posterior
      if (isEmailConfigured()) {
        enqueueEmail(from);
        console.log('📬 Encolado para procesamiento');
      }
    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
      updateMessageError(waMessageId, String(error));
    }

    console.log('─'.repeat(50));
  }

  // Meta requiere respuesta 200 rápida
  return c.text('OK', 200);
});
