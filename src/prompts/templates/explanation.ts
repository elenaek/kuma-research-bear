/**
 * Explanation Prompts
 * Used for explaining terms, abstracts, and sections of research papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';

/**
 * Build the system prompt for term explanation
 * Used in: src/utils/aiService.ts:1002
 *
 * This prompt instructs the AI to explain technical and scientific
 * terms in simple, accessible language.
 *
 * @returns The term explanation system prompt
 */
export function buildExplainTermPrompt(): string {
  return new PromptBuilder()
    .withRole('explainer', 'termExplainer')
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
 * @returns The abstract explanation system prompt
 */
export function buildExplainAbstractPrompt(language: PromptLanguage): string {
  return new PromptBuilder()
    .withRole('explainer')
    .withTask('Your goal is to make research papers accessible to people without specialized knowledge.')
    .withCustomInstruction('approach', 'Break down technical jargon, use analogies when helpful, and focus on the key insights.')
    .withMarkdownFormatting(true)
    .withLatexSupport()
    .withLanguage(language, 'entire')
    .buildString();
}

/**
 * Build the system prompt for image explanation (multimodal)
 * Used in: src/utils/aiService.ts:249
 *
 * This prompt instructs the AI to explain scientific figures and images
 * from research papers, with LaTeX support for mathematical notation.
 *
 * @returns The image explanation system prompt
 */
export function buildImageExplanationPrompt(): string {
  return new PromptBuilder()
    .withRole('expertResearchAssistant')
    .withTask('Provide clear, concise explanations of images in the context of the paper.')
    .withLatexSupport()
    .withMarkdownFormatting(true)
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
