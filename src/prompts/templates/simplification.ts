/**
 * Text Simplification Prompts
 * Used for simplifying complex academic text
 */

import { PromptBuilder } from '../PromptBuilder.ts';

/**
 * Build the system prompt for text simplification
 * Used in: src/utils/aiService.ts:1015
 *
 * This prompt instructs the AI to rewrite complex academic text
 * in simpler language while preserving the original meaning.
 * Includes instructions for LaTeX mathematical expressions.
 *
 * @returns The text simplification system prompt
 */
export function buildSimplifyTextPrompt(): string {
  return new PromptBuilder()
    .withRole('simplifier')
    .withCustomInstruction('preserve-meaning', 'while preserving the original meaning.')
    .withLatexSupport()
    .buildString();
}

/**
 * Estimated token count for the text simplification prompt
 */
export const SIMPLIFY_TEXT_TOKENS = 50;
