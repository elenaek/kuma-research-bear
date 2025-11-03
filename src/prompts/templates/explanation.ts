/**
 * Explanation Prompts
 * Used for explaining terms, abstracts, and sections of research papers
 */

import type { Persona, Purpose } from '../../types/personaPurpose.ts';
import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';

/**
 * Build the system prompt for term explanation
 * Used in: src/utils/aiService.ts:1002
 *
 * This prompt instructs the AI to explain technical and scientific
 * terms in simple, accessible language.
 *
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The term explanation system prompt
 */
export function buildExplainTermPrompt(persona?: Persona, purpose?: Purpose, verbosity?: number): string {
  const builder = new PromptBuilder()
    .withRole('explainer', 'termExplainer');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .buildString();
}

/**
 * Build the system prompt for abstract explanation
 * Used in: src/utils/aiService.ts:781
 *
 * This prompt instructs the AI to explain complex academic papers
 * in simple terms with markdown formatting and LaTeX math support.
 *
 * @param language - Target output language (en, es, ja)
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The abstract explanation system prompt
 */
export function buildExplainAbstractPrompt(
  language: PromptLanguage,
  persona?: Persona,
  purpose?: Purpose,
  verbosity?: number
): string {
  const builder = new PromptBuilder()
    .withRole('explainer')
    .withTask('Your goal is to make research papers accessible to people without specialized knowledge.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withCustomInstruction('approach', 'Break down technical jargon, use analogies when helpful, and focus on the key insights.')
    .withMarkdownFormatting(true)
    .withLatexSupport()
    .withLanguage(language, 'entire')
    .withVerbosity(verbosity ?? 3)
    .buildString();
}

/**
 * Build the system prompt for image explanation (multimodal)
 * Used in: src/utils/aiService.ts:249
 *
 * This prompt instructs the AI to explain scientific figures and images
 * from research papers, with LaTeX support for mathematical notation.
 *
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param verbosity - The verbosity level (1-5)
 * @returns The image explanation system prompt
 */
export function buildImageExplanationPrompt(persona?: Persona, purpose?: Purpose, verbosity?: number): string {
  const builder = new PromptBuilder()
    .withRole('expertResearchAssistant')
    .withTask('Provide clear, concise explanations of images in the context of the paper.');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withLatexSupport()
    .withMarkdownFormatting()
    .buildString();
}

/**
 * Estimated token count for the term explanation prompt
 */
export const EXPLAIN_TERM_TOKENS = 18;

/**
 * Estimated token count for the abstract explanation prompt
 */
export const EXPLAIN_ABSTRACT_TOKENS = 150;

/**
 * Estimated token count for the image explanation prompt
 */
export const IMAGE_EXPLANATION_TOKENS = 250;
