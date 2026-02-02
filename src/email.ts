import nodemailer from 'nodemailer';
import { config } from './config.js';

interface EmailAttachment {
  filename: string;
  path: string;
  contentType?: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!config.smtpHost || !config.smtpUser || !config.smtpPassword) {
      throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env');
    }

    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
    });
  }
  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    const transport = getTransporter();

    const mailOptions: nodemailer.SendMailOptions = {
      from: config.emailFrom || config.smtpUser,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    const info = await transport.sendMail(mailOptions);
    console.log('✅ Email enviado:', info.messageId);

    // Si es Ethereal, mostrar URL de preview
    if (config.smtpHost === 'smtp.ethereal.email') {
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }

    return true;
  } catch (error) {
    console.error('❌ Error enviando email:', error);
    return false;
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPassword);
}

// Formateo de fecha y hora en español (hora local del sistema)
function parseDate(dateString: string): Date {
  // SQLite guarda en UTC con datetime('now'), añadimos 'Z' para parsear como UTC
  return new Date(dateString.replace(' ', 'T') + 'Z');
}

function formatDateSpanish(dateString: string): string {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const date = parseDate(dateString);
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName}, ${day} de ${month} de ${year}`;
}

function formatTime24h(dateString: string): string {
  const date = parseDate(dateString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Colores de categorías para emails
function getCategoryStyle(category: string): { background: string; color: string } {
  const styles: Record<string, { background: string; color: string }> = {
    fiscal: { background: '#e3f2fd', color: '#1565c0' },
    laboral: { background: '#fff3e0', color: '#ef6c00' },
    contabilidad: { background: '#e8f5e9', color: '#2e7d32' },
    recepcion: { background: '#fce4ec', color: '#c2185b' },
  };
  return styles[category] || { background: '#e0e0e0', color: '#333' };
}

function renderCategoryBadges(categoryString: string): string {
  const categories = categoryString.split(', ').map((c) => c.trim());
  return categories
    .map((cat) => {
      const style = getCategoryStyle(cat);
      return `<span style="background: ${style.background}; color: ${style.color}; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 13px; display: inline-block; margin-right: 8px; margin-bottom: 4px;">${cat}</span>`;
    })
    .join('');
}

interface ForwardMessageOptions {
  advisorEmail: string;
  advisorName: string;
  clientPhone: string;
  clientName?: string;
  category: string;
  summary: string;
  messageText?: string;
  attachments?: EmailAttachment[];
}

export async function forwardMessageToAdvisor(options: ForwardMessageOptions): Promise<boolean> {
  const clientDisplay = options.clientName || options.clientPhone;

  const subject = `[${options.category.toUpperCase()}] ${clientDisplay}: ${options.summary}`;

  const textBody = `
Nueva consulta recibida por WhatsApp
=====================================

Cliente: ${clientDisplay}
Teléfono: ${options.clientPhone}
Categoría: ${options.category}
Resumen: ${options.summary}

${options.messageText ? `Mensaje:\n${options.messageText}` : '(Sin texto, solo adjuntos)'}

${options.attachments && options.attachments.length > 0 ? `\nAdjuntos: ${options.attachments.length} archivo(s)` : ''}
---
Enviado automáticamente por WhatsApp Manager
`.trim();

  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <h2 style="color: #25D366;">Nueva consulta por WhatsApp</h2>

  <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Cliente</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${clientDisplay}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Teléfono</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${options.clientPhone}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Categoría</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${renderCategoryBadges(options.category)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Resumen</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;"><em>${options.summary}</em></td>
    </tr>
  </table>

  ${options.messageText ? `
  <div style="background: #f5f5f5; padding: 15px; border-left: 4px solid #25D366; margin-bottom: 20px;">
    <strong>Mensaje:</strong><br>
    ${options.messageText.replace(/\n/g, '<br>')}
  </div>
  ` : '<p><em>(Sin texto, solo adjuntos)</em></p>'}

  ${options.attachments && options.attachments.length > 0 ? `<p>📎 <strong>${options.attachments.length} archivo(s) adjunto(s)</strong></p>` : ''}

  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="color: #666; font-size: 12px;">Enviado automáticamente por WhatsApp Manager</p>
</div>
`.trim();

  return sendEmail({
    to: options.advisorEmail,
    subject,
    text: textBody,
    html: htmlBody,
    attachments: options.attachments,
  });
}

// ========== CONSOLIDATED EMAIL ==========

interface MessageForConsolidation {
  from_phone: string;
  from_name: string | null;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  category: string;
  summary: string;
  created_at: string;
}

export async function sendConsolidatedEmail(
  messages: MessageForConsolidation[],
  advisorEmail: string,
): Promise<boolean> {
  if (messages.length === 0) return false;

  const firstMessage = messages[0];
  const clientDisplay = firstMessage.from_name || firstMessage.from_phone;
  const category = firstMessage.category;
  const summary = firstMessage.summary;

  const subject = `[${category.toUpperCase()}] ${clientDisplay}: ${summary}`;

  // Recopilar contenido de cada mensaje y adjuntos
  interface MessageContent {
    text: string;
    hasAttachment: boolean;
    attachmentName?: string;
  }
  const messageContents: MessageContent[] = [];
  const attachments: EmailAttachment[] = [];

  for (const msg of messages) {
    const filename = msg.media_url ? (msg.media_url.split('/').pop() || 'adjunto') : undefined;

    if (msg.media_url) {
      attachments.push({
        filename: filename!,
        path: msg.media_url,
      });
    }

    if (msg.content_text && msg.media_url) {
      // Texto + adjunto (imagen/documento con caption)
      messageContents.push({
        text: msg.content_text,
        hasAttachment: true,
        attachmentName: filename,
      });
    } else if (msg.media_url) {
      // Solo adjunto sin texto
      messageContents.push({
        text: `📎 ${filename}`,
        hasAttachment: true,
        attachmentName: filename,
      });
    } else if (msg.content_text) {
      // Solo texto
      messageContents.push({
        text: msg.content_text,
        hasAttachment: false,
      });
    }
  }

  const combinedText = messageContents.length > 0
    ? messageContents.map((m) => m.hasAttachment && !m.text.startsWith('📎') ? `${m.text}\n📎 ${m.attachmentName}` : m.text).join('\n\n---\n\n')
    : '(Sin contenido)';

  const textBody = `
Nueva consulta recibida por WhatsApp
=====================================

Cliente: ${clientDisplay}
Teléfono: ${firstMessage.from_phone}
Categoría: ${category}
Resumen: ${summary}
${messages.length === 1 ? '1 mensaje' : `${messages.length} mensajes agrupados`}

Mensaje(s):
${combinedText}

${attachments.length > 0 ? `\nAdjuntos: ${attachments.length} archivo(s)` : ''}
---
Enviado automáticamente por WhatsApp Manager
`.trim();

  const messagesHtml = messageContents.length > 0
    ? messageContents.map((m, i) => {
      const isOnlyAttachment = m.text.startsWith('📎');
      const bgColor = isOnlyAttachment ? '#e8f5e9' : '#f5f5f5';
      const borderColor = isOnlyAttachment ? '#4CAF50' : '#25D366';
      const attachmentIndicator = m.hasAttachment && !isOnlyAttachment
        ? `<br><span style="color: #4CAF50;">📎 ${m.attachmentName}</span>`
        : '';

      return `
      <div style="background: ${bgColor}; padding: 15px; border-left: 4px solid ${borderColor}; margin-bottom: 10px;">
        ${messageContents.length > 1 ? `<small style="color: #666;">Mensaje ${i + 1}:</small><br>` : ''}
        ${m.text.replace(/\n/g, '<br>')}${attachmentIndicator}
      </div>
    `;
    }).join('')
    : '<p><em>(Sin contenido)</em></p>';

  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <h2 style="color: #25D366;">Nueva consulta por WhatsApp</h2>

  <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Fecha</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${formatDateSpanish(firstMessage.created_at)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Hora</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${formatTime24h(firstMessage.created_at)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Cliente</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${clientDisplay}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Teléfono</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${firstMessage.from_phone}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Categoría</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${renderCategoryBadges(category)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Resumen</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;"><em>${summary}</em></td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Mensajes</strong></td>
      <td style="padding: 8px; border: 1px solid #ddd;">${messages.length === 1 ? '1 mensaje' : `${messages.length} mensajes agrupados`}</td>
    </tr>
  </table>

  ${messagesHtml}

  ${attachments.length > 0 ? `<p>📎 <strong>${attachments.length} archivo(s) adjunto(s)</strong></p>` : ''}

  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="color: #666; font-size: 12px;">Enviado automáticamente por WhatsApp Manager</p>
</div>
`.trim();

  return sendEmail({
    to: advisorEmail,
    subject,
    text: textBody,
    html: htmlBody,
    attachments,
  });
}
