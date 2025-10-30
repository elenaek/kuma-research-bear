/**
 * Analysis Prompts
 * Used for analyzing different aspects of research papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';

/**
 * Build the system prompt for methodology analysis
 * Used in: src/utils/aiService.ts:1447
 *
 * This prompt instructs the AI to analyze research papers
 * for their study design, methods, and rigor.
 *
 * @param language - Target output language (en, es, ja)
 * @returns The methodology analysis system prompt
 */
export function buildMethodologyAnalysisPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('analyzer', 'methodology')
    .withLatexSupport()
    .withMarkdownFormatting()
    .withLanguage(language, 'analysis')
    .buildString();
}

/**
 * Build the system prompt for confounder analysis
 * Used in: src/utils/aiService.ts:1591
 *
 * This prompt instructs the AI to identify biases and
 * confounding variables in research studies.
 *
 * @param language - Target output language (en, es, ja)
 * @returns The confounder analysis system prompt
 */
export function buildConfounderAnalysisPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('analyzer', 'confounders')
    .withLatexSupport()
    .withMarkdownFormatting()
    .withLanguage(language, 'analysis')
    .buildString();
}

/**
 * Build the system prompt for implication analysis
 * Used in: src/utils/aiService.ts:1730
 *
 * This prompt instructs the AI to identify practical applications
 * and significance of research.
 *
 * @param language - Target output language (en, es, ja)
 * @returns The implication analysis system prompt
 */
export function buildImplicationAnalysisPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('analyzer', 'implications')
    .withLatexSupport()
    .withMarkdownFormatting()
    .withLanguage(language, 'analysis')
    .buildString();
}

/**
 * Build the system prompt for limitation analysis
 * Used in: src/utils/aiService.ts:1869
 *
 * This prompt instructs the AI to identify limitations
 * and constraints in studies.
 *
 * @param language - Target output language (en, es, ja)
 * @returns The limitation analysis system prompt
 */
export function buildLimitationAnalysisPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('analyzer', 'limitations')
    .withLatexSupport()
    .withMarkdownFormatting()
    .withLanguage(language, 'analysis')
    .buildString();
}

/**
 * Estimated token count for methodology analysis prompt
 */
export const METHODOLOGY_ANALYSIS_TOKENS = 50;

/**
 * Estimated token count for confounder analysis prompt
 */
export const CONFOUNDER_ANALYSIS_TOKENS = 50;

/**
 * Estimated token count for implication analysis prompt
 */
export const IMPLICATION_ANALYSIS_TOKENS = 50;

/**
 * Estimated token count for limitation analysis prompt
 */
export const LIMITATION_ANALYSIS_TOKENS = 50;
