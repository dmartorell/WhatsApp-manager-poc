import { Hono } from 'hono';
import { config } from './config.js';
import { classifyMessage, getAdvisorByCategory } from './classifier.js';
import {
  insertMessage,
  messageExists,
  updateMessageReply,
  updateMessageEmail,
  updateMessageError,
  updateMessageMedia,
  getRecentMessageFromUser,
  getRecentMediaWithoutText,
  updateMessageClassification,
} from './db.js';
import { sendTextMessage, buildAutoReply, downloadAndSaveMedia, DownloadedMedia } from './whatsapp.js';
import { forwardMessageToAdvisor, isEmailConfigured } from './email.js';

const CONTEXT_WINDOW_SECONDS = 15;

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
      // Buscar contexto reciente del mismo usuario
      const recentMessage = getRecentMessageFromUser(from, CONTEXT_WINDOW_SECONDS);
      const hasRecentContext = recentMessage !== null;
      const isMediaWithoutText = !contentText && (messageType === 'image' || messageType === 'document');
      const isTextMessage = messageType === 'text' && contentText;

      // Buscar si hay multimedia reciente sin texto (para reclasificar)
      const recentMediaWithoutText = isTextMessage
        ? getRecentMediaWithoutText(from, CONTEXT_WINDOW_SECONDS)
        : null;

      let category: string;
      let summary: string;
      let advisorEmail: string;
      let advisorName: string;

      if (hasRecentContext && isMediaWithoutText) {
        // CASO 1: Media sin texto después de otro mensaje → usar contexto anterior
        console.log('🔗 Usando contexto de mensaje reciente (adjunto)');
        category = recentMessage.category;
        summary = 'Adjunto adicional a consulta anterior';
        advisorEmail = recentMessage.assigned_to;
        const advisor = getAdvisorByCategory(category);
        advisorName = advisor.name;
      } else if (hasRecentContext && isTextMessage) {
        // CASO 2: Texto después de otro mensaje → usar contexto anterior
        console.log('🔗 Usando contexto de mensaje reciente (texto adicional)');
        category = recentMessage.category;
        summary = 'Mensaje adicional: ' + contentText.substring(0, 50);
        advisorEmail = recentMessage.assigned_to;
        const advisor = getAdvisorByCategory(category);
        advisorName = advisor.name;
      } else if (recentMediaWithoutText) {
        // CASO 3: Texto después de media sin texto → clasificar y reclasificar el anterior
        console.log('🔄 Reclasificando mensaje multimedia anterior con nuevo contexto');
        const classification = await classifyMessage(contentText, { hasAttachment: true });
        category = classification.categoria;
        summary = classification.resumen;
        const advisor = getAdvisorByCategory(category);
        advisorEmail = advisor.email;
        advisorName = advisor.name;

        // Actualizar el mensaje multimedia anterior con la nueva clasificación
        updateMessageClassification(
          recentMediaWithoutText.wa_message_id,
          category,
          'Adjunto relacionado: ' + summary,
          advisorEmail,
        );
        console.log('📝 Mensaje multimedia anterior reclasificado');
      } else {
        // CASO 4: Mensaje normal (sin contexto reciente) → clasificar con IA
        const textToClassify = contentText || 'Documento adjunto sin texto';
        console.log('🤖 Clasificando mensaje...');
        const classification = await classifyMessage(textToClassify);
        category = classification.categoria;
        summary = classification.resumen;
        const advisor = getAdvisorByCategory(category);
        advisorEmail = advisor.email;
        advisorName = advisor.name;
      }

      console.log(`📊 Clasificación: ${category}`);
      console.log(`📝 Resumen: ${summary}`);
      console.log(`👤 Asesor asignado: ${advisorName}`);

      // Guardar en base de datos
      insertMessage({
        wa_message_id: waMessageId,
        from_phone: from,
        from_name: fromName,
        content_type: messageType,
        content_text: contentText,
        media_url: downloadedMedia?.filePath,
        category: category,
        summary: summary,
        assigned_to: advisorEmail,
      });
      console.log('💾 Mensaje guardado en base de datos');

      // Enviar auto-respuesta solo si no hay contexto reciente
      if (!hasRecentContext) {
        const replyText = buildAutoReply(advisorName);
        const replySent = await sendTextMessage(from, replyText);

        if (replySent) {
          updateMessageReply(waMessageId);
          console.log('📤 Auto-respuesta enviada');
        }
      } else {
        console.log('⏭️  Auto-respuesta omitida (contexto reciente)');
      }

      // Enviar email al asesor
      if (isEmailConfigured()) {
        console.log('📧 Enviando email al asesor...');
        const attachments = downloadedMedia
          ? [{
              filename: downloadedMedia.filename,
              path: downloadedMedia.filePath,
              contentType: downloadedMedia.mimeType,
            }]
          : undefined;

        const emailSent = await forwardMessageToAdvisor({
          advisorEmail,
          advisorName,
          clientPhone: from,
          clientName: fromName,
          category,
          summary,
          messageText: contentText || undefined,
          attachments,
        });

        if (emailSent) {
          updateMessageEmail(waMessageId);
          console.log('📧 Email enviado al asesor');
        }
      } else {
        console.log('⏭️  Email omitido (SMTP no configurado)');
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
