/**
 * Summary Generation Prompts
 * Used for creating concise summaries of academic papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { Persona, Purpose } from '../../shared/types/personaPurpose.ts';

/**
 * Build the system prompt for summary generation
 * Used in: src/utils/aiService.ts:916
 *
 * This prompt instructs the AI to create concise summaries
 * with key points, using markdown formatting and LaTeX support.
 *
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @returns The summary generation system prompt
 */
export function buildSummaryPrompt(persona?: Persona, purpose?: Purpose): string {
  const builder = new PromptBuilder()
    .withRole('researchAssistant', 'summaryCreator');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withCustomInstruction('task', 'Extract the most important information and present it clearly.')
    .withMarkdownFormatting(true)
    .withLatexSupport()
    .buildString();
}

/**
 * Estimated token count for the summary prompt
 */
export const SUMMARY_TOKENS = 50;
