/**
 * Q&A (Question & Answer) Prompts
 * Used for answering questions about research papers using RAG
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';

/**
 * Build the system prompt for Q&A sessions
 * Used in: src/utils/aiService.ts:2053
 *
 * This prompt instructs the AI to answer questions about research papers
 * based ONLY on provided context, with citations and markdown formatting.
 *
 * @param language - Target output language (en, es, ja)
 * @returns The Q&A system prompt
 */
export function buildQAPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('kumaAssistant')
    .withTask('Answer questions about research papers based ONLY on the provided context.')
    .withCustomInstruction('accuracy', 'Be accurate, cite which sections you used, and if the context doesn\'t contain enough information to answer, say so clearly.')
    .withMarkdownFormatting()
    .withLatexSupport()
    .withLanguage(language, 'entire')
    .buildString();
}

/**
 * Estimated token count for the Q&A prompt
 */
export const QA_TOKENS = 120;
