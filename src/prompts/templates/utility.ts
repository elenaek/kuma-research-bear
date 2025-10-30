/**
 * Utility Prompts
 * Used for utility operations like JSON repair, format conversion, etc.
 */

import { PromptBuilder } from '../PromptBuilder.ts';

/**
 * Build the system prompt for JSON repair
 * Used in: src/utils/aiService.ts:721
 *
 * This prompt instructs the AI to fix malformed JSON by properly
 * escaping strings and correcting syntax errors.
 *
 * @returns The JSON repair system prompt
 */
export function buildJSONRepairPrompt(): string {
  return new PromptBuilder()
    .withCustomInstruction('role', 'You are a JSON validator and fixer. Your job is to take malformed JSON and return valid, properly escaped JSON.')
    .buildString();
}

/**
 * Build the user input for JSON repair
 * Used in: src/utils/aiService.ts:723
 *
 * @param malformedJson - The malformed JSON string to repair
 * @returns The user input prompt for JSON repair
 */
export function buildJSONRepairInput(malformedJson: string): string {
  return `The following JSON has syntax errors (likely improperly escaped strings). Fix it and return ONLY valid JSON with properly escaped strings:

${malformedJson}

Important:
- Escape all quotes in strings with \\"
- Escape all newlines as \\n
- Escape all backslashes as \\\\
- Return ONLY the corrected JSON, no explanations or markdown`;
}

/**
 * Estimated token count for the JSON repair system prompt
 */
export const JSON_REPAIR_TOKENS = 25;
