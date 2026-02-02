import Database from 'better-sqlite3';
import { join } from 'path';

const db = new Database(join(process.cwd(), 'messages.db'));

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id     TEXT UNIQUE,
    from_phone        TEXT NOT NULL,
    from_name         TEXT,
    content_type      TEXT NOT NULL,
    content_text      TEXT,
    media_url         TEXT,
    category          TEXT,
    summary           TEXT,
    assigned_to       TEXT,
    classification_id TEXT,
    email_sent        INTEGER DEFAULT 0,
    wa_reply_sent     INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now')),
    error             TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS email_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_phone    TEXT NOT NULL,
    advisor_email TEXT NOT NULL,
    status        TEXT DEFAULT 'pending',
    created_at    TEXT DEFAULT (datetime('now')),
    sent_at       TEXT,
    error         TEXT
  )
`);

// Migración: añadir classification_id si no existe
const columns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!columns.some((c) => c.name === 'classification_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN classification_id TEXT');
}

export interface MessageRecord {
  wa_message_id: string;
  from_phone: string;
  from_name?: string;
  content_type: string;
  content_text?: string;
  media_url?: string;
  category?: string;
  summary?: string;
  assigned_to?: string;
}

export function insertMessage(message: MessageRecord): number {
  const stmt = db.prepare(`
    INSERT INTO messages (wa_message_id, from_phone, from_name, content_type, content_text, media_url, category, summary, assigned_to)
    VALUES (@wa_message_id, @from_phone, @from_name, @content_type, @content_text, @media_url, @category, @summary, @assigned_to)
  `);

  // Convertir undefined a null para SQLite
  const data = {
    wa_message_id: message.wa_message_id,
    from_phone: message.from_phone,
    from_name: message.from_name ?? null,
    content_type: message.content_type,
    content_text: message.content_text ?? null,
    media_url: message.media_url ?? null,
    category: message.category ?? null,
    summary: message.summary ?? null,
    assigned_to: message.assigned_to ?? null,
  };

  const result = stmt.run(data);
  return result.lastInsertRowid as number;
}

export function updateMessageReply(waMessageId: string): void {
  const stmt = db.prepare('UPDATE messages SET wa_reply_sent = 1 WHERE wa_message_id = ?');
  stmt.run(waMessageId);
}

export function updateMessageEmail(waMessageId: string): void {
  const stmt = db.prepare('UPDATE messages SET email_sent = 1 WHERE wa_message_id = ?');
  stmt.run(waMessageId);
}

export function updateMessageError(waMessageId: string, error: string): void {
  const stmt = db.prepare('UPDATE messages SET error = ? WHERE wa_message_id = ?');
  stmt.run(error, waMessageId);
}

export function messageExists(waMessageId: string): boolean {
  const stmt = db.prepare('SELECT 1 FROM messages WHERE wa_message_id = ?');
  return stmt.get(waMessageId) !== undefined;
}

export interface RecentMessage {
  category: string;
  assigned_to: string;
}

export function getRecentMessageFromUser(phone: string, seconds: number): RecentMessage | null {
  const stmt = db.prepare(`
    SELECT category, assigned_to
    FROM messages
    WHERE from_phone = ?
      AND category IS NOT NULL
      AND created_at > datetime('now', '-' || ? || ' seconds')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const result = stmt.get(phone, seconds) as RecentMessage | undefined;
  return result || null;
}

export function getAllMessages(limit: number = 50): unknown[] {
  const stmt = db.prepare(`
    SELECT id, from_phone, from_name, content_type, content_text, category, summary, assigned_to, classification_id, wa_reply_sent, email_sent, created_at, error
    FROM messages
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export interface UsageStats {
  totalMessages: number;
  classificationsCount: number;
  estimatedCostUsd: number;
  estimatedCostEur: number;
}

export function getUsageStats(): UsageStats {
  // Contar mensajes totales
  const totalMessages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;

  // Contar clasificaciones únicas (cada classification_id = 1 llamada a Claude)
  const classificationsCount = (db.prepare(`
    SELECT COUNT(DISTINCT classification_id) as count FROM messages
    WHERE classification_id IS NOT NULL
  `).get() as { count: number }).count;

  // Estimación de coste por clasificación:
  // Input: ~300 tokens * $0.25/1M = $0.000075
  // Output: ~50 tokens * $1.25/1M = $0.0000625
  // Total por clasificación: ~$0.00014
  const costPerClassification = 0.00014;
  const estimatedCostUsd = classificationsCount * costPerClassification;
  const estimatedCostEur = estimatedCostUsd * 0.92; // USD to EUR aproximado

  return {
    totalMessages,
    classificationsCount,
    estimatedCostUsd,
    estimatedCostEur,
  };
}

export interface RecentMediaMessage {
  wa_message_id: string;
  category: string;
  assigned_to: string;
}

export function getRecentMediaWithoutText(phone: string, seconds: number): RecentMediaMessage | null {
  const stmt = db.prepare(`
    SELECT wa_message_id, category, assigned_to
    FROM messages
    WHERE from_phone = ?
      AND content_type IN ('image', 'document')
      AND (content_text IS NULL OR content_text = '')
      AND created_at > datetime('now', '-' || ? || ' seconds')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const result = stmt.get(phone, seconds) as RecentMediaMessage | undefined;
  return result || null;
}

export function updateMessageClassification(waMessageId: string, category: string, summary: string, assignedTo: string): void {
  const stmt = db.prepare('UPDATE messages SET category = ?, summary = ?, assigned_to = ? WHERE wa_message_id = ?');
  stmt.run(category, summary, assignedTo, waMessageId);
}

export function updateMessageMedia(waMessageId: string, mediaUrl: string): void {
  const stmt = db.prepare('UPDATE messages SET media_url = ? WHERE wa_message_id = ?');
  stmt.run(mediaUrl, waMessageId);
}

// ========== EMAIL QUEUE ==========

export function enqueueEmail(fromPhone: string): void {
  // Solo insertar si no existe una entrada pendiente para este usuario
  const existing = db.prepare(`
    SELECT 1 FROM email_queue
    WHERE from_phone = ? AND status = 'pending'
  `).get(fromPhone);

  if (!existing) {
    const stmt = db.prepare(`
      INSERT INTO email_queue (from_phone, advisor_email)
      VALUES (?, '')
    `);
    stmt.run(fromPhone);
  }
}

export interface PendingEmailQueue {
  id: number;
  from_phone: string;
  created_at: string;
}

export function getPendingEmails(windowSeconds: number): PendingEmailQueue[] {
  // Obtener colas pendientes donde el ÚLTIMO mensaje del usuario
  // tiene más de windowSeconds segundos de antigüedad
  const stmt = db.prepare(`
    SELECT eq.id, eq.from_phone, eq.created_at
    FROM email_queue eq
    WHERE eq.status = 'pending'
      AND (
        SELECT MAX(m.created_at)
        FROM messages m
        WHERE m.from_phone = eq.from_phone
          AND m.email_sent = 0
      ) < datetime('now', '-' || ? || ' seconds')
  `);
  return stmt.all(windowSeconds) as PendingEmailQueue[];
}

export interface MessageForEmail {
  id: number;
  wa_message_id: string;
  from_phone: string;
  from_name: string | null;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  category: string;
  summary: string;
  assigned_to: string;
  created_at: string;
}

export function getUnsentMessagesForUser(fromPhone: string): MessageForEmail[] {
  // Obtener todos los mensajes no enviados del usuario
  const stmt = db.prepare(`
    SELECT id, wa_message_id, from_phone, from_name, content_type, content_text, media_url, category, summary, assigned_to, created_at
    FROM messages
    WHERE from_phone = ?
      AND email_sent = 0
    ORDER BY created_at ASC
  `);
  return stmt.all(fromPhone) as MessageForEmail[];
}

export function markMessagesAsEmailed(messageIds: number[]): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  const stmt = db.prepare(`UPDATE messages SET email_sent = 1 WHERE id IN (${placeholders})`);
  stmt.run(...messageIds);
}

export function markQueueAsSent(queueId: number): void {
  const stmt = db.prepare(`
    UPDATE email_queue
    SET status = 'sent', sent_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(queueId);
}

export function markQueueAsFailed(queueId: number, error: string): void {
  const stmt = db.prepare(`
    UPDATE email_queue
    SET status = 'failed', error = ?
    WHERE id = ?
  `);
  stmt.run(error, queueId);
}

// ========== AUTO-REPLY MANAGEMENT ==========

export interface AutoReplyInfo {
  fromPhone: string;
  category: string;
  needsAutoReply: boolean;
}

export function getAutoReplyInfo(fromPhone: string): AutoReplyInfo | null {
  // Obtener info para auto-respuesta: categoría y si ya se envió respuesta
  // Usamos el primer mensaje clasificado (el que tiene el resumen real, no los heredados)
  const stmt = db.prepare(`
    SELECT
      from_phone,
      category,
      MAX(wa_reply_sent) as any_reply_sent
    FROM messages
    WHERE from_phone = ?
      AND email_sent = 0
      AND category IS NOT NULL
    GROUP BY from_phone
  `);

  const result = stmt.get(fromPhone) as {
    from_phone: string;
    category: string;
    any_reply_sent: number;
  } | undefined;

  if (!result) return null;

  return {
    fromPhone: result.from_phone,
    category: result.category,
    needsAutoReply: result.any_reply_sent === 0,
  };
}

export function markUserMessagesAsReplied(fromPhone: string): void {
  const stmt = db.prepare(`
    UPDATE messages
    SET wa_reply_sent = 1
    WHERE from_phone = ?
      AND email_sent = 0
      AND wa_reply_sent = 0
  `);
  stmt.run(fromPhone);
}

// ========== DEFERRED CLASSIFICATION ==========

export function classifyUserMessages(
  messageIds: number[],
  category: string,
  summary: string,
  assignedTo: string,
  classificationId: string,
): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    UPDATE messages
    SET category = ?, summary = ?, assigned_to = ?, classification_id = ?
    WHERE id IN (${placeholders})
  `);
  stmt.run(category, summary, assignedTo, classificationId, ...messageIds);
}

export function hasUserReceivedReply(fromPhone: string): boolean {
  const stmt = db.prepare(`
    SELECT 1 FROM messages
    WHERE from_phone = ?
      AND email_sent = 0
      AND wa_reply_sent = 1
    LIMIT 1
  `);
  return stmt.get(fromPhone) !== undefined;
}
