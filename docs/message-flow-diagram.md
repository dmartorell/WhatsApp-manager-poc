# Diagrama de Flujo - WhatsApp Manager

> **Última actualización:** Soporte audio/video + validación Zod

## Flujo Principal del Sistema

```mermaid
flowchart TB
    subgraph META["☁️ Meta Cloud API"]
        WA_CLIENT[📱 Cliente WhatsApp]
        META_API[Meta Graph API]
    end

    subgraph WEBHOOK["🔗 Webhook POST /webhook"]
        WH_POST["Recibir mensaje"]
        DEDUPE{{"¿Duplicado?"}}
        PARSE["Extraer datos:<br/>• tipo (text/image/document/audio/video)<br/>• contenido/caption<br/>• mediaId"]
        DOWNLOAD["Descargar multimedia<br/>a /media/{msgId}.ext"]
        SAVE_RAW["💾 Guardar mensaje<br/>SIN CLASIFICAR<br/>category = NULL"]
        ENQUEUE["📬 Encolar para<br/>procesamiento"]
    end

    subgraph PROCESSOR["⏰ Email Processor (cada 10s)"]
        CHECK_PENDING["Buscar emails pendientes"]
        CHECK_WINDOW{{"¿Último mensaje<br/>> 15 segundos?"}}

        subgraph CLASSIFICATION["🤖 Clasificación Diferida"]
            CONCAT["Concatenar TODOS<br/>los textos del usuario"]
            CLAUDE["Claude Haiku<br/>classifyMessage()"]
            MULTI_CAT["Detectar MÚLTIPLES<br/>categorías"]
            FALLBACK["Aplicar fallback:<br/>recepcion + fiscal → fiscal"]
        end

        subgraph ACTIONS["📤 Acciones Sincronizadas"]
            REPLY{{"¿Usuario ya<br/>recibió respuesta?"}}
            SEND_REPLY["Enviar auto-respuesta<br/>a WhatsApp"]
            SEND_EMAILS["Enviar email a CADA<br/>asesor relevante"]
        end
    end

    subgraph DB["💾 SQLite"]
        MESSAGES[(messages<br/>category=NULL)]
        QUEUE[(email_queue)]
        CLASSIFIED[(messages<br/>category=fiscal,...)]
    end

    subgraph OUTPUT["📬 Destinos"]
        CLIENT_REPLY["📱 Cliente recibe<br/>auto-respuesta"]
        ADVISOR1["📧 Asesor Fiscal"]
        ADVISOR2["📧 Asesor Laboral"]
        ADVISOR3["📧 Asesor Contable"]
    end

    %% Flujo webhook
    WA_CLIENT -->|"Envía mensaje"| META_API
    META_API -->|"POST"| WH_POST
    WH_POST --> DEDUPE
    DEDUPE -->|"Sí"| RETURN_OK["Return 200"]
    DEDUPE -->|"No"| PARSE
    PARSE --> DOWNLOAD
    DOWNLOAD --> SAVE_RAW
    SAVE_RAW --> MESSAGES
    SAVE_RAW --> ENQUEUE
    ENQUEUE --> QUEUE

    %% Flujo processor
    QUEUE --> CHECK_PENDING
    CHECK_PENDING --> CHECK_WINDOW
    CHECK_WINDOW -->|"No (esperar)"| CHECK_PENDING
    CHECK_WINDOW -->|"Sí (ventana cerrada)"| CONCAT
    CONCAT --> CLAUDE
    CLAUDE --> MULTI_CAT
    MULTI_CAT --> FALLBACK
    FALLBACK --> CLASSIFIED
    FALLBACK --> REPLY
    REPLY -->|"No"| SEND_REPLY
    REPLY -->|"Sí (skip)"| SEND_EMAILS
    SEND_REPLY --> CLIENT_REPLY
    SEND_REPLY --> SEND_EMAILS
    SEND_EMAILS -->|"fiscal"| ADVISOR1
    SEND_EMAILS -->|"laboral"| ADVISOR2
    SEND_EMAILS -->|"contabilidad"| ADVISOR3

    %% Styling
    classDef webhookStyle fill:#0088cc,stroke:#005580,color:#fff
    classDef processorStyle fill:#8B5CF6,stroke:#6D28D9,color:#fff
    classDef dbStyle fill:#F59E0B,stroke:#D97706,color:#fff
    classDef outputStyle fill:#10B981,stroke:#059669,color:#fff

    class WH_POST,DEDUPE,PARSE,DOWNLOAD,SAVE_RAW,ENQUEUE webhookStyle
    class CHECK_PENDING,CHECK_WINDOW,CONCAT,CLAUDE,MULTI_CAT,FALLBACK,REPLY,SEND_REPLY,SEND_EMAILS processorStyle
    class MESSAGES,QUEUE,CLASSIFIED dbStyle
    class CLIENT_REPLY,ADVISOR1,ADVISOR2,ADVISOR3 outputStyle
```

## Comparación: Antes vs Después del Refactor

```mermaid
flowchart LR
    subgraph ANTES["❌ Flujo Anterior"]
        A1["Msg 1 'hola'"] --> A2["Clasificar → recepcion"]
        A2 --> A3["Auto-respuesta<br/>inmediata"]
        A4["Msg 2 'pagar IVA'"] --> A5["Heredar → recepcion ❌"]
        A5 --> A6["Skip respuesta"]
    end

    subgraph AHORA["✅ Flujo Actual"]
        B1["Msg 1 'hola'"] --> B2["Guardar sin clasificar"]
        B3["Msg 2 'pagar IVA'"] --> B4["Guardar sin clasificar"]
        B2 --> B5["Esperar 15s"]
        B4 --> B5
        B5 --> B6["Clasificar TODO:<br/>'hola + pagar IVA'"]
        B6 --> B7["→ fiscal ✓"]
        B7 --> B8["Auto-respuesta<br/>+ Email"]
    end

    classDef oldStyle fill:#EF4444,stroke:#DC2626,color:#fff
    classDef newStyle fill:#10B981,stroke:#059669,color:#fff

    class A1,A2,A3,A4,A5,A6 oldStyle
    class B1,B2,B3,B4,B5,B6,B7,B8 newStyle
```

## Detalle del Flujo de Clasificación

```mermaid
flowchart TB
    subgraph INPUT["📨 Mensajes Acumulados"]
        MSG1["22:30:26 'A qué hora abrís?'"]
        MSG2["22:30:32 'Quiero traer documentación'"]
        MSG3["22:30:45 📄 Factura.pdf + 'Para la trimestral'"]
    end

    subgraph WAIT["⏳ Ventana de Contexto"]
        TIMER["Esperar 15 segundos<br/>sin nuevos mensajes"]
    end

    subgraph CLASSIFY["🤖 Clasificación IA"]
        CONCAT["Concatenar textos:<br/>'A qué hora abrís?<br/>Quiero traer documentación<br/>Para la trimestral'"]
        CONTEXT["Añadir contexto:<br/>[Tiene adjunto: PDF]"]
        CLAUDE["Claude Haiku"]
        RESPONSE["Respuesta IA:<br/>{<br/>  categorias: ['fiscal', 'recepcion'],<br/>  resumen: 'Consulta IVA trimestral'<br/>}"]
    end

    subgraph FALLBACK["🔄 Lógica de Fallback"]
        CHECK{{"¿Hay categorías<br/>específicas?"}}
        REMOVE["Eliminar 'recepcion'"]
        FINAL["Resultado final:<br/>categorias: ['fiscal']"]
    end

    subgraph OUTPUT["📤 Salida"]
        REPLY["Auto-respuesta:<br/>'Nuestro equipo de área fiscal<br/>te contactará en breve'"]
        EMAIL["Email consolidado<br/>a asesor fiscal<br/>con 3 mensajes + PDF"]
    end

    MSG1 & MSG2 & MSG3 --> TIMER
    TIMER -->|"15s transcurridos"| CONCAT
    CONCAT --> CONTEXT
    CONTEXT --> CLAUDE
    CLAUDE --> RESPONSE
    RESPONSE --> CHECK
    CHECK -->|"Sí (fiscal)"| REMOVE
    CHECK -->|"No (solo recepcion)"| FINAL
    REMOVE --> FINAL
    FINAL --> REPLY
    FINAL --> EMAIL

    classDef waitStyle fill:#FEF3C7,stroke:#F59E0B,color:#92400E
    classDef aiStyle fill:#8B5CF6,stroke:#6D28D9,color:#fff
    classDef fallbackStyle fill:#DBEAFE,stroke:#3B82F6,color:#1E40AF

    class TIMER waitStyle
    class CONCAT,CONTEXT,CLAUDE,RESPONSE aiStyle
    class CHECK,REMOVE,FINAL fallbackStyle
```

## Manejo de Múltiples Categorías

```mermaid
flowchart TB
    subgraph SCENARIO["📨 Escenario"]
        MSG["'Tengo dudas del IVA y<br/>necesito revisar nóminas'"]
    end

    subgraph CLASSIFY["🤖 Clasificación"]
        CLAUDE["Claude detecta<br/>múltiples temas"]
        RESULT["categorias: ['fiscal', 'laboral']"]
    end

    subgraph REPLY["📱 Auto-respuesta"]
        MULTI_TEXT["Mensaje genérico:<br/>'Nuestro equipo te contactará<br/>en breve'"]
    end

    subgraph EMAILS["📧 Emails"]
        EMAIL1["Email 1 → Asesor Fiscal<br/>fiscal@empresa.com"]
        EMAIL2["Email 2 → Asesor Laboral<br/>laboral@empresa.com"]
    end

    MSG --> CLAUDE
    CLAUDE --> RESULT
    RESULT --> MULTI_TEXT
    RESULT --> EMAIL1
    RESULT --> EMAIL2

    classDef fiscalStyle fill:#3B82F6,stroke:#2563EB,color:#fff
    classDef laboralStyle fill:#F97316,stroke:#EA580C,color:#fff

    class EMAIL1 fiscalStyle
    class EMAIL2 laboralStyle
```

## Flujo del Email Processor

```mermaid
flowchart TB
    subgraph TRIGGER["⏰ Activación"]
        CRON["setInterval<br/>cada 10 segundos"]
    end

    subgraph QUERY["🔍 Consulta"]
        GET_PENDING["getPendingEmails()"]
        CHECK_TIME{{"¿Último mensaje<br/>> 15s atrás?"}}
        GET_MSGS["getUnsentMessagesForUser()"]
    end

    subgraph CLASSIFY["🤖 Clasificación Diferida"]
        CONCAT["Concatenar todos los textos"]
        HAS_ATTACH{{"¿Tiene adjuntos?"}}
        ADD_CONTEXT["Añadir: '[Tiene adjunto]'"]
        CALL_CLAUDE["classifyMessage()"]
        GET_ADVISORS["getAdvisorsByCategories()"]
    end

    subgraph DB_UPDATE["💾 Actualizar DB"]
        CLASSIFY_MSGS["classifyUserMessages()<br/>Asignar category, summary"]
    end

    subgraph SEND["📤 Envío"]
        CHECK_REPLIED{{"¿Ya se envió<br/>auto-respuesta?"}}
        SEND_WA["sendTextMessage()<br/>Auto-respuesta"]
        LOOP_ADVISORS["Para CADA asesor:"]
        SEND_EMAIL["sendConsolidatedEmail()"]
        MARK_SENT["markMessagesAsEmailed()<br/>markQueueAsSent()"]
        MARK_FAILED["markQueueAsFailed()"]
    end

    CRON --> GET_PENDING
    GET_PENDING --> CHECK_TIME
    CHECK_TIME -->|"No"| CRON
    CHECK_TIME -->|"Sí"| GET_MSGS
    GET_MSGS --> CONCAT
    CONCAT --> HAS_ATTACH
    HAS_ATTACH -->|"Sí"| ADD_CONTEXT --> CALL_CLAUDE
    HAS_ATTACH -->|"No"| CALL_CLAUDE
    CALL_CLAUDE --> GET_ADVISORS
    GET_ADVISORS --> CLASSIFY_MSGS
    CLASSIFY_MSGS --> CHECK_REPLIED
    CHECK_REPLIED -->|"No"| SEND_WA --> LOOP_ADVISORS
    CHECK_REPLIED -->|"Sí"| LOOP_ADVISORS
    LOOP_ADVISORS --> SEND_EMAIL
    SEND_EMAIL -->|"✅ Éxito"| MARK_SENT
    SEND_EMAIL -->|"❌ Error"| MARK_FAILED

    classDef successStyle fill:#10B981,stroke:#059669,color:#fff
    classDef failStyle fill:#EF4444,stroke:#DC2626,color:#fff

    class MARK_SENT successStyle
    class MARK_FAILED failStyle
```

## Diagrama de Secuencia: Conversación Completa

```mermaid
sequenceDiagram
    participant C as 📱 Cliente
    participant W as 🔗 Webhook
    participant DB as 💾 SQLite
    participant P as ⏰ Processor
    participant AI as 🤖 Claude
    participant A as 📬 Asesores

    Note over C,A: Nuevo flujo: Clasificación diferida + Múltiples categorías

    rect rgb(230, 245, 255)
        Note over C,DB: Fase 1: Recepción (sin clasificar)
        C->>W: 22:30:26 "A qué hora abrís?"
        W->>DB: INSERT (category=NULL)
        W->>DB: INSERT email_queue
        W-->>C: HTTP 200 OK

        C->>W: 22:30:32 "Quiero traer documentación"
        W->>DB: INSERT (category=NULL)
        Note over W: Queue ya existe para este usuario
        W-->>C: HTTP 200 OK

        C->>W: 22:30:45 📄 PDF + "Para la trimestral"
        W->>W: Descargar PDF → /media/
        W->>DB: INSERT (category=NULL, media_url=...)
        W-->>C: HTTP 200 OK
    end

    rect rgb(255, 245, 230)
        Note over P,A: Fase 2: Procesamiento (ventana cerrada)

        P->>P: 22:31:00 Processor ejecuta
        P->>DB: getPendingEmails(15s)
        DB-->>P: Queue de 22:30:26
        P->>P: Último msg: 22:30:45 (15s atrás) ✓

        P->>DB: getUnsentMessagesForUser()
        DB-->>P: 3 mensajes sin clasificar

        P->>P: Concatenar textos + contexto adjunto
        P->>AI: classifyMessage(texto_completo)
        AI-->>P: {categorias: ["fiscal"], resumen: "Consulta IVA"}

        P->>DB: classifyUserMessages() x3
        Note over DB: 3 mensajes ahora tienen category="fiscal"
    end

    rect rgb(230, 255, 230)
        Note over P,A: Fase 3: Envío sincronizado

        P->>DB: hasUserReceivedReply()
        DB-->>P: false

        P->>C: Auto-respuesta: "Área fiscal te contactará..."
        P->>DB: markUserMessagesAsReplied()

        P->>A: Email consolidado (3 msgs + PDF)
        P->>DB: markMessagesAsEmailed()
        P->>DB: markQueueAsSent()
    end

    Note over C,A: ✅ Resultado: 1 clasificación IA, 1 auto-respuesta, 1 email
```

## Estructura de Datos

```mermaid
erDiagram
    messages ||--o{ email_queue : "from_phone"

    messages {
        int id PK
        text wa_message_id UK "ID de Meta"
        text from_phone "Teléfono cliente"
        text from_name "Nombre contacto"
        text content_type "text|image|document|audio|video"
        text content_text "Texto o caption"
        text media_url "Ruta local archivo"
        text category "NULL → 'fiscal, laboral'"
        text summary "Resumen IA"
        text assigned_to "Emails asesores"
        int wa_reply_sent "0|1"
        int email_sent "0|1"
        text created_at "timestamp"
        text error "Mensaje error"
    }

    email_queue {
        int id PK
        text from_phone "Teléfono cliente"
        text status "pending|sent|failed"
        text created_at "timestamp"
        text sent_at "timestamp envío"
        text error "Mensaje error"
    }
```

## Categorías y Asesores

```mermaid
graph TB
    subgraph CLASIFICACION["🏷️ Clasificación IA"]
        INPUT["Texto concatenado"]
        CLAUDE["Claude Haiku"]

        subgraph CATS["Categorías (puede ser múltiples)"]
            FISCAL["💰 fiscal<br/>IVA, IRPF, declaraciones"]
            LABORAL["👷 laboral<br/>Nóminas, contratos, SS"]
            CONTAB["📊 contabilidad<br/>Facturas, balances"]
            RECEP["📞 recepcion<br/>Horarios, dirección"]
        end
    end

    subgraph FALLBACK["🔄 Lógica Fallback"]
        RULE["Si hay categorías específicas<br/>→ eliminar recepcion"]
    end

    subgraph ASIGNACION["👤 Asignación"]
        ASESOR_F["Asesor Fiscal<br/>fiscal@empresa.com"]
        ASESOR_L["Asesor Laboral<br/>laboral@empresa.com"]
        ASESOR_C["Asesor Contable<br/>contabilidad@empresa.com"]
        RECEPCION["Recepción<br/>recepcion@empresa.com"]
    end

    INPUT --> CLAUDE
    CLAUDE --> FISCAL & LABORAL & CONTAB & RECEP
    FISCAL & LABORAL & CONTAB & RECEP --> RULE
    RULE --> ASESOR_F & ASESOR_L & ASESOR_C & RECEPCION

    classDef fiscalStyle fill:#3B82F6,stroke:#2563EB,color:#fff
    classDef laboralStyle fill:#F97316,stroke:#EA580C,color:#fff
    classDef contabStyle fill:#10B981,stroke:#059669,color:#fff
    classDef recepStyle fill:#EC4899,stroke:#DB2777,color:#fff

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
        AUDIO["🎵 audio<br/>message.audio.id"]
        VIDEO["🎬 video<br/>message.video.id<br/>message.video.caption"]
    end

    subgraph EXTRACCION["📥 Extracción"]
        TEXT --> T_CONTENT["contentText = body<br/>mediaId = null"]
        IMAGE --> I_CONTENT["contentText = caption<br/>mediaId = id"]
        DOC --> D_CONTENT["contentText = caption<br/>mediaId = id"]
        AUDIO --> A_CONTENT["contentText = ''<br/>mediaId = id"]
        VIDEO --> V_CONTENT["contentText = caption<br/>mediaId = id"]
    end

    subgraph DESCARGA["💾 Descarga Media"]
        I_CONTENT --> DOWNLOAD
        D_CONTENT --> DOWNLOAD
        A_CONTENT --> DOWNLOAD
        V_CONTENT --> DOWNLOAD

        DOWNLOAD["downloadAndSaveMedia()"]

        DOWNLOAD --> EXT["Extensiones:<br/>.jpg, .png, .webp<br/>.pdf<br/>.ogg, .mp3, .aac<br/>.mp4, .3gp"]
    end

    subgraph ALMACEN["📁 Almacenamiento"]
        T_CONTENT --> DB_TEXT["media_url = NULL"]
        EXT --> DB_MEDIA["media_url = /media/{id}.ext"]
    end
```

## Resumen de Características

| Característica | Descripción |
|----------------|-------------|
| 🔁 **Deduplicación** | UNIQUE en wa_message_id previene duplicados |
| ⏱️ **Ventana de contexto** | 15 segundos para agrupar mensajes |
| 🤖 **Clasificación diferida** | Se clasifica TODO junto al cerrar ventana |
| 📊 **Múltiples categorías** | La IA puede detectar fiscal + laboral |
| 🔄 **Fallback recepcion** | Si hay categorías específicas, eliminar recepcion |
| 📱 **Auto-respuesta sincronizada** | Se envía al cerrar ventana, no inmediatamente |
| 📧 **Emails múltiples** | Un email a cada asesor relevante |
| 📦 **Consolidación** | Todos los mensajes del usuario en un email |

## Ejemplo Timeline

```
22:30:26  Msg 1 "A qué hora abrís?"          → DB (category=NULL)
22:30:32  Msg 2 "Quiero traer documentación" → DB (category=NULL)
22:30:45  Msg 3 📄 "Para la trimestral IVA"  → DB (category=NULL)

22:31:00  Processor ejecuta
          → Último mensaje hace 15s → PROCESAR
          → Concatenar: "A qué hora abrís?\nQuiero traer...\nPara la trimestral"
          → Claude: {categorias: ["fiscal", "recepcion"], resumen: "..."}
          → Fallback: fiscal + recepcion → solo ["fiscal"]
          → Auto-respuesta: "Nuestro equipo de área fiscal..."
          → Email a asesor fiscal con 3 mensajes + PDF

RESULTADO: 1 clasificación IA, 1 auto-respuesta, 1 email
```
