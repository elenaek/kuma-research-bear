/**
 * Text Simplification Prompts
 * Used for simplifying complex academic text
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { Persona, Purpose } from '../../shared/types/personaPurpose.ts';

/**
 * Build the system prompt for text simplification
 * Used in: src/utils/aiService.ts:1015
 *
 * This prompt instructs the AI to rewrite complex academic text
 * in simpler language while preserving the original meaning.
 * Includes instructions for LaTeX mathematical expressions.
 *
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @returns The text simplification system prompt
 */
export function buildSimplifyTextPrompt(persona?: Persona, purpose?: Purpose): string {
  const builder = new PromptBuilder()
    .withRole('simplifier');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withCustomInstruction('preserve-meaning', 'while preserving the original meaning.')
    .withLatexSupport()
    .buildString();
}

/**
 * Estimated token count for the text simplification prompt
 */
export const SIMPLIFY_TEXT_TOKENS = 50;
