import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { webhook } from './webhook.js';

const app = new Hono();

// Middleware de logging
app.use('*', logger());

// Health check
app.get('/', (c) => c.text('WhatsApp Manager POC - Running'));

// Webhook routes
app.route('/', webhook);

// Iniciar servidor
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`🚀 Servidor corriendo en http://localhost:${info.port}`);
  console.log(`📡 Webhook endpoint: http://localhost:${info.port}/webhook`);
  console.log('');
  console.log('Próximo paso: ejecuta ngrok para exponer el webhook:');
  console.log(`   ngrok http ${info.port}`);
});
