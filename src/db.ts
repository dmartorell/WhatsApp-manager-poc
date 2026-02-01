import Database from 'better-sqlite3';
import { join } from 'path';

const db = new Database(join(process.cwd(), 'messages.db'));

// Crear tabla si no existe
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
