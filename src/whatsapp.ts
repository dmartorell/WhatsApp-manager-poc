import { config } from './config.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { parseMediaInfo, MediaInfo, formatError } from './schemas.js';
import { GRAPH_API_BASE_URL } from './constants.js';

const WHATSAPP_API_URL = `${GRAPH_API_BASE_URL}/${config.waPhoneNumberId}/messages`;
const MEDIA_DIR = join(process.cwd(), 'media');

export async function markAsRead(messageId: string): Promise<boolean> {
  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.waAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error marcando como leído:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Error marcando como leído:', formatError(error));
    return false;
  }
}

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
    console.error('❌ Error enviando mensaje:', formatError(error));
    return false;
  }
}

export function buildAutoReply(categories: string[]): string {
  const areaNames: Record<string, string> = {
    fiscal: 'fiscal',
    laboral: 'laboral',
    contabilidad: 'contabilidad',
  };

  // Filtrar solo categorías específicas (no recepción)
  const specificAreas = categories
    .map((c) => areaNames[c])
    .filter((a): a is string => Boolean(a));

  if (specificAreas.length === 1) {
    // Una sola categoría específica
    return `Hemos recibido tu consulta. Nuestro equipo de área ${specificAreas[0]} te contactará lo antes posible.`;
  }

  // Múltiples categorías o solo recepción → mensaje genérico
  return 'Hemos recibido tu consulta. Nuestro equipo te contactará lo antes posible.';
}

export async function getMediaUrl(mediaId: string): Promise<MediaInfo | null> {
  try {
    const response = await fetch(`${GRAPH_API_BASE_URL}/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${config.waAccessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error obteniendo URL del media:', error);
      return null;
    }

    const data = await response.json();
    const mediaInfo = parseMediaInfo(data);
    if (!mediaInfo) {
      console.error('❌ Invalid media info response structure');
      return null;
    }
    return mediaInfo;
  } catch (error) {
    console.error('❌ Error obteniendo URL del media:', formatError(error));
    return null;
  }
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${config.waAccessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error descargando media:', error);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('❌ Error descargando media:', formatError(error));
    return null;
  }
}

function getExtensionFromMimeType(mimeType: string): string {
  // Extract base MIME type (remove codec info like "; codecs=opus")
  const baseMime = mimeType.split(';')[0].trim();

  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/aac': '.aac',
    'audio/amr': '.amr',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
  };
  return mimeToExt[baseMime] || '.bin';
}

export interface DownloadedMedia {
  filePath: string;
  filename: string;
  mimeType: string;
}

export async function downloadAndSaveMedia(
  mediaId: string,
  waMessageId: string,
): Promise<DownloadedMedia | null> {
  // 1. Obtener URL temporal del media
  const mediaInfo = await getMediaUrl(mediaId);
  if (!mediaInfo) {
    return null;
  }

  // 2. Descargar el binario
  const mediaBuffer = await downloadMedia(mediaInfo.url);
  if (!mediaBuffer) {
    return null;
  }

  // 3. Crear directorio media si no existe
  if (!existsSync(MEDIA_DIR)) {
    await mkdir(MEDIA_DIR, { recursive: true });
  }

  // 4. Guardar archivo
  const extension = getExtensionFromMimeType(mediaInfo.mime_type);
  const filename = `${waMessageId}${extension}`;
  const filePath = join(MEDIA_DIR, filename);

  await writeFile(filePath, mediaBuffer);
  console.log('💾 Media guardado:', filePath);

  return {
    filePath,
    filename,
    mimeType: mediaInfo.mime_type,
  };
}
