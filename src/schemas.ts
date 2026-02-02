import { z } from 'zod';

// ═══════════════════════════════════════════════════════════
// META WHATSAPP WEBHOOK SCHEMAS
// ═══════════════════════════════════════════════════════════

export const WebhookMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  type: z.enum(['text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts']),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), caption: z.string().optional(), filename: z.string().optional() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  video: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
});

export const WebhookContactSchema = z.object({
  profile: z.object({ name: z.string() }).optional(),
});

export const WebhookValueSchema = z.object({
  messages: z.array(WebhookMessageSchema).optional(),
  contacts: z.array(WebhookContactSchema).optional(),
});

export const WebhookPayloadSchema = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: WebhookValueSchema,
    })),
  })),
});

export type WebhookMessage = z.infer<typeof WebhookMessageSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ═══════════════════════════════════════════════════════════
// CLAUDE CLASSIFICATION RESPONSE
// ═══════════════════════════════════════════════════════════

export const ClassificationResponseSchema = z.object({
  categorias: z.array(z.string()).min(1),
  resumen: z.string(),
});

export type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;

// ═══════════════════════════════════════════════════════════
// META GRAPH API RESPONSES
// ═══════════════════════════════════════════════════════════

export const MediaInfoSchema = z.object({
  url: z.string(),
  mime_type: z.string(),
  sha256: z.string(),
  file_size: z.number(),
});

export type MediaInfo = z.infer<typeof MediaInfoSchema>;

// ═══════════════════════════════════════════════════════════
// DATABASE ROW SCHEMAS
// ═══════════════════════════════════════════════════════════

export const RecentMessageSchema = z.object({
  category: z.string(),
  assigned_to: z.string(),
});

export const RecentMediaMessageSchema = z.object({
  wa_message_id: z.string(),
  category: z.string(),
  assigned_to: z.string(),
});

export const PendingEmailQueueSchema = z.object({
  id: z.number(),
  from_phone: z.string(),
  created_at: z.string(),
});

export const MessageForEmailSchema = z.object({
  id: z.number(),
  wa_message_id: z.string(),
  from_phone: z.string(),
  from_name: z.string().nullable(),
  content_type: z.string(),
  content_text: z.string().nullable(),
  media_url: z.string().nullable(),
  category: z.string().nullable(),
  summary: z.string().nullable(),
  assigned_to: z.string().nullable(),
  created_at: z.string(),
});

export const AutoReplyInfoSchema = z.object({
  from_phone: z.string(),
  category: z.string(),
  any_reply_sent: z.number(),
});

export const DbCountSchema = z.object({
  count: z.number(),
});

export const PragmaColumnSchema = z.object({
  name: z.string(),
});

export const DashboardMessageSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  from_name: z.string().nullable(),
  from_phone: z.string(),
  content_type: z.string(),
  content_text: z.string().nullable(),
  category: z.string().nullable(),
  summary: z.string().nullable(),
  classification_id: z.string().nullable(),
  wa_reply_sent: z.number(),
  email_sent: z.number(),
  error: z.string().nullable(),
});

export type RecentMessage = z.infer<typeof RecentMessageSchema>;
export type RecentMediaMessage = z.infer<typeof RecentMediaMessageSchema>;
export type PendingEmailQueue = z.infer<typeof PendingEmailQueueSchema>;
export type MessageForEmail = z.infer<typeof MessageForEmailSchema>;
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

export function parseWebhookPayload(data: unknown): WebhookPayload | null {
  const result = WebhookPayloadSchema.safeParse(data);
  if (!result.success) {
    console.error('Invalid webhook payload:', result.error.message);
    return null;
  }
  return result.data;
}

export function parseClassificationResponse(data: unknown): ClassificationResponse | null {
  const result = ClassificationResponseSchema.safeParse(data);
  if (!result.success) {
    console.error('Invalid classification response:', result.error.message);
    return null;
  }
  return result.data;
}

export function parseMediaInfo(data: unknown): MediaInfo | null {
  const result = MediaInfoSchema.safeParse(data);
  if (!result.success) {
    console.error('Invalid media info response:', result.error.message);
    return null;
  }
  return result.data;
}

export function parseDashboardMessages(data: unknown[]): DashboardMessage[] {
  return data
    .map((item) => DashboardMessageSchema.safeParse(item))
    .filter((result): result is { success: true; data: DashboardMessage } => result.success)
    .map((result) => result.data);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}
