/**
 * Analysis Prompts
 * Used for analyzing different aspects of research papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';
import type { Persona, Purpose } from '../../types/personaPurpose.ts';

/**
 * Build the system prompt for methodology analysis
 * Used in: src/utils/aiService.ts:1447
 *
 * This prompt instructs the AI to analyze research papers
 * for their study design, methods, and rigor.
 *
 * @param language - Target output language (en, es, ja)
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The methodology analysis system prompt
 */
export function buildMethodologyAnalysisPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('analyzer', 'methodology');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
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
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The confounder analysis system prompt
 */
export function buildConfounderAnalysisPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('analyzer', 'confounders');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
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
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The implication analysis system prompt
 */
export function buildImplicationAnalysisPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('analyzer', 'implications');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
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
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The limitation analysis system prompt
 */
export function buildLimitationAnalysisPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('analyzer', 'limitations');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
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
