# Plan de Refactorización: Tiempos de Auto-respuesta y Email

## Estado: ✅ COMPLETADO

---

## Objetivo

Cambiar el flujo para que la auto-respuesta al cliente y el email al asesor se envíen **al mismo tiempo**, cuando se detecte el "cierre de ventana" (15 segundos sin nuevos mensajes del usuario).

---

## Resumen de Cambios Implementados

### 1. Clasificación Diferida ✅

**Antes:**
```
Msg 1 "hola" → Clasificar → recepcion
Msg 2 "quiero pagar IVA" → Heredar → recepcion ❌
```

**Ahora:**
```
Msg 1 "hola" → Guardar (sin clasificar)
Msg 2 "quiero pagar IVA" → Guardar (sin clasificar)
[cierre ventana 15s] → Clasificar TODO:
                       "hola\nquiero pagar IVA" → fiscal ✓
```

### 2. Múltiples Categorías ✅

- La IA ahora puede detectar **múltiples temas** en una conversación
- Si hay `fiscal + laboral`, se envía email a **ambos asesores**
- `recepcion` es fallback: si hay categorías específicas + recepción, se ignora recepción

### 3. Auto-respuesta Sincronizada ✅

- La auto-respuesta se envía **al cerrar la ventana**, no inmediatamente
- Si hay múltiples categorías, el mensaje es genérico: "Nuestro equipo te contactará..."
- Si hay una sola categoría específica: "Nuestro equipo de área fiscal te contactará..."

---

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src/webhook.ts` | Simplificado: solo guarda mensajes sin clasificar |
| `src/classifier.ts` | Devuelve array de categorías, lógica de fallback |
| `src/email-processor.ts` | Clasificación diferida, envío a múltiples asesores |
| `src/db.ts` | Nuevas funciones: `classifyUserMessages`, `hasUserReceivedReply`, `classification_id` para conteo correcto |
| `src/whatsapp.ts` | `buildAutoReply` acepta array de categorías |
| `src/email.ts` | Badges de categoría con colores, fecha/hora en español |
| `src/index.ts` | UI mejorada: agrupación, hover de grupo, formato fecha |

---

## Flujo Final

```
┌─────────────────────────────────────────────────────────────┐
│ WEBHOOK POST - Mensaje llega de WhatsApp                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Guardar mensaje en DB         │
         │ • category = NULL             │
         │ • email_sent = 0              │
         │ • wa_reply_sent = 0           │
         └───────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Encolar para procesamiento    │
         └───────────────────────────────┘
                         │
                         │ (CADA 10 SEGUNDOS)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ EMAIL PROCESSOR                                             │
│ ¿Último mensaje del usuario > 15s atrás?                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                    ┌────┴────┐
                    │   SÍ    │
                    └────┬────┘
                         │
         ┌───────────────┴───────────────┐
         │ CIERRE DE VENTANA             │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │ 1. Concatenar todos los       │
         │    textos del usuario         │
         │ 2. Clasificar con IA          │
         │    → Detectar TODAS las       │
         │      categorías               │
         │ 3. Aplicar lógica fallback:   │
         │    - recepcion + fiscal       │
         │      → solo fiscal            │
         │    - fiscal + laboral         │
         │      → ambos                  │
         │ 4. Generar classification_id  │
         │    (UUID único por grupo)     │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │ 5. Enviar auto-respuesta      │
         │    • 1 categoría: "área X"    │
         │    • múltiples: "equipo"      │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │ 6. Enviar email consolidado   │
         │    a CADA asesor relevante    │
         └───────────────────────────────┘
```

---

## Mejoras de UI Web

### Tabla de mensajes (`/messages`)

- **Agrupación visual por `classification_id`**: Mensajes clasificados juntos (mismo UUID) comparten celdas (categoría, resumen, reply, email). Mensajes con mismo summary pero clasificados por separado NO se agrupan.
- **Hover de grupo**: Al pasar el mouse sobre cualquier fila, se ilumina todo el grupo
- **Separador**: Fila vacía entre grupos
- **Badges de categoría**: Colores por tipo (fiscal=azul, laboral=naranja, contabilidad=verde, recepcion=rosa)
- **Formato fecha**: DD/MM/YY HH:MM:SS (hora local del sistema)
- **Clip para adjuntos**: 📎 en lugar de "-" para mensajes multimedia sin texto
- **Hover en botón Refrescar**: Color más oscuro al pasar el mouse

### Emails

- **Badges de categoría** con los mismos colores que la web
- **Fecha en español con año**: "Lunes, 2 de febrero de 2026"
- **Hora en 24h**: "14:30" (hora local del sistema)
- **Múltiples categorías**: Se muestran como badges separados

---

## Ejemplo de Funcionamiento

```
22:30:26  Msg 1 "A qué hora abrís?"         → DB (sin clasificar)
22:30:32  Msg 2 "Quiero traer documentación" → DB (sin clasificar)
22:30:45  Msg 3 "Para la trimestral del IVA" → DB (sin clasificar)

22:31:00  Processor ejecuta
          → MAX(created_at) = 22:30:45 (15s atrás) → SÍ procesar
          → Clasificar: "A qué hora abrís?\nQuiero traer documentación\nPara la trimestral del IVA"
          → IA detecta: ["fiscal"] (recepción ignorada por fallback)
          → Auto-respuesta: "Nuestro equipo de área fiscal te contactará..."
          → Email enviado a: asesor fiscal

RESULTADO: 1 auto-respuesta + 1 email con 3 mensajes
```

---

## Conteo de Clasificaciones IA

### Problema Original

El conteo de "Clasificaciones IA" en la UI web contaba mensajes con `category IS NOT NULL`, lo que resultaba en un número inflado cuando múltiples mensajes se clasificaban juntos.

**Ejemplo:** 3 mensajes clasificados juntos → contaba como 3 clasificaciones (incorrecto)

### Solución Implementada

Se añadió el campo `classification_id` (UUID) a la tabla `messages`:

- Cuando varios mensajes se clasifican juntos, todos reciben el **mismo UUID**
- El conteo correcto es: `COUNT(DISTINCT classification_id)`

**Ejemplo:** 3 mensajes con el mismo `classification_id` → cuenta como 1 clasificación (correcto)

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/db.ts` | Nueva columna `classification_id`, migración automática, conteo con `COUNT(DISTINCT)`, `getAllMessages` incluye `classification_id` |
| `src/email-processor.ts` | Genera UUID con `crypto.randomUUID()` al clasificar |
| `src/index.ts` | Agrupación visual por `classification_id` en lugar de `summary` |
| `src/email.ts` | Fecha con año, hora local del sistema |

---

## Fecha de implementación

- **Inicio**: 2026-02-01 22:30
- **Completado**: 2026-02-02 00:30
- **Corrección conteo y agrupación visual**: 2026-02-02 01:20
