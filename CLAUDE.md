# WhatsApp Manager POC

## Descripción

Prueba de concepto de un sistema de gestión de mensajes de WhatsApp para una gestoría. El sistema:

1. Recibe mensajes de WhatsApp (texto, imágenes, PDFs) vía webhook de Meta Cloud API
2. Clasifica automáticamente la consulta mediante Claude AI (fiscal, laboral, contabilidad)
3. Responde automáticamente al cliente confirmando recepción
4. Reenvía el mensaje al email del asesor correspondiente

## Stack técnico

- **Runtime:** Node.js 20+
- **Framework:** Hono (TypeScript)
- **API WhatsApp:** Meta Cloud API
- **Clasificación IA:** Claude API (Haiku)
- **Email:** Nodemailer + SMTP
- **Base de datos:** SQLite (better-sqlite3)
- **Túnel desarrollo:** ngrok

## Estructura del proyecto

```
├── config/           # Configuración de asesores y categorías
├── src/
│   ├── index.ts      # Entry point, servidor Hono
│   ├── config.ts     # Variables de entorno
│   ├── webhook.ts    # Endpoints GET/POST para webhook de Meta
│   ├── whatsapp.ts   # Cliente Meta API
│   ├── classifier.ts # Clasificación con Claude
│   ├── email.ts      # Envío de emails
│   ├── db.ts         # SQLite
│   └── rules.ts      # Mapeo categoría → asesor
├── plans/            # Documentación del plan de implementación
└── media/            # Archivos multimedia descargados (gitignored)
```

## Comandos

```bash
npm run dev    # Desarrollo con hot reload (tsx watch)
npm run build  # Compilar TypeScript
npm start      # Ejecutar build de producción
```

## Variables de entorno

Ver `.env.example` para la lista completa. Principales:

- `WA_PHONE_NUMBER_ID` - ID del número de WhatsApp en Meta
- `WA_ACCESS_TOKEN` - Token de acceso de Meta
- `WA_VERIFY_TOKEN` - Token de verificación del webhook
- `ANTHROPIC_API_KEY` - API key de Claude (Fase 2)
- `SMTP_*` - Configuración de email (Fase 3)

## Convenciones de código

- **No usar operador non-null assertion (`!`)** — usar validación explícita con error descriptivo
- Formateo automático con ESLint (ver `.vscode/settings.json`)