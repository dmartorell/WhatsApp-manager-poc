import { config } from './config.js';

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${config.waPhoneNumberId}/messages`;

export async function sendTextMessage(to: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.waAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error enviando mensaje:', error);
      return false;
    }

    console.log('✅ Mensaje enviado a:', to);
    return true;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    return false;
  }
}

export function buildAutoReply(advisorName: string): string {
  return `Hemos recibido tu consulta. Tu asesor ${advisorName} te contactará en breve.`;
}
