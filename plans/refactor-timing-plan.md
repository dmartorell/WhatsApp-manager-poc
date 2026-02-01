# Plan de Refactorización: Tiempos de Auto-respuesta y Email

## Objetivo

Cambiar el flujo para que la auto-respuesta al cliente y el email al asesor se envíen **al mismo tiempo**, cuando se detecte el "cierre de ventana" (15 segundos sin nuevos mensajes del usuario).

---

## Problema Actual

```
FLUJO ACTUAL (problemático):

Msg 1 → Auto-respuesta INMEDIATA → Encolar
Msg 2 → (heredar, sin respuesta)
...
[15s desde email_queue.created_at] → Enviar email

PROBLEMA: Si llegan mensajes después de enviar el email pero dentro
de la ventana de contexto, se crean emails adicionales.
```

---

## Flujo Propuesto

```
FLUJO NUEVO:

Msg 1 → Guardar en DB → Encolar (sin auto-respuesta)
Msg 2 → Guardar en DB
Msg 3 → Guardar en DB
...
[15s sin mensajes nuevos] → CIERRE DE VENTANA:
  1. Enviar auto-respuesta al cliente
  2. Consolidar y enviar email al asesor
```

---

## Cambios por Archivo

### 1. `src/webhook.ts`

**Acción:** Eliminar envío inmediato de auto-respuesta

**Líneas a eliminar:** 173-184

```typescript
// ELIMINAR ESTE BLOQUE COMPLETO:
if (!hasRecentContext) {
  const replyText = buildAutoReply(advisorName);
  const replySent = await sendTextMessage(from, replyText);

  if (replySent) {
    updateMessageReply(waMessageId);
    console.log('📤 Auto-respuesta enviada');
  }
} else {
  console.log('⏭️  Auto-respuesta omitida (contexto reciente)');
}
```

**Mantener:** El encolado del email (líneas 186-192) permanece igual.

---

### 2. `src/db.ts`

**Acción:** Modificar `getPendingEmails()` para usar el timestamp del ÚLTIMO mensaje

**Función actual (líneas 214-222):**
```typescript
export function getPendingEmails(windowSeconds: number): EmailQueueEntry[] {
  const stmt = db.prepare(`
    SELECT id, from_phone, advisor_email, created_at
    FROM email_queue
    WHERE status = 'pending'
      AND created_at < datetime('now', '-' || ? || ' seconds')
  `);
  return stmt.all(windowSeconds) as EmailQueueEntry[];
}
```

**Función nueva:**
```typescript
export function getPendingEmails(windowSeconds: number): EmailQueueEntry[] {
  const stmt = db.prepare(`
    SELECT
      eq.id,
      eq.from_phone,
      eq.advisor_email,
      eq.created_at,
      (
        SELECT MAX(m.created_at)
        FROM messages m
        WHERE m.from_phone = eq.from_phone
          AND m.email_sent = 0
      ) as last_message_at
    FROM email_queue eq
    WHERE eq.status = 'pending'
      AND (
        SELECT MAX(m.created_at)
        FROM messages m
        WHERE m.from_phone = eq.from_phone
          AND m.email_sent = 0
      ) < datetime('now', '-' || ? || ' seconds')
  `);
  return stmt.all(windowSeconds) as EmailQueueEntry[];
}
```

**Cambio clave:** En lugar de usar `email_queue.created_at`, usamos el `MAX(messages.created_at)` del usuario. Esto asegura que esperamos 15s desde el **último** mensaje, no desde el primero.

---

### 3. `src/db.ts` (función adicional)

**Acción:** Agregar función para obtener info de auto-respuesta pendiente

```typescript
export interface AutoReplyInfo {
  fromPhone: string;
  advisorName: string;
  needsAutoReply: boolean;
}

export function getAutoReplyInfo(fromPhone: string): AutoReplyInfo | null {
  const stmt = db.prepare(`
    SELECT
      from_phone,
      assigned_to as advisor_name,
      MAX(wa_reply_sent) as any_reply_sent
    FROM messages
    WHERE from_phone = ?
      AND email_sent = 0
    GROUP BY from_phone
  `);

  const result = stmt.get(fromPhone) as {
    from_phone: string;
    advisor_name: string;
    any_reply_sent: number
  } | undefined;

  if (!result) return null;

  return {
    fromPhone: result.from_phone,
    advisorName: result.advisor_name,
    needsAutoReply: result.any_reply_sent === 0
  };
}
```

---

### 4. `src/db.ts` (función adicional)

**Acción:** Agregar función para marcar todos los mensajes de un usuario como "auto-reply enviado"

```typescript
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
```

---

### 5. `src/email-processor.ts`

**Acción:** Agregar envío de auto-respuesta antes del email

**Función actual `processEmailQueue()` (líneas 15-54):**

```typescript
export async function processEmailQueue(): Promise<void> {
  // ... código existente ...

  for (const queueEntry of pendingEmails) {
    const messages = getUnsentMessagesForUser(queueEntry.from_phone, queueEntry.created_at);

    if (messages.length === 0) {
      markQueueAsSent(queueEntry.id);
      continue;
    }

    const success = await sendConsolidatedEmail(messages, queueEntry.advisor_email);
    if (success) {
      const messageIds = messages.map((m) => m.id);
      markMessagesAsEmailed(messageIds);
      markQueueAsSent(queueEntry.id);
    }
  }
}
```

**Función modificada:**

```typescript
import { sendTextMessage, buildAutoReply } from './whatsapp';
import { getAutoReplyInfo, markUserMessagesAsReplied } from './db';

export async function processEmailQueue(): Promise<void> {
  // ... código existente para obtener pendingEmails ...

  for (const queueEntry of pendingEmails) {
    const messages = getUnsentMessagesForUser(queueEntry.from_phone, queueEntry.created_at);

    if (messages.length === 0) {
      markQueueAsSent(queueEntry.id);
      continue;
    }

    // ═══════════════════════════════════════════════════════════
    // NUEVO: Enviar auto-respuesta al cliente ANTES del email
    // ═══════════════════════════════════════════════════════════
    const autoReplyInfo = getAutoReplyInfo(queueEntry.from_phone);

    if (autoReplyInfo && autoReplyInfo.needsAutoReply) {
      const replyText = buildAutoReply(autoReplyInfo.advisorName);
      const replySent = await sendTextMessage(queueEntry.from_phone, replyText);

      if (replySent) {
        markUserMessagesAsReplied(queueEntry.from_phone);
        console.log(`📤 Auto-respuesta enviada a ${queueEntry.from_phone}`);
      } else {
        console.error(`❌ Error enviando auto-respuesta a ${queueEntry.from_phone}`);
        // Continuar con el email aunque falle la auto-respuesta
      }
    }
    // ═══════════════════════════════════════════════════════════

    // Enviar email consolidado (código existente)
    const success = await sendConsolidatedEmail(messages, queueEntry.advisor_email);
    if (success) {
      const messageIds = messages.map((m) => m.id);
      markMessagesAsEmailed(messageIds);
      markQueueAsSent(queueEntry.id);
      console.log(`📧 Email consolidado enviado (${messages.length} mensajes)`);
    }
  }
}
```

---

## Resumen de Cambios

| Archivo | Cambio | Líneas aprox. |
|---------|--------|---------------|
| `webhook.ts` | Eliminar bloque de auto-respuesta | -12 líneas |
| `db.ts` | Modificar `getPendingEmails()` | ~10 líneas |
| `db.ts` | Agregar `getAutoReplyInfo()` | +20 líneas |
| `db.ts` | Agregar `markUserMessagesAsReplied()` | +8 líneas |
| `email-processor.ts` | Agregar envío de auto-respuesta | +15 líneas |

**Total:** ~40 líneas de código nuevo/modificado

---

## Diagrama del Nuevo Flujo

```
┌─────────────────────────────────────────────────────────────┐
│ WEBHOOK POST                                                │
│ Mensaje llega de WhatsApp                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Guardar mensaje en DB         │
         │ • email_sent = 0              │
         │ • wa_reply_sent = 0           │  ← YA NO SE ENVÍA AUTO-RESPUESTA
         └───────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Encolar email (si no existe)  │
         │ email_queue.status = pending  │
         └───────────────────────────────┘
                         │
                         │ (CADA 10 SEGUNDOS)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ EMAIL PROCESSOR                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────────────────┐
         │ ¿Último mensaje del usuario > 15s atrás? │
         │ (SELECT MAX(created_at) FROM messages)    │
         └─────────────┬─────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
       ┌───NO───┐              ┌───SÍ───┐
       │        │              │        │
       ▼        │              ▼        │
    Esperar     │     ┌────────────────────────┐
    10s más     │     │ CIERRE DE VENTANA      │
                │     └────────────────────────┘
                │              │
                │              ▼
                │     ┌────────────────────────┐
                │     │ 1. Enviar auto-respuesta│
                │     │    via WhatsApp API     │
                │     │    → wa_reply_sent = 1  │
                │     └────────────────────────┘
                │              │
                │              ▼
                │     ┌────────────────────────┐
                │     │ 2. Consolidar mensajes │
                │     │    del usuario         │
                │     └────────────────────────┘
                │              │
                │              ▼
                │     ┌────────────────────────┐
                │     │ 3. Enviar email        │
                │     │    al asesor           │
                │     │    → email_sent = 1    │
                │     └────────────────────────┘
                │              │
                │              ▼
                │     ┌────────────────────────┐
                │     │ 4. Marcar cola         │
                │     │    → status = 'sent'   │
                │     └────────────────────────┘
```

---

## Ejemplo con el Caso Real

```
21:36:21  Msg 16 "Tengo que hacer un despido" → DB + encolar
21:36:22  Msg 17 "Me va acostar mucho"        → DB (misma cola)
21:36:31  Msg 18 "No?"                        → DB (misma cola)
21:36:37  Msg 19 "Miles?"                     → DB (misma cola)
21:36:44  Msg 20 "Cientos?"                   → DB (misma cola)
21:36:50  Msg 21 "Mejor no hacerlo?"          → DB (misma cola)
21:36:59  Msg 22 "A qué hora abrís?"          → DB (misma cola)
21:37:03  Msg 23 "Es urgente"                 → DB (misma cola)
21:37:11  Msg 24 "Está María?"                → DB (misma cola)  ← ÚLTIMO

21:37:20  Processor ejecuta
          → MAX(created_at) = 21:37:11 (9s atrás) → NO procesar

21:37:30  Processor ejecuta
          → MAX(created_at) = 21:37:11 (19s atrás) → SÍ procesar
          → Enviar auto-respuesta "Hemos recibido tu consulta..."
          → Enviar 1 email con 9 mensajes al asesor

RESULTADO: 1 auto-respuesta + 1 email (en vez de 3 emails)
```

---

## Orden de Implementación

1. **Fase 1:** Modificar `db.ts`
   - Modificar `getPendingEmails()` para usar último mensaje
   - Agregar `getAutoReplyInfo()`
   - Agregar `markUserMessagesAsReplied()`

2. **Fase 2:** Modificar `email-processor.ts`
   - Importar funciones de whatsapp
   - Agregar lógica de auto-respuesta antes del email

3. **Fase 3:** Modificar `webhook.ts`
   - Eliminar bloque de auto-respuesta inmediata

4. **Fase 4:** Testing
   - Probar con mensajes individuales
   - Probar con ráfaga de mensajes
   - Verificar que solo se envía 1 auto-respuesta y 1 email

---

## Consideraciones Adicionales

### ¿Qué pasa si el email falla pero la auto-respuesta ya se envió?

El usuario recibe la confirmación pero el asesor no recibe el email. Solución: El processor reintentará en el siguiente ciclo (la cola sigue en `pending`), pero no volverá a enviar auto-respuesta porque `wa_reply_sent = 1`.

### ¿Qué pasa si la auto-respuesta falla?

El email se envía de todos modos. El asesor recibe la consulta. El usuario no recibe confirmación, pero su consulta no se pierde.

### ¿Configurar el timeout de la ventana?

Actualmente está hardcodeado en 15s. Podría moverse a `config.ts` como variable de entorno:

```typescript
// config.ts
export const CONTEXT_WINDOW_SECONDS = parseInt(process.env.CONTEXT_WINDOW_SECONDS || '15');
```
