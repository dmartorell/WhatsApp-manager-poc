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
Resumen IA: ${options.summary}

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
      <td style="padding: 8px; border: 1px solid #ddd;"><span style="background: #e3f2fd; padding: 2px 8px; border-radius: 4px;">${options.category}</span></td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Resumen IA</strong></td>
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
