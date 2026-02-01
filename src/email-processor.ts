import {
  getPendingEmails,
  getUnsentMessagesForUser,
  markMessagesAsEmailed,
  markQueueAsSent,
  markQueueAsFailed,
} from './db.js';
import { sendConsolidatedEmail, isEmailConfigured } from './email.js';

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

  console.log(`📬 Procesando ${pendingEmails.length} email(s) pendiente(s)...`);

  for (const queueEntry of pendingEmails) {
    try {
      const messages = getUnsentMessagesForUser(queueEntry.from_phone, queueEntry.created_at);

      if (messages.length === 0) {
        // No hay mensajes para enviar, marcar como enviado
        markQueueAsSent(queueEntry.id);
        continue;
      }

      const success = await sendConsolidatedEmail(messages, queueEntry.advisor_email);

      if (success) {
        const messageIds = messages.map((m) => m.id);
        markMessagesAsEmailed(messageIds);
        markQueueAsSent(queueEntry.id);
        console.log(`✅ Email consolidado enviado (${messages.length} mensaje(s))`);
      } else {
        markQueueAsFailed(queueEntry.id, 'Error enviando email');
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
