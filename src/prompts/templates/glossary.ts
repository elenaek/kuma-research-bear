/**
 * Glossary Prompts
 * Used for extracting, defining, and managing technical terms and acronyms
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';
import type { Persona, Purpose } from '../../types/personaPurpose.ts';

/**
 * Build the system prompt for extracting terms from text
 * Used in: src/utils/aiService.ts:2177
 *
 * This prompt instructs the AI to identify important technical terms
 * and acronyms from research paper text.
 *
 * @param language - Target output language (en, es, ja)
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @returns The term extraction system prompt
 */
export function buildExtractTermsPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose
): string {
  const builder = new PromptBuilder()
    .withCustomInstruction('role', 'You are a research paper expert who identifies important technical terms and acronyms for glossaries.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withLanguage(language, 'standard')
    .buildString();
}

/**
 * Build the system prompt for extracting terms from a chunk
 * Used in: src/utils/aiService.ts:2256
 *
 * This prompt instructs the AI to extract the most important technical
 * terms from a single chunk during on-demand glossarization.
 *
 * @param paperTitle - The title of the paper
 * @param termCount - Number of terms to extract
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The chunk term extraction system prompt
 */
export function buildExtractChunkTermsPrompt(
  paperTitle: string,
  termCount: number,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withCustomInstruction('role', 'You are a research paper analyzer extracting technical terms.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withCustomInstruction('critical', `CRITICAL:
- Extract ONLY the ${termCount} most important technical terms, acronyms, and domain-specific jargon
- Preserve ALL acronyms exactly (e.g., "SES", "RCT", "fMRI")
- Keep technical terminology intact - do NOT paraphrase
- Focus on terms that would be valuable in a glossary
- Prioritize: technical terms, acronyms, specialized concepts, methodological terms
- EXCLUDE: person names, institution names, place names, common words

Paper: ${paperTitle}`)
    .buildString();
}

/**
 * Build the system prompt for generating term definitions with RAG
 * Used in: src/utils/aiService.ts:2425
 *
 * This prompt instructs the AI to provide clear, accurate definitions
 * for technical terms based on paper context.
 *
 * @param language - Target output language (en, es, ja)
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The definition generation system prompt
 */
export function buildDefinitionPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withCustomInstruction('role', 'You are a research paper terminology expert who provides clear, accurate definitions for technical terms and acronyms.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withCustomInstruction('math', `When mathematical expressions, equations, or formulas are needed in definitions or contexts:
- Use $expression$ for inline math (e.g., $E = mc^2$, $\\alpha$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters)`)
    .withLanguage(language, 'keep-terms')
    .buildString();
}

/**
 * Build the system prompt for deduplicating terms
 * Used in: src/utils/aiService.ts:3031
 *
 * This prompt instructs the AI to remove duplicates and select
 * the most important unique terms from a list.
 *
 * @param language - Target output language (en, es, ja)
 * @param targetCount - Number of unique terms to select
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The term deduplication system prompt
 */
export function buildDeduplicateTermsPrompt(
  language: PromptLanguage,
  targetCount: number,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withCustomInstruction('role', 'You are a research paper glossary expert who deduplicates and selects technical terms.')
    .withTask(`Your task is to remove duplicates and select the TOP ${targetCount} most important unique terms.`);

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withLanguage(language, 'standard')
    .buildString();
}

/**
 * Estimated token count for term extraction prompt
 */
export const EXTRACT_TERMS_TOKENS = 30;

/**
 * Estimated token count for chunk term extraction prompt
 */
export const EXTRACT_CHUNK_TERMS_TOKENS = 80;

/**
 * Estimated token count for definition generation prompt
 */
export const DEFINITION_TOKENS = 100;

/**
 * Estimated token count for term deduplication prompt
 */
export const DEDUPLICATE_TERMS_TOKENS = 50;
