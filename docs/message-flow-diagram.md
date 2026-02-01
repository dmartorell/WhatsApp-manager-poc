# Diagrama de Flujo - WhatsApp Manager

## Flujo Principal del Sistema

```mermaid
flowchart TB
    subgraph META["☁️ Meta Cloud API"]
        WA_CLIENT[📱 Cliente WhatsApp]
        META_API[Meta Graph API]
    end

    subgraph WEBHOOK["🔗 Webhook Endpoint"]
        WH_GET["GET /webhook<br/>Verificación"]
        WH_POST["POST /webhook<br/>Recepción"]
    end

    subgraph PROCESSING["⚙️ Procesamiento de Mensaje"]
        DEDUPE{{"¿Mensaje ya<br/>procesado?"}}
        PARSE["Extraer datos:<br/>- tipo (text/image/document)<br/>- contenido/caption<br/>- mediaId"]

        subgraph MEDIA_DOWNLOAD["📥 Descarga Multimedia"]
            CHECK_MEDIA{{"¿Tiene<br/>mediaId?"}}
            GET_URL["getMediaUrl()<br/>Obtener URL temporal"]
            DOWNLOAD["downloadMedia()<br/>Descargar binario"]
            SAVE["Guardar en /media/<br/>{msgId}.{ext}"]
        end
    end

    subgraph CONTEXT["🔍 Detección de Contexto"]
        RECENT{{"¿Mensaje reciente<br/>del mismo usuario?<br/>(< 15 segundos)"}}

        subgraph CASES["📋 Casos de Clasificación"]
            CASE1["CASO 1<br/>Media sin texto<br/>después de mensaje"]
            CASE2["CASO 2<br/>Texto después<br/>de mensaje"]
            CASE3["CASO 3<br/>Texto después de<br/>media sin texto"]
            CASE4["CASO 4<br/>Mensaje<br/>independiente"]
        end
    end

    subgraph CLASSIFICATION["🤖 Clasificación IA"]
        CLAUDE["Claude Haiku<br/>classifyMessage()"]
        CATEGORIES["Categorías:<br/>• fiscal<br/>• laboral<br/>• contabilidad<br/>• recepcion"]
        INHERIT["Heredar categoría<br/>del mensaje anterior"]
        RECLASS["Reclasificar mensaje<br/>media anterior"]
    end

    subgraph STORAGE["💾 Persistencia"]
        DB[(SQLite<br/>messages)]
        QUEUE[(email_queue)]
    end

    subgraph RESPONSE["📤 Respuesta al Cliente"]
        AUTO_REPLY{{"¿Es primer mensaje<br/>de la conversación?"}}
        SEND_REPLY["Enviar auto-respuesta<br/>via WhatsApp API"]
        SKIP_REPLY["Omitir respuesta<br/>(ya se envió)"]
    end

    subgraph EMAIL_SYSTEM["📧 Sistema de Email"]
        ENQUEUE["Encolar email"]
        PROCESSOR["Email Processor<br/>(cada 10s)"]
        BATCH["Agrupar mensajes<br/>misma conversación"]
        SEND_EMAIL["Enviar email<br/>consolidado"]
        ADVISOR[("📬 Bandeja<br/>Asesor")]
    end

    %% Flujo principal
    WA_CLIENT -->|"Envía mensaje"| META_API
    META_API -->|"Webhook POST"| WH_POST

    WH_POST --> DEDUPE
    DEDUPE -->|"Sí"| RETURN_OK["Return 200 OK"]
    DEDUPE -->|"No"| PARSE

    PARSE --> CHECK_MEDIA
    CHECK_MEDIA -->|"Sí"| GET_URL
    CHECK_MEDIA -->|"No"| RECENT
    GET_URL --> DOWNLOAD
    DOWNLOAD --> SAVE
    SAVE --> RECENT

    RECENT -->|"Sí + Media sin texto"| CASE1
    RECENT -->|"Sí + Texto"| CASE2
    RECENT -->|"No + Texto + Media previa sin texto"| CASE3
    RECENT -->|"No"| CASE4

    CASE1 --> INHERIT
    CASE2 --> INHERIT
    CASE3 --> CLAUDE
    CASE4 --> CLAUDE

    CLAUDE --> CATEGORIES
    CATEGORIES --> RECLASS
    RECLASS --> DB
    INHERIT --> DB

    DB --> AUTO_REPLY
    AUTO_REPLY -->|"Sí (sin contexto previo)"| SEND_REPLY
    AUTO_REPLY -->|"No (hay contexto)"| SKIP_REPLY

    SEND_REPLY --> WA_CLIENT
    SEND_REPLY --> ENQUEUE
    SKIP_REPLY --> ENQUEUE

    ENQUEUE --> QUEUE
    QUEUE --> PROCESSOR
    PROCESSOR -->|"Entradas > 15s"| BATCH
    BATCH --> SEND_EMAIL
    SEND_EMAIL --> ADVISOR

    %% Styling
    classDef metaStyle fill:#25D366,stroke:#128C7E,color:#fff
    classDef processStyle fill:#0088cc,stroke:#005580,color:#fff
    classDef aiStyle fill:#8B5CF6,stroke:#6D28D9,color:#fff
    classDef dbStyle fill:#F59E0B,stroke:#D97706,color:#fff
    classDef emailStyle fill:#EF4444,stroke:#DC2626,color:#fff

    class WA_CLIENT,META_API metaStyle
    class CLAUDE,CATEGORIES aiStyle
    class DB,QUEUE dbStyle
    class SEND_EMAIL,ADVISOR emailStyle
```

## Detalle de los 4 Casos de Clasificación

```mermaid
flowchart LR
    subgraph INPUT["📨 Mensaje Entrante"]
        MSG["Nuevo mensaje<br/>del usuario"]
    end

    subgraph DECISION["🔀 Árbol de Decisión"]
        Q1{{"¿Hay mensaje<br/>reciente (< 15s)?"}}
        Q2{{"¿Tipo de<br/>mensaje actual?"}}
        Q3{{"¿Hay media previa<br/>sin texto?"}}
    end

    subgraph CASE1["📎 CASO 1"]
        C1_DESC["Media sin texto<br/>después de mensaje"]
        C1_ACTION["✅ Heredar categoría<br/>✅ Heredar asesor<br/>❌ Sin llamada IA<br/>❌ Sin auto-respuesta"]
    end

    subgraph CASE2["💬 CASO 2"]
        C2_DESC["Texto después<br/>de mensaje previo"]
        C2_ACTION["✅ Heredar categoría<br/>✅ Heredar asesor<br/>❌ Sin llamada IA<br/>❌ Sin auto-respuesta"]
    end

    subgraph CASE3["🔄 CASO 3"]
        C3_DESC["Texto llega después<br/>de media sin texto"]
        C3_ACTION["✅ Clasificar con IA<br/>✅ Reclasificar media anterior<br/>✅ Enviar auto-respuesta"]
    end

    subgraph CASE4["🆕 CASO 4"]
        C4_DESC["Mensaje independiente<br/>(nueva conversación)"]
        C4_ACTION["✅ Clasificar con IA<br/>✅ Enviar auto-respuesta"]
    end

    MSG --> Q1
    Q1 -->|"Sí"| Q2
    Q1 -->|"No"| Q3

    Q2 -->|"Media sin texto"| C1_DESC
    Q2 -->|"Texto"| C2_DESC

    Q3 -->|"Sí"| C3_DESC
    Q3 -->|"No"| C4_DESC

    C1_DESC --> C1_ACTION
    C2_DESC --> C2_ACTION
    C3_DESC --> C3_ACTION
    C4_DESC --> C4_ACTION

    classDef caseStyle fill:#E0E7FF,stroke:#6366F1,color:#1E1B4B
    class C1_DESC,C1_ACTION,C2_DESC,C2_ACTION,C3_DESC,C3_ACTION,C4_DESC,C4_ACTION caseStyle
```

## Flujo del Procesador de Email

```mermaid
flowchart TB
    subgraph TRIGGER["⏰ Activación"]
        CRON["Ejecutar cada 10s"]
    end

    subgraph QUERY["🔍 Consulta"]
        GET_PENDING["Obtener emails pendientes<br/>con created_at > 15s"]
        GET_MSGS["Obtener mensajes no enviados<br/>del mismo usuario<br/>(ventana de 15s)"]
    end

    subgraph BUILD["📝 Construcción"]
        CONSOLIDATE["Consolidar mensajes<br/>en un solo email"]
        ATTACH["Adjuntar archivos<br/>multimedia"]
        FORMAT["Formatear HTML:<br/>• Info cliente<br/>• Categoría<br/>• Resumen<br/>• Mensajes"]
    end

    subgraph SEND["📤 Envío"]
        SMTP["Enviar via SMTP<br/>Nodemailer"]
        SUCCESS{{"¿Éxito?"}}
        MARK_SENT["Marcar como enviado:<br/>• messages.email_sent = 1<br/>• email_queue.status = 'sent'"]
        MARK_FAILED["Marcar como fallido:<br/>• email_queue.status = 'failed'<br/>• Guardar error"]
    end

    CRON --> GET_PENDING
    GET_PENDING -->|"Para cada entrada"| GET_MSGS
    GET_MSGS --> CONSOLIDATE
    CONSOLIDATE --> ATTACH
    ATTACH --> FORMAT
    FORMAT --> SMTP
    SMTP --> SUCCESS
    SUCCESS -->|"Sí"| MARK_SENT
    SUCCESS -->|"No"| MARK_FAILED

    classDef successStyle fill:#10B981,stroke:#059669,color:#fff
    classDef failStyle fill:#EF4444,stroke:#DC2626,color:#fff

    class MARK_SENT successStyle
    class MARK_FAILED failStyle
```

## Ejemplo Timeline: Conversación Multi-mensaje

```mermaid
sequenceDiagram
    participant C as 📱 Cliente
    participant W as 🔗 Webhook
    participant AI as 🤖 Claude
    participant DB as 💾 SQLite
    participant P as ⏰ Processor
    participant A as 📬 Asesor

    Note over C,A: Escenario: Usuario envía imagen + texto de seguimiento

    C->>W: 20:59:58 - Imagen + caption "Factura pendiente"
    W->>W: Descargar imagen → /media/msg1.pdf
    W->>AI: Clasificar texto
    AI-->>W: {categoria: "contabilidad", resumen: "Consulta facturación"}
    W->>DB: INSERT mensaje (category=contabilidad)
    W->>DB: INSERT email_queue
    W->>C: Auto-respuesta: "Tu asesor Contable te contactará..."

    C->>W: 21:00:02 - Texto "Es del año 2025"
    W->>DB: Buscar mensaje reciente (< 15s) ✓
    Note over W: CASO 2: Heredar categoría
    W->>DB: INSERT mensaje (category=contabilidad, heredado)
    Note over W: Sin auto-respuesta (hay contexto)

    C->>W: 21:00:08 - Imagen sin caption
    W->>W: Descargar imagen → /media/msg3.jpg
    W->>DB: Buscar mensaje reciente (< 15s) ✓
    Note over W: CASO 1: Heredar categoría
    W->>DB: INSERT mensaje (category=contabilidad, heredado)
    Note over W: Sin auto-respuesta (hay contexto)

    Note over P: 21:00:25 - Processor ejecuta

    P->>DB: Buscar emails pendientes > 15s
    DB-->>P: email_queue entry (created 20:59:58)
    P->>DB: Buscar mensajes no enviados del usuario
    DB-->>P: 3 mensajes consolidados
    P->>P: Construir email HTML con 3 mensajes + 2 adjuntos
    P->>A: Enviar email consolidado via SMTP
    P->>DB: Marcar 3 mensajes como email_sent=1
    P->>DB: Marcar queue entry como status='sent'
```

## Estructura de Categorías y Asesores

```mermaid
graph TB
    subgraph CLASIFICACION["🏷️ Clasificación IA"]
        INPUT["Texto del mensaje"]
        CLAUDE["Claude Haiku"]

        subgraph CATS["Categorías"]
            FISCAL["💰 fiscal<br/>IVA, IRPF, declaraciones"]
            LABORAL["👷 laboral<br/>Nóminas, contratos, SS"]
            CONTAB["📊 contabilidad<br/>Facturas, balances"]
            RECEP["📞 recepcion<br/>Consultas generales"]
        end
    end

    subgraph ASIGNACION["👤 Asignación"]
        ASESOR_F["Asesor Fiscal<br/>fiscal@empresa.com"]
        ASESOR_L["Asesor Laboral<br/>laboral@empresa.com"]
        ASESOR_C["Asesor Contable<br/>contabilidad@empresa.com"]
        RECEPCION["Recepción<br/>recepcion@empresa.com"]
    end

    INPUT --> CLAUDE
    CLAUDE --> FISCAL
    CLAUDE --> LABORAL
    CLAUDE --> CONTAB
    CLAUDE --> RECEP

    FISCAL --> ASESOR_F
    LABORAL --> ASESOR_L
    CONTAB --> ASESOR_C
    RECEP --> RECEPCION

    classDef fiscalStyle fill:#3B82F6,stroke:#2563EB,color:#fff
    classDef laboralStyle fill:#F97316,stroke:#EA580C,color:#fff
    classDef contabStyle fill:#10B981,stroke:#059669,color:#fff
    classDef recepStyle fill:#8B5CF6,stroke:#7C3AED,color:#fff

    class FISCAL,ASESOR_F fiscalStyle
    class LABORAL,ASESOR_L laboralStyle
    class CONTAB,ASESOR_C contabStyle
    class RECEP,RECEPCION recepStyle
```

## Manejo de Tipos de Mensaje

```mermaid
graph LR
    subgraph TIPOS["📨 Tipos de Mensaje"]
        TEXT["💬 text<br/>message.text.body"]
        IMAGE["🖼️ image<br/>message.image.id<br/>message.image.caption"]
        DOC["📄 document<br/>message.document.id<br/>message.document.caption"]
    end

    subgraph EXTRACCION["📥 Extracción"]
        TEXT --> T_CONTENT["contentText = body"]
        IMAGE --> I_CONTENT["contentText = caption<br/>mediaId = id"]
        DOC --> D_CONTENT["contentText = caption<br/>mediaId = id"]
    end

    subgraph DESCARGA["💾 Descarga Media"]
        I_CONTENT --> DOWNLOAD
        D_CONTENT --> DOWNLOAD

        DOWNLOAD["downloadAndSaveMedia()"]

        DOWNLOAD --> EXT["Extensiones:<br/>.jpg, .png, .pdf,<br/>.ogg, .mp4"]
    end

    subgraph ALMACEN["📁 Almacenamiento"]
        T_CONTENT --> DB_TEXT["media_url = null"]
        EXT --> DB_MEDIA["media_url = /media/{id}.ext"]
    end
```

## Resumen de Optimizaciones

| Patrón | Descripción | Beneficio |
|--------|-------------|-----------|
| 🔁 Deduplicación | UNIQUE en wa_message_id | Evita procesar duplicados |
| ⏱️ Ventana de contexto | 15 segundos | Agrupa conversaciones |
| 🤖 Herencia de clasificación | Casos 1 y 2 | Reduce llamadas a IA |
| 📧 Email consolidado | Batch de mensajes | Un email por conversación |
| 💬 Auto-respuesta única | Solo primer mensaje | No spam al cliente |
| 🔄 Reclasificación | Caso 3 | Media sin texto clasificada correctamente |
