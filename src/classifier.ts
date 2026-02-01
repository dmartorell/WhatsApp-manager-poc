import Anthropic from '@anthropic-ai/sdk';
import { advisorsConfig, AdvisorsConfig } from './advisors.js';

const anthropic = new Anthropic();

export interface ClassificationResult {
  categorias: string[];
  resumen: string;
}

interface ClassifyOptions {
  hasAttachment?: boolean;
}

function buildPrompt(advisors: AdvisorsConfig): string {
  const categories = advisors.advisors
    .map((a) => `- ${a.category}: ${a.description}`)
    .join('\n');

  return `Eres el sistema de clasificación de una gestoría. Dado un mensaje de un cliente
(en castellano o catalán), identifica TODOS los temas presentes.

Categorías disponibles:
${categories}

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

export async function classifyMessage(
  messageText: string,
  options: ClassifyOptions = {},
): Promise<ClassificationResult> {
  const systemPrompt = buildPrompt(advisorsConfig);

  // Si hay adjunto, añadir contexto al mensaje
  let textToClassify = messageText;
  if (options.hasAttachment) {
    textToClassify = `[El cliente ha adjuntado un documento/imagen junto con este mensaje]\n${messageText}`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 150,
    messages: [
      { role: 'user', content: textToClassify },
    ],
    system: systemPrompt,
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { categorias: ['recepcion'], resumen: 'Error al procesar respuesta' };
  }

  try {
    const parsed = JSON.parse(content.text) as { categorias: string[]; resumen: string };

    // Validar que categorias sea un array
    if (!Array.isArray(parsed.categorias) || parsed.categorias.length === 0) {
      return { categorias: ['recepcion'], resumen: parsed.resumen || 'Consulta general' };
    }

    // Aplicar lógica de fallback: si hay categorías específicas, eliminar recepcion
    const specificCategories = parsed.categorias.filter((c) => c !== 'recepcion');
    const finalCategories = specificCategories.length > 0 ? specificCategories : parsed.categorias;

    return {
      categorias: finalCategories,
      resumen: parsed.resumen,
    };
  } catch {
    return { categorias: ['recepcion'], resumen: 'Error al parsear clasificación' };
  }
}

export function getAdvisorByCategory(category: string): { name: string; email: string } {
  const advisor = advisorsConfig.advisors.find((a) => a.category === category);
  return advisor || advisorsConfig.recepcion;
}

export function getAdvisorsByCategories(categories: string[]): Array<{ name: string; email: string; category: string }> {
  return categories.map((category) => {
    const advisor = advisorsConfig.advisors.find((a) => a.category === category);
    if (advisor) {
      return { name: advisor.name, email: advisor.email, category };
    }
    return { name: advisorsConfig.recepcion.name, email: advisorsConfig.recepcion.email, category: 'recepcion' };
  });
}
