import Anthropic from '@anthropic-ai/sdk';
import { advisorsConfig, AdvisorsConfig } from './advisors.js';

const anthropic = new Anthropic();

interface ClassificationResult {
  categoria: string;
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
(en castellano o catalán), clasifícalo en UNA de estas categorías:
${categories}

Si el mensaje no encaja claramente en ninguna categoría, usa "fallback".

Responde SOLO con un JSON: {"categoria": "...", "resumen": "..."}
El resumen debe ser una frase de máximo 15 palabras describiendo la consulta.`;
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
    return { categoria: 'fallback', resumen: 'Error al procesar respuesta' };
  }

  try {
    return JSON.parse(content.text) as ClassificationResult;
  } catch {
    return { categoria: 'fallback', resumen: 'Error al parsear clasificación' };
  }
}

export function getAdvisorByCategory(category: string): { name: string; email: string } {
  const advisor = advisorsConfig.advisors.find((a) => a.category === category);
  return advisor || advisorsConfig.fallback;
}
