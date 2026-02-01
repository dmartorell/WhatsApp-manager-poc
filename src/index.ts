import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { webhook } from './webhook.js';
import { getAllMessages, getUsageStats } from './db.js';
import { startEmailProcessor } from './email-processor.js';

const app = new Hono();

// Middleware de logging
app.use('*', logger());

// Health check
app.get('/', (c) => c.text('WhatsApp Manager POC - Running'));

// Ver mensajes
app.get('/messages', (c) => {
  const messages = getAllMessages();
  const stats = getUsageStats();
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Manager - Mensajes</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #5b8def; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #5b8def; color: white; }
    tr:hover { background: #f9f9f9; }
    .category { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .fiscal { background: #e3f2fd; color: #1565c0; }
    .laboral { background: #fff3e0; color: #ef6c00; }
    .contabilidad { background: #e8f5e9; color: #2e7d32; }
    .recepcion { background: #fce4ec; color: #c2185b; }
    .status { font-size: 18px; }
    .error { color: #d32f2f; font-size: 12px; }
    .refresh { margin-bottom: 20px; }
    .refresh a { background: #5b8def; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }
    .stats-container { display: flex; gap: 15px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-card h3 { margin: 0 0 5px 0; font-size: 14px; color: #666; }
    .stat-card .value { font-size: 24px; font-weight: bold; color: #333; }
    .stat-card .value.cost { color: #2e7d32; }
    .stat-card small { color: #999; font-size: 11px; }
  </style>
</head>
<body>
  <h1>WhatsApp Manager - Development</h1>
  <div class="refresh"><a href="/messages">Refrescar</a></div>

  <div class="stats-container">
    <div class="stat-card">
      <h3>Mensajes totales</h3>
      <div class="value">${stats.totalMessages}</div>
    </div>
    <div class="stat-card">
      <h3>Clasificaciones IA</h3>
      <div class="value">${stats.classificationsCount}</div>
      <small>Llamadas a Claude Haiku</small>
    </div>
    <div class="stat-card">
      <h3>Coste estimado</h3>
      <div class="value cost">${stats.estimatedCostEur.toFixed(4)} €</div>
    </div>
  </div>

  <table>
    <tr>
      <th>ID</th>
      <th>Fecha</th>
      <th>De</th>
      <th>Tipo</th>
      <th>Mensaje</th>
      <th>Categoría</th>
      <th>Resumen IA</th>
      <th>Auto-reply</th>
      <th>Email</th>
    </tr>
    ${(messages as Array<{ id: number; created_at: string; from_name: string; from_phone: string; content_type: string; content_text: string; category: string; summary: string; wa_reply_sent: number; email_sent: number; error: string }>).map((m) => `
    <tr>
      <td>${m.id}</td>
      <td>${m.created_at}</td>
      <td>${m.from_name || m.from_phone}</td>
      <td>${m.content_type}</td>
      <td>${m.content_text || '-'}</td>
      <td><span class="category ${m.category}">${m.category}</span></td>
      <td>${m.summary || '-'}</td>
      <td class="status">${m.wa_reply_sent ? '✅' : '❌'}</td>
      <td class="status">${m.email_sent ? '✅' : '❌'}</td>
    </tr>
    ${m.error ? `<tr><td colspan="9" class="error">${m.error}</td></tr>` : ''}
    `).join('')}
  </table>
</body>
</html>
  `;
  return c.html(html);
});

// Webhook routes
app.route('/', webhook);

// Iniciar servidor
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`🚀 Servidor corriendo en http://localhost:${info.port}`);
  console.log(`📡 Webhook endpoint: http://localhost:${info.port}/webhook`);
  console.log('');
  console.log('Próximo paso: ejecuta ngrok para exponer el webhook:');
  console.log(`   ngrok http ${info.port}`);

  // Iniciar procesador de emails
  startEmailProcessor();
});
