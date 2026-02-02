# Plan de implementación — WhatsApp Manager para Gestoría

## Resumen

**Prueba de concepto** de un sistema que recibe mensajes de WhatsApp (texto, imágenes, PDFs), clasifica la consulta mediante IA, responde automáticamente al cliente confirmando recepción, y reenvía el mensaje al email del asesor correspondiente.

> **Entorno 100% simulado**: número de prueba de Meta, asesores ficticios, emails con aliases de Gmail. Sin datos reales de ninguna gestoría. El objetivo es validar el flujo completo antes de conectar con un cliente real.

---

## 1. Arquitectura

```
Cliente WhatsApp
       │
       ▼
Meta Cloud API  ──webhook POST──▶  Servidor Node.js (Express)
                                        │
                                   ┌────┴─────┐
                                   │ Clasificar│
                                   │ (Claude)  │
                                   └────┬─────┘
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                    Auto-reply     Email SMTP     Log (SQLite)
                    al cliente     al asesor      del mensaje
```

> **Sin bidireccionalidad**: el asesor recibe el email pero responde al cliente directamente por WhatsApp o teléfono. El sistema no gestiona respuestas.

### Flujo de un mensaje entrante

1. Tú (desde tu móvil, simulando ser un cliente) envías mensaje al número de prueba de Meta
2. Meta envía webhook POST al servidor (expuesto vía ngrok en desarrollo)
3. El servidor descarga los archivos multimedia si los hay (vía Meta API)
4. Claude API clasifica el mensaje → determina **categoría** y **asesor destino**
5. Se envía auto-respuesta al cliente (tu móvil): _"Hemos recibido tu consulta. Tu asesor [Nombre] te contactará en breve."_
6. Se reenvía el mensaje + adjuntos por email al alias de Gmail correspondiente
7. Se registra el mensaje en SQLite (trazabilidad)

---

## 2. Stack técnico

| Componente | Tecnología | Justificación |
|---|---|---|
| Runtime | Node.js 20+ | Preferencia del cliente |
| Framework HTTP | **Hono** (TypeScript) | TS nativo, middleware integrado, ligero |
| API WhatsApp | Meta Cloud API (oficial) | Sin riesgo de baneo |
| Clasificación IA | Claude API (Haiku) | Barato, rápido, bilingüe cat/es |
| Email | Nodemailer + SMTP | Estándar, cualquier proveedor |
| Base de datos | SQLite (better-sqlite3) | ~10 msgs/día, no necesita Postgres |
| Túnel desarrollo | ngrok | Para pruebas locales con webhook |

---

## 3. Clasificación de consultas

Las categorías y asesores se configuran en un JSON editable (`config/advisors.json`). Esto permite cambiar asesores o añadir categorías sin tocar código.

**Configuración de prueba (datos simulados):**

```json
{
  "advisors": [
    { "category": "fiscal", "description": "Impuestos, IVA, IRPF, declaraciones, modelos tributarios", "name": "Asesor Fiscal (demo)", "email": "TU_EMAIL+fiscal@gmail.com" },
    { "category": "laboral", "description": "Nóminas, contratos, Seguridad Social, bajas, altas", "name": "Asesor Laboral (demo)", "email": "TU_EMAIL+laboral@gmail.com" },
    { "category": "contabilidad", "description": "Facturas, balances, cuentas anuales, asientos", "name": "Asesor Contable (demo)", "email": "TU_EMAIL+contabilidad@gmail.com" }
  ],
  "recepcion": { "name": "Recepción (demo)", "email": "TU_EMAIL+recepcion@gmail.com" }
}
```

> Todos los emails van al mismo buzón de Gmail. Puedes verificar el enrutamiento filtrando por destinatario.

> **Para producción**: sustituir por nombres y emails reales de la gestoría.

### Prompt de clasificación (borrador)

```
Eres el sistema de clasificación de una gestoría. Dado un mensaje de un cliente
(en castellano o catalán), clasifícalo en UNA de estas categorías:
{{categories}}

Si el mensaje no encaja claramente en ninguna categoría, usa "recepcion".
Si el mensaje incluye una imagen o PDF sin texto, clasifica como "recepcion"
con resumen "Documento adjunto sin texto — requiere revisión manual".

Responde SOLO con un JSON: {"categoria": "...", "resumen": "..."}
El resumen debe ser una frase de máximo 15 palabras describiendo la consulta.
```

> `{{categories}}` se genera dinámicamente desde `advisors.json`, así que al añadir o quitar categorías el prompt se actualiza solo.

---

## 4. Estructura del proyecto

```
whatsapp-manager/
├── config/
│   └── advisors.json         # Categorías, asesores y emails (editable)
├── src/
│   ├── index.ts              # Entry point, Hono server
│   ├── config.ts             # Variables de entorno (tipadas)
│   ├── webhook.ts            # Rutas GET (verificación) y POST (mensajes)
│   ├── whatsapp.ts           # Cliente Meta API (enviar mensajes, descargar media)
│   ├── classifier.ts         # Clasificación con Claude API
│   ├── email.ts              # Envío de emails con Nodemailer
│   ├── db.ts                 # SQLite — registro de mensajes
│   └── rules.ts              # Mapeo categoría → asesor + lógica de enrutamiento
├── media/                    # Archivos descargados (gitignored)
├── .env.example              # Template de variables de entorno
├── package.json
├── tsconfig.json             # Configuración TypeScript
├── README.md
└── docker-compose.yml        # Para despliegue (opcional)
```

---

## 5. Modelo de datos (SQLite)

```sql
CREATE TABLE messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id     TEXT UNIQUE,           -- ID de Meta para deduplicación
    from_phone        TEXT NOT NULL,          -- Teléfono del cliente
    from_name         TEXT,                   -- Nombre del contacto
    content_type      TEXT NOT NULL,          -- text | image | document
    content_text      TEXT,                   -- Texto del mensaje (o caption)
    media_url         TEXT,                   -- URL local del archivo descargado
    category          TEXT,                   -- Categoría asignada por IA
    summary           TEXT,                   -- Resumen generado por IA
    assigned_to       TEXT,                   -- Email del asesor asignado
    classification_id TEXT,                   -- UUID que agrupa mensajes clasificados juntos
    email_sent        INTEGER DEFAULT 0,      -- 1 = email enviado correctamente
    wa_reply_sent     INTEGER DEFAULT 0,      -- 1 = auto-reply enviado
    created_at        TEXT DEFAULT (datetime('now')),
    error             TEXT                    -- Último error si lo hubo
);
```

> **Nota sobre `classification_id`**: Cuando varios mensajes de un usuario se clasifican juntos (ventana de contexto de 15s), todos reciben el mismo UUID. Esto permite contar clasificaciones reales con `COUNT(DISTINCT classification_id)` en lugar de contar mensajes.

---

## 6. Gestión de archivos multimedia

Cuando el cliente envía una imagen o PDF:

1. **Descargar** el archivo vía Meta API (`GET /{media-id}` → URL temporal → descargar binario)
2. **Guardar** en `./media/{wa_message_id}_{filename}`
3. **Adjuntar** al email con Nodemailer (MIME attachment)
4. **Incluir caption** si lo tiene como cuerpo del email

Formatos soportados: `image/jpeg`, `image/png`, `application/pdf`.

---

## 7. Hosting

### Hosting (solo desarrollo)

Servidor local (Node.js) + **ngrok** para exponer el webhook a Meta. Sin coste.

> Para producción futura: Railway (~$5/mes) o VPS (Hetzner ~$4/mes).

---

## 8. Estimación de costes (desarrollo / POC)

| Concepto | Coste |
|---|---|
| Hosting (local + ngrok) | $0 |
| WhatsApp Business API (número de prueba) | $0 |
| Claude API — Haiku (~10 clasificaciones/día) | < $0.50/mes |
| Email (Ethereal o Gmail) | $0 |
| **Total** | **~$0** |

---

## 9. Fases de implementación

---

### Fase 1 — Setup y webhook básico

**Objetivo**: Recibir un mensaje de WhatsApp en tu servidor local y verlo en consola.

**Antes de empezar necesitas tener:**

- [x] **Node.js 20+** instalado en tu máquina
- [x] **ngrok** instalado ([ngrok.com](https://ngrok.com/)) — cuenta gratuita, sin tarjeta
- [x] **Cuenta personal de Facebook** (para acceder a Meta for Developers)
- [x] **Cuenta Meta Business** creada en [business.facebook.com](https://business.facebook.com/)
- [x] **App de Meta for Developers** creada en [developers.facebook.com](https://developers.facebook.com/) con el producto "WhatsApp" activado
- [x] De la app de Meta, anotar estos 3 valores:
  - `WA_PHONE_NUMBER_ID` — ID del número de prueba (formato numérico)
  - `WA_ACCESS_TOKEN` — Token temporal (caduca en 24h, se regenera desde el dashboard)
  - `WA_VERIFY_TOKEN` — String que tú inventas (ej: `mi-token-secreto-123`)
- [x] **Tu número de móvil personal** verificado como receptor de prueba en la app de Meta (para simular al "cliente")

**Tareas:**

- [x] Crear proyecto Node.js con Hono + TypeScript (`tsx` como runner para desarrollo)
- [x] Implementar endpoint GET `/webhook` (verificación de Meta)
- [x] Implementar endpoint POST `/webhook` (recepción de mensajes)
- [x] Levantar ngrok y registrar la URL como webhook en Meta
- [x] Enviar un mensaje desde tu móvil al número de prueba → verificar que aparece en consola

**Resultado**: ✅ mensaje de WhatsApp llega a tu servidor y se imprime en terminal.

---

### Fase 2 — Clasificación IA y auto-respuesta

**Objetivo**: El servidor clasifica el mensaje, responde automáticamente al cliente por WhatsApp, y guarda el registro en base de datos.

**Antes de empezar necesitas tener:**

- [x] **Fase 1 completada** y funcionando
- [x] **Cuenta en Anthropic** creada en [console.anthropic.com](https://console.anthropic.com/)
- [x] **API key de Anthropic** generada
- [x] **Créditos en Anthropic** (~$5 es suficiente para meses de pruebas)
- [x] De Anthropic, anotar:
  - `ANTHROPIC_API_KEY` — tu clave de API

**Tareas:**

- [x] Crear `src/advisors.ts` con asesores simulados (migrado de JSON a TypeScript)
- [x] Implementar `classifier.ts` — llamada a Claude Haiku con el prompt de clasificación
- [x] Implementar `db.ts` — crear tabla SQLite y guardar mensajes
- [x] Implementar auto-respuesta al cliente vía Meta API
- [x] Implementar contexto temporal (15 seg) para agrupar mensajes del mismo usuario
- [x] Probar: enviar mensaje → recibir clasificación en consola + auto-reply en tu móvil + registro en SQLite

**Resultado**: ✅ envías "Necesito presentar el IVA del trimestre" → recibes auto-reply en tu móvil → en consola ves `{ categoria: "fiscal", resumen: "..." }` → registro guardado en SQLite.

---

### Fase 3 — Reenvío por email y multimedia

**Objetivo**: El mensaje clasificado (con adjuntos si los hay) llega al email del asesor correspondiente.

**Antes de empezar necesitas tener:**

- [x] **Fase 2 completada** y funcionando
- [ ] **Una de estas dos opciones de email configurada:**
  - **Opción A — Ethereal** (no envía emails reales, solo para ver el resultado): Generar credenciales en [ethereal.email](https://ethereal.email/create)
  - **Opción B — Gmail** (emails llegan de verdad a tu buzón): Necesitas una [App Password de Google](https://myaccount.google.com/apppasswords) (requiere 2FA activado en tu cuenta)
- [ ] De tu proveedor de email, anotar:
  - `SMTP_HOST` — ej: `smtp.ethereal.email` o `smtp.gmail.com`
  - `SMTP_PORT` — ej: `587`
  - `SMTP_USER` — tu usuario/email
  - `SMTP_PASSWORD` — password de Ethereal o App Password de Gmail
  - `EMAIL_FROM` — dirección de remitente

**Tareas:**

- [x] Implementar `email.ts` — envío con Nodemailer
- [x] Implementar descarga de multimedia (imágenes/PDFs) vía Meta API
- [x] Adjuntar archivos multimedia al email
- [x] Implementar `rules.ts` — mapeo categoría → asesor → email destino (ya existía en classifier.ts)
- [x] Manejo de errores y reintentos
- [x] Probar flujo completo: mensaje de WhatsApp → clasificación → auto-reply → email al asesor correcto con adjuntos

**Resultado**: ✅ envías "Adjunto factura del proveedor" + foto → recibes auto-reply → en tu buzón de Gmail llega un email a `TU_EMAIL+contabilidad@gmail.com` con la foto adjunta y el resumen de la IA.

---

### Fase 4 — Deploy y producción (fuera de la POC)

> Esta fase solo aplica cuando se quiera pasar a producción con una gestoría real. No forma parte de la prueba de concepto.

**Necesitarás:**

- [ ] Cuenta en Railway / Render / VPS
- [ ] Número de WhatsApp real de la gestoría
- [ ] Emails y nombres reales de los asesores
- [ ] SMTP del dominio de la gestoría
- [ ] Token permanente de Meta (no el temporal de desarrollo)

**Tareas:**

- [ ] Desplegar en hosting
- [ ] Configurar webhook URL definitiva en Meta
- [ ] Migrar de número de prueba a número real
- [ ] Rellenar `advisors.json` con datos reales
- [ ] Verificar flujo completo end-to-end

---

## 10. Decisiones resueltas

| Pregunta | Decisión |
|---|---|
| Bidireccionalidad | **No.** Solo auto-reply al cliente + forward al asesor. |
| Número WhatsApp | Número de prueba de Meta (sandbox). |
| Categorías y asesores | Simulados: fiscal, laboral, contabilidad + recepcion. Aliases de Gmail. |
| Hosting | **Local + ngrok** para desarrollo. Railway/VPS cuando se pase a producción. |
| Datos reales | **Ninguno.** Todo simulado para prueba de concepto. |

## 11. Pendiente para producción (fuera del alcance de esta POC)

1. Rellenar `advisors.json` con nombres, categorías y emails reales
2. Decidir número WhatsApp: nuevo o migrar el existente de la gestoría
3. Texto exacto de auto-respuesta al cliente
4. Credenciales SMTP del dominio de la gestoría
5. Deploy en Railway o VPS
6. Enriquecer emails con metadata del cliente (NIF, empresa, tipo, notas) desde base de datos/CRM de la gestoría

---

## 12. Mejoras implementadas (post-POC)

### Mejora 1: Agrupación de emails por ventana de contexto

**Problema:** Cada mensaje generaba un email inmediato al asesor. Si el cliente enviaba texto + imagen en 5 segundos, el asesor recibía 2 emails separados.

**Solución:** Cola de emails en base de datos con procesador periódico.

**Flujo:**
```
12:00:00 - Mensaje texto  → Guardar en BD, encolar email (pending)
12:00:05 - Mensaje imagen → Guardar en BD, ya existe cola para este usuario
12:00:20 - Procesador     → Detecta ventana cerrada (>15s), envía email consolidado
```

**Archivos modificados:**
- `src/db.ts` — nueva tabla `email_queue` y queries de agrupación
- `src/webhook.ts` — encola en lugar de enviar directamente
- `src/email.ts` — función `buildConsolidatedEmail()` para múltiples mensajes
- `src/email-processor.ts` — nuevo módulo que procesa la cola cada 10s
- `src/index.ts` — inicia el procesador al arrancar

**Resultado:** El asesor recibe UN email con todos los mensajes del cliente agrupados.

---

## 13. Mejoras futuras (pendientes de implementar)

### Mejoras del mensaje de feedback al usuario en WhatsApp

Actualmente el auto-reply es genérico: _"Hemos recibido tu consulta. Tu asesor [Nombre] te contactará en breve."_

**Posibles mejoras:**

1. **Mensaje personalizado por categoría** — texto diferente para fiscal, laboral, contabilidad
2. **Incluir resumen de la IA** — confirmar al cliente qué se ha entendido de su consulta
3. **Tiempo estimado de respuesta** — según horario laboral o carga del asesor
4. **Número de referencia** — para que el cliente pueda hacer seguimiento
5. **Confirmación de adjuntos** — indicar cuántos archivos se han recibido correctamente
6. **Mensajes en catalán/castellano** — detectar idioma del cliente y responder en el mismo
7. **Uso del nombre del cliente** — personalizar el saludo con el nombre del contacto (ej: "Hola Dani, hemos recibido...")
