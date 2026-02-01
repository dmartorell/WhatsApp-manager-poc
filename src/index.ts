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
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px 40px; background: #f5f5f5; }
    h1 { color: #5b8def; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px; text-align: center; border-bottom: 1px solid #eee; }
    th:first-child, td:first-child { padding-left: 20px; }
    th:last-child, td:last-child { padding-right: 20px; }
    th { background: #5b8def; color: white; text-align: center; }
    .summary-cell { vertical-align: middle; font-style: italic; color: #555; }
    .category-cell { vertical-align: middle; min-width: 180px; }
    tr.group-hover td { background: #f0f4ff; }
    tr.group-separator td { background: #f5f5f5; padding: 4px 0; border: none; }
    .category { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-right: 6px; }
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
      <th>Resumen</th>
      <th>Reply</th>
      <th>Email</th>
    </tr>
    ${(() => {
      type Message = { id: number; created_at: string; from_name: string; from_phone: string; content_type: string; content_text: string; category: string | null; summary: string | null; wa_reply_sent: number; email_sent: number; error: string };
      const msgs = messages as Message[];

      // Agrupar mensajes por summary + from_phone (mensajes con mismo resumen del mismo usuario = mismo grupo)
      interface Group { messages: Message[]; summary: string | null; }
      const groups: Group[] = [];
      let currentGroup: Group | null = null;

      for (const m of msgs) {
        const groupKey = `${m.from_phone}|${m.summary || 'pending'}`;
        if (!currentGroup || `${currentGroup.messages[0].from_phone}|${currentGroup.summary || 'pending'}` !== groupKey) {
          currentGroup = { messages: [m], summary: m.summary };
          groups.push(currentGroup);
        } else {
          currentGroup.messages.push(m);
        }
      }

      let html = '';
      groups.forEach((group, groupIndex) => {
        const rowCount = group.messages.length;

        // Agregar fila separadora entre grupos (excepto antes del primer grupo)
        if (groupIndex > 0) {
          html += '<tr class="group-separator"><td colspan="9"></td></tr>';
        }

        // Determinar estado del grupo (usar el primer mensaje como referencia)
        const firstMsg = group.messages[0];
        const categoryDisplay = firstMsg.category
          ? firstMsg.category.split(', ').map(c => `<span class="category ${c}">${c}</span>`).join(' ')
          : '<span style="color:#999">-</span>';
        const groupReplyDisplay = firstMsg.wa_reply_sent ? '✅' : '<span style="color:#999">-</span>';
        const groupEmailDisplay = firstMsg.email_sent ? '✅' : '<span style="color:#999">-</span>';

        group.messages.forEach((m, msgIndex) => {
          const isFirstRow = msgIndex === 0;

          // Solo mostrar categoría, resumen, reply y email en la primera fila del grupo
          const categoryCell = isFirstRow
            ? `<td class="category-cell" rowspan="${rowCount}">${categoryDisplay}</td>`
            : '';
          const summaryCell = isFirstRow
            ? `<td class="summary-cell" rowspan="${rowCount}">${m.summary || '-'}</td>`
            : '';
          const replyCell = isFirstRow
            ? `<td class="status" rowspan="${rowCount}" style="vertical-align:middle;text-align:center">${groupReplyDisplay}</td>`
            : '';
          const emailCell = isFirstRow
            ? `<td class="status" rowspan="${rowCount}" style="vertical-align:middle;text-align:center">${groupEmailDisplay}</td>`
            : '';

          html += `
    <tr data-group="${groupIndex}">
      <td>${m.id}</td>
      <td>${(() => { const [date, time] = m.created_at.split(' '); const [y, mo, d] = date.split('-'); return `${d}/${mo}/${y.slice(2)} ${time}`; })()}</td>
      <td>${m.from_name || m.from_phone}</td>
      <td>${m.content_type}</td>
      <td>${m.content_text || (m.content_type === 'image' || m.content_type === 'document' ? '📎' : '-')}</td>
      ${categoryCell}
      ${summaryCell}
      ${replyCell}
      ${emailCell}
    </tr>`;
          if (m.error) {
            html += `<tr><td colspan="9" class="error">${m.error}</td></tr>`;
          }
        });
      });

      return html;
    })()}
  </table>
  <script>
    document.querySelectorAll('tr[data-group]').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const group = row.dataset.group;
        document.querySelectorAll(\`tr[data-group="\${group}"]\`).forEach(r => r.classList.add('group-hover'));
      });
      row.addEventListener('mouseleave', () => {
        const group = row.dataset.group;
        document.querySelectorAll(\`tr[data-group="\${group}"]\`).forEach(r => r.classList.remove('group-hover'));
      });
    });
  </script>
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
