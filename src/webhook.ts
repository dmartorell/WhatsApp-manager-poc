import { Hono } from 'hono';
import { config } from './config.js';
import {
  insertMessage,
  messageExists,
  updateMessageError,
  enqueueEmail,
} from './db.js';
import { downloadAndSaveMedia, DownloadedMedia, markAsRead } from './whatsapp.js';
import { isEmailConfigured } from './email.js';
import { parseWebhookPayload, formatError, WebhookMessage } from './schemas.js';

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

// Helper to extract message content
const messageExtractors: Record<string, {
  emoji: string;
  label: string;
  extract: (msg: WebhookMessage) => { text: string; id: string | null };
}> = {
  text: {
    emoji: '💬',
    label: 'Texto',
    extract: (msg) => ({ text: msg.text?.body || '', id: null }),
  },
  image: {
    emoji: '🖼️',
    label: 'Imagen recibida',
    extract: (msg) => ({ text: msg.image?.caption || '', id: msg.image?.id || null }),
  },
  document: {
    emoji: '📄',
    label: 'Documento recibido',
    extract: (msg) => ({ text: msg.document?.caption || '', id: msg.document?.id || null }),
  },
  audio: {
    emoji: '🎵',
    label: 'Audio recibido',
    extract: (msg) => ({ text: '', id: msg.audio?.id || null }),
  },
  video: {
    emoji: '🎬',
    label: 'Video recibido',
    extract: (msg) => ({ text: msg.video?.caption || '', id: msg.video?.id || null }),
  },
};

function extractMessageContent(message: WebhookMessage): { contentText: string; mediaId: string | null } {
  const extractor = messageExtractors[message.type];
  if (!extractor) return { contentText: '', mediaId: null };

  const { text, id } = extractor.extract(message);
  const logSuffix = id ? `(ID: ${id})` : text;
  console.log(`${extractor.emoji} ${extractor.label}: ${logSuffix}`);

  return { contentText: text, mediaId: id };
}

// POST /webhook - Recepción de mensajes
webhook.post('/webhook', async (c) => {
  const body = await c.req.json();

  // Validate webhook payload with Zod
  const payload = parseWebhookPayload(body);
  if (!payload) {
    // Invalid payload - still return 200 to Meta
    return c.text('OK', 200);
  }

  const entry = payload.entry[0];
  if (!entry) return c.text('OK', 200);

  const changes = entry.changes[0];
  if (!changes) return c.text('OK', 200);

  const value = changes.value;
  const messages = value.messages;
  const contacts = value.contacts;

  if (!messages || messages.length === 0) {
    return c.text('OK', 200);
  }

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

  // Marcar como leído inmediatamente (doble check azul)
  markAsRead(waMessageId).catch((err) => {
    console.error('Error marcando como leído:', formatError(err));
  });

  const { contentText, mediaId } = extractMessageContent(message);
  let downloadedMedia: DownloadedMedia | null = null;

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
    console.error('❌ Error procesando mensaje:', formatError(error));
    updateMessageError(waMessageId, formatError(error));
  }

  console.log('─'.repeat(50));

  // Meta requiere respuesta 200 rápida
  return c.text('OK', 200);
});
