import Anthropic from '@anthropic-ai/sdk';
import { advisorsConfig, AdvisorsConfig } from './advisors.js';
import { parseClassificationResponse } from './schemas.js';
import { DEFAULT_CATEGORY, buildClassificationPrompt } from './constants.js';

const anthropic = new Anthropic();

export interface ClassificationResult {
  categorias: string[];
  resumen: string;
}

interface ClassifyOptions {
  hasAttachment?: boolean;
}

function buildPrompt(advisors: AdvisorsConfig): string {
  const categoryDescriptions = advisors.advisors
    .map((a) => `- ${a.category}: ${a.description}`)
    .join('\n');

  return buildClassificationPrompt(categoryDescriptions);
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
    return { categorias: [DEFAULT_CATEGORY], resumen: 'Error al procesar respuesta' };
  }

  try {
    const jsonData = JSON.parse(content.text);
    const parsed = parseClassificationResponse(jsonData);

    // Zod validation failed
    if (!parsed) {
      return { categorias: [DEFAULT_CATEGORY], resumen: 'Consulta general' };
    }

    // Aplicar lógica de fallback: si hay categorías específicas, eliminar recepcion
    const specificCategories = parsed.categorias.filter((c) => c !== DEFAULT_CATEGORY);
    const finalCategories = specificCategories.length > 0 ? specificCategories : parsed.categorias;

    return {
      categorias: finalCategories,
      resumen: parsed.resumen,
    };
  } catch {
    return { categorias: [DEFAULT_CATEGORY], resumen: 'Error al parsear clasificación' };
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
