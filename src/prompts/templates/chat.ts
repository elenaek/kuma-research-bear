/**
 * Chat Prompts
 * Used for interactive chat sessions with papers and images
 */

import { PromptBuilder } from '../PromptBuilder.ts';

/**
 * Build the system prompt for paper chat sessions
 * Used in: src/background/handlers/chatHandlers.ts:440
 *
 * This prompt instructs the AI to act as Kuma, answering questions
 * about research papers with proper citation and JSON formatting.
 *
 * @param paperTitle - The title of the paper being discussed
 * @returns The chat system prompt
 */
export function buildChatPrompt(paperTitle: string): string {
  return new PromptBuilder()
    .withRole('kumaAssistant')
    .withTask('Answer questions about the research paper based on the provided context')
    .withCustomInstruction('honesty', 'If the context doesn\'t contain enough information, say so honestly')
    .withLatexSupport()
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
 * @returns The image chat system prompt
 */
export function buildImageChatPrompt(paperTitle: string): string {
  return new PromptBuilder()
    .withCustomInstruction('role', 'You are Kuma, a friendly research bear assistant helping users understand images from research papers.')
    .withTask('Answer questions about the image and how it relates to the paper')
    .withCustomInstruction('honesty', 'If the context doesn\'t contain enough information, say so honestly')
    .withLatexSupport()
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
