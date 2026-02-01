import { config } from './config.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${config.waPhoneNumberId}/messages`;
const GRAPH_API_URL = 'https://graph.facebook.com/v21.0';
const MEDIA_DIR = join(process.cwd(), 'media');

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

interface MediaInfo {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
}

export async function getMediaUrl(mediaId: string): Promise<MediaInfo | null> {
  try {
    const response = await fetch(`${GRAPH_API_URL}/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${config.waAccessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error obteniendo URL del media:', error);
      return null;
    }

    const data = await response.json() as MediaInfo;
    return data;
  } catch (error) {
    console.error('❌ Error obteniendo URL del media:', error);
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
    console.error('❌ Error descargando media:', error);
    return null;
  }
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'video/mp4': '.mp4',
  };
  return mimeToExt[mimeType] || '.bin';
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
