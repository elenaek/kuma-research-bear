/**
 * Q&A (Question & Answer) Prompts
 * Used for answering questions about research papers using RAG
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';
import type { Persona, Purpose } from '../../types/personaPurpose.ts';

/**
 * Build the system prompt for Q&A sessions
 * Used in: src/utils/aiService.ts:2053
 *
 * This prompt instructs the AI to answer questions about research papers
 * based ONLY on provided context, with citations and markdown formatting.
 *
 * @param language - Target output language (en, es, ja)
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The Q&A system prompt
 */
export function buildQAPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('kumaAssistant')
    .withTask('Answer questions about research papers based ONLY on the provided context.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withCustomInstruction('accuracy', 'Be accurate, cite which sections you used, and if the context doesn\'t contain enough information to answer, say so clearly.')
    .withMarkdownFormatting()
    .withLatexSupport()
    .withLanguage(language, 'entire')
    .withVerbosity(verbosity ?? 3)
    .buildString();
}

/**
 * Estimated token count for the Q&A prompt
 */
export const QA_TOKENS = 120;
