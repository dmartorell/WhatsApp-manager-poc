import Database from 'better-sqlite3';
import { join } from 'path';

const db = new Database(join(process.cwd(), 'messages.db'));

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id TEXT UNIQUE,
    from_phone    TEXT NOT NULL,
    from_name     TEXT,
    content_type  TEXT NOT NULL,
    content_text  TEXT,
    media_url     TEXT,
    category      TEXT,
    summary       TEXT,
    assigned_to   TEXT,
    email_sent    INTEGER DEFAULT 0,
    wa_reply_sent INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    error         TEXT
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
    SELECT id, from_phone, from_name, content_type, content_text, category, summary, assigned_to, wa_reply_sent, email_sent, created_at, error
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

  // Contar clasificaciones (mensajes que fueron clasificados por IA, no los que heredaron contexto)
  // Los que heredan contexto tienen summary que empieza por "Mensaje adicional:" o "Adjunto"
  const classificationsCount = (db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE category IS NOT NULL
      AND summary NOT LIKE 'Mensaje adicional:%'
      AND summary NOT LIKE 'Adjunto%'
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

export function enqueueEmail(fromPhone: string, advisorEmail: string): void {
  // Solo insertar si no existe una entrada pendiente para este usuario
  const existing = db.prepare(`
    SELECT 1 FROM email_queue
    WHERE from_phone = ? AND advisor_email = ? AND status = 'pending'
  `).get(fromPhone, advisorEmail);

  if (!existing) {
    const stmt = db.prepare(`
      INSERT INTO email_queue (from_phone, advisor_email)
      VALUES (?, ?)
    `);
    stmt.run(fromPhone, advisorEmail);
  }
}

export interface PendingEmailQueue {
  id: number;
  from_phone: string;
  advisor_email: string;
  created_at: string;
}

export function getPendingEmails(windowSeconds: number): PendingEmailQueue[] {
  const stmt = db.prepare(`
    SELECT id, from_phone, advisor_email, created_at
    FROM email_queue
    WHERE status = 'pending'
      AND created_at < datetime('now', '-' || ? || ' seconds')
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

export function getUnsentMessagesForUser(fromPhone: string, queueCreatedAt: string): MessageForEmail[] {
  // Obtener solo mensajes de la ventana de contexto actual:
  // Desde 15 segundos antes del created_at de la cola hasta el momento actual
  const stmt = db.prepare(`
    SELECT id, wa_message_id, from_phone, from_name, content_type, content_text, media_url, category, summary, assigned_to, created_at
    FROM messages
    WHERE from_phone = ?
      AND email_sent = 0
      AND category IS NOT NULL
      AND created_at >= datetime(?, '-15 seconds')
    ORDER BY created_at ASC
  `);
  return stmt.all(fromPhone, queueCreatedAt) as MessageForEmail[];
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
