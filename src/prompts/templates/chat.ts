/**
 * Chat Prompts
 * Used for interactive chat sessions with papers and images
 */

import type { Persona, Purpose } from '../../types/personaPurpose.ts';
import { PromptBuilder } from '../PromptBuilder.ts';
import type { PromptLanguage } from '../types.ts';

/**
 * Build the system prompt for paper chat sessions
 * Used in: src/background/handlers/chatHandlers.ts:440
 *
 * This prompt instructs the AI to act as Kuma, answering questions
 * about research papers with proper citation and JSON formatting.
 *
 * @param paperTitle - The title of the paper being discussed
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param language - The output language
 * @param verbosity - The verbosity level (1-5)
 * @returns The chat system prompt
 */
export function buildChatPrompt(paperTitle: string, persona?: Persona, purpose?: Purpose, language?: PromptLanguage, verbosity?: number): string {
  const builder = new PromptBuilder()
    .withRole('kumaAssistant')
    .withTask('Answer questions about the research paper based on the provided context');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withCustomInstruction('honesty', 'If the context doesn\'t contain enough information, say so honestly')
    .withLatexSupport()
    .withLanguage(language || 'en', 'standard')
    .withCustomInstruction('response-format', `Response Format:
You will respond with a JSON object containing:
- "answer": Your conversational response (see schema for formatting guidelines)
- "sources": An array of citations you actually used (use EXACT hierarchical format from context, e.g., "Section: Methods > Data Collection > P 3")

Only include sources you actually referenced. If you didn't use specific sources, provide an empty array.`)
    .withCustomInstruction('paper-context', `Paper title: ${paperTitle}`)
    .buildString();
}

/**
 * Build the system prompt for image chat sessions (multimodal)
 * Used in: src/background/handlers/chatHandlers.ts:1175
 *
 * This prompt instructs the AI to act as Kuma, answering questions
 * about images from research papers with proper citation and JSON formatting.
 *
 * @param paperTitle - The title of the paper containing the image
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @param language - The output language
 * @param verbosity - The verbosity level (1-5)
 * @returns The image chat system prompt
 */
export function buildImageChatPrompt(paperTitle: string, persona?: Persona, purpose?: Purpose, language?: PromptLanguage, verbosity?: number): string {
  const builder = new PromptBuilder()
    .withCustomInstruction('role', 'You are Kuma, a friendly research bear assistant helping users understand images from research papers.')
    .withTask('Answer questions about the image and how it relates to the paper');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withVerbosity(verbosity ?? 3)
    .withCustomInstruction('honesty', 'If the context doesn\'t contain enough information, say so honestly')
    .withLatexSupport()
    .withLanguage(language || 'en', 'standard')
    .withCustomInstruction('response-format', `Response Format:
You will respond with a JSON object containing:
- "answer": Your conversational response (see schema for formatting guidelines)
- "sources": An array of citations you actually used (use EXACT hierarchical format from context, e.g., "Section: Methods > Data Collection > P 3")

Only include sources you actually referenced. If you didn't use specific sources, provide an empty array.`)
    .withCustomInstruction('paper-context', `Paper title: ${paperTitle}`)
    .buildString();
}

/**
 * Estimated token count for the chat prompt (excluding dynamic paper title)
 */
export const CHAT_TOKENS = 350;

/**
 * Estimated token count for the image chat prompt (excluding dynamic paper title)
 */
export const IMAGE_CHAT_TOKENS = 350;
