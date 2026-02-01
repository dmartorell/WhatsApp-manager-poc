import {
  getPendingEmails,
  getUnsentMessagesForUser,
  markMessagesAsEmailed,
  markQueueAsSent,
  markQueueAsFailed,
  markUserMessagesAsReplied,
  classifyUserMessages,
  hasUserReceivedReply,
} from './db.js';
import { sendConsolidatedEmail, isEmailConfigured } from './email.js';
import { sendTextMessage, buildAutoReply } from './whatsapp.js';
import { classifyMessage, getAdvisorsByCategories } from './classifier.js';

const CONTEXT_WINDOW_SECONDS = 15;
const PROCESS_INTERVAL_MS = 10000;

let processorInterval: NodeJS.Timeout | null = null;

export async function processEmailQueue(): Promise<void> {
  if (!isEmailConfigured()) {
    return;
  }

  const pendingEmails = getPendingEmails(CONTEXT_WINDOW_SECONDS);

  if (pendingEmails.length === 0) {
    return;
  }

  console.log(`📬 Procesando ${pendingEmails.length} entrada(s) pendiente(s)...`);

  for (const queueEntry of pendingEmails) {
    try {
      const messages = getUnsentMessagesForUser(queueEntry.from_phone);

      if (messages.length === 0) {
        markQueueAsSent(queueEntry.id);
        continue;
      }

      // ═══════════════════════════════════════════════════════════
      // CLASIFICACIÓN DIFERIDA: Clasificar todos los mensajes juntos
      // ═══════════════════════════════════════════════════════════

      // Concatenar todos los textos para clasificación
      const allTexts = messages
        .map((m) => m.content_text)
        .filter((t): t is string => Boolean(t))
        .join('\n');

      const hasAttachments = messages.some((m) => m.media_url);

      // Clasificar con todo el contexto
      console.log(`🤖 Clasificando ${messages.length} mensaje(s) de ${queueEntry.from_phone}...`);
      const textToClassify = allTexts || 'Documento adjunto sin texto';
      const classification = await classifyMessage(textToClassify, { hasAttachment: hasAttachments });

      const categories = classification.categorias;
      const summary = classification.resumen;
      const advisors = getAdvisorsByCategories(categories);

      // Para la DB, guardamos las categorías como string separado por comas
      const categoryString = categories.join(', ');
      const advisorEmails = advisors.map((a) => a.email);
      const advisorEmailString = advisorEmails.join(', ');

      console.log(`📊 Clasificación: ${categoryString}`);
      console.log(`📝 Resumen: ${summary}`);
      console.log(`👤 Asesores: ${advisors.map((a) => a.name).join(', ')}`);

      // Actualizar todos los mensajes con la clasificación
      const messageIds = messages.map((m) => m.id);
      classifyUserMessages(messageIds, categoryString, summary, advisorEmailString);

      // Actualizar los mensajes en memoria para el email
      const classifiedMessages = messages.map((m) => ({
        ...m,
        category: categoryString,
        summary,
        assigned_to: advisorEmailString,
      }));

      // ═══════════════════════════════════════════════════════════
      // Enviar auto-respuesta al cliente
      // ═══════════════════════════════════════════════════════════
      const alreadyReplied = hasUserReceivedReply(queueEntry.from_phone);

      if (!alreadyReplied) {
        // Si hay múltiples categorías específicas, usar mensaje genérico
        const replyText = buildAutoReply(categories);
        const replySent = await sendTextMessage(queueEntry.from_phone, replyText);

        if (replySent) {
          markUserMessagesAsReplied(queueEntry.from_phone);
          console.log(`📤 Auto-respuesta enviada a ${queueEntry.from_phone}`);
        } else {
          console.error(`⚠️  Error enviando auto-respuesta a ${queueEntry.from_phone}`);
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Enviar email consolidado a TODOS los asesores relevantes
      // ═══════════════════════════════════════════════════════════
      let allEmailsSent = true;

      for (const advisor of advisors) {
        const success = await sendConsolidatedEmail(classifiedMessages, advisor.email);

        if (success) {
          console.log(`✅ Email enviado a ${advisor.email} (${advisor.category})`);
        } else {
          console.error(`❌ Error enviando email a ${advisor.email}`);
          allEmailsSent = false;
        }
      }

      if (allEmailsSent) {
        markMessagesAsEmailed(messageIds);
        markQueueAsSent(queueEntry.id);
        console.log(`✅ Todos los emails enviados (${messages.length} mensaje(s) a ${advisors.length} asesor(es))`);
      } else {
        markQueueAsFailed(queueEntry.id, 'Error enviando algunos emails');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      markQueueAsFailed(queueEntry.id, errorMsg);
      console.error(`❌ Error procesando cola ${queueEntry.id}:`, errorMsg);
    }
  }
}

export function startEmailProcessor(): void {
  if (processorInterval) {
    return;
  }

  console.log(`📧 Email processor iniciado (cada ${PROCESS_INTERVAL_MS / 1000}s)`);
  processorInterval = setInterval(() => {
    processEmailQueue().catch(console.error);
  }, PROCESS_INTERVAL_MS);
}

export function stopEmailProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log('📧 Email processor detenido');
  }
}
