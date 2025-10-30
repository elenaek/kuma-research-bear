/**
 * Paper Detection Prompts
 * Used for AI-based detection of research papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';

/**
 * Build the system prompt for paper detection
 * Used in: src/utils/paperDetection.ts:210
 *
 * This prompt is used as a fallback when heuristic scoring produces
 * medium confidence results (35-59%). The AI analyzes a sample of
 * page text to determine if it's from an academic/research paper.
 *
 * @returns The paper detection system prompt
 */
export function buildPaperDetectionPrompt(): string {
  return new PromptBuilder()
    .withRole('You are a research paper classifier')
    .withTask('Analyze text and determine if it is from an academic/research paper.')
    .buildString();
}

/**
 * Estimated token count for the paper detection prompt
 */
export const PAPER_DETECTION_TOKENS = 20;
