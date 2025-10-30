/**
 * Summary Generation Prompts
 * Used for creating concise summaries of academic papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';

/**
 * Build the system prompt for summary generation
 * Used in: src/utils/aiService.ts:916
 *
 * This prompt instructs the AI to create concise summaries
 * with key points, using markdown formatting and LaTeX support.
 *
 * @returns The summary generation system prompt
 */
export function buildSummaryPrompt(): string {
  return new PromptBuilder()
    .withRole('researchAssistant', 'summaryCreator')
    .withCustomInstruction('task', 'Extract the most important information and present it clearly.')
    .withMarkdownFormatting(true)
    .withLatexSupport()
    .buildString();
}

/**
 * Estimated token count for the summary prompt
 */
export const SUMMARY_TOKENS = 50;
