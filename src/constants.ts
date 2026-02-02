// ═══════════════════════════════════════════════════════════
// TIMING CONSTANTS
// ═══════════════════════════════════════════════════════════

export const CONTEXT_WINDOW_SECONDS = 15;
export const PROCESS_INTERVAL_MS = 10000;

// ═══════════════════════════════════════════════════════════
// COST ESTIMATION
// ═══════════════════════════════════════════════════════════

// Claude Haiku cost estimation per classification:
// Input: ~300 tokens * $0.25/1M = $0.000075
// Output: ~50 tokens * $1.25/1M = $0.0000625
// Total per classification: ~$0.00014
export const COST_PER_CLASSIFICATION_USD = 0.00014;
export const USD_TO_EUR_RATE = 0.92;

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

export const GRAPH_API_BASE_URL = 'https://graph.facebook.com/v21.0';

// ═══════════════════════════════════════════════════════════
// DEFAULT VALUES
// ═══════════════════════════════════════════════════════════

export const DEFAULT_SMTP_PORT = 587;
export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_CATEGORY = 'recepcion';
export const DEFAULT_ATTACHMENT_FILENAME = 'adjunto';

// ═══════════════════════════════════════════════════════════
// CLASSIFICATION PROMPT
// ═══════════════════════════════════════════════════════════

export function buildClassificationPrompt(categoryDescriptions: string): string {
  return `Eres el sistema de clasificación de una gestoría. Dado un mensaje de un cliente
(en castellano o catalán), identifica TODOS los temas presentes.

Categorías disponibles:
${categoryDescriptions}

REGLAS DE CLASIFICACIÓN:
1. Identifica TODAS las categorías que apliquen al mensaje
2. Si el mensaje menciona varios temas (ej: "quiero pagar IVA y tengo dudas sobre una nómina"), incluye ambas categorías
3. Usa "recepcion" SOLO para:
   - Mensajes puramente sobre horarios, dirección, teléfono de la oficina
   - Saludos sin contenido profesional ("hola", "buenos días")
   - Preguntas sobre empleados específicos ("está María?")
4. Si hay contenido profesional (fiscal/laboral/contabilidad) junto con preguntas de recepción (horarios), NO incluyas recepcion

Responde SOLO con un JSON: {"categorias": ["..."], "resumen": "..."}
- categorias: array con una o más categorías
- resumen: frase de máximo 15 palabras describiendo la consulta principal`;
}
