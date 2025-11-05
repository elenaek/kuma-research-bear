/**
 * Extraction Prompts
 * Used for extracting structured information from research papers
 */

import { PromptBuilder } from '../PromptBuilder.ts';
import type { Persona, Purpose } from '../../shared/types/personaPurpose.ts';

/**
 * Build the system prompt for metadata extraction
 * Used in: src/utils/aiService.ts:1041
 *
 * This prompt instructs the AI to extract structured metadata
 * from academic papers and return it as valid JSON.
 *
 * @param persona - The persona of the user
 * @param purpose - The purpose of the user
 * @returns The metadata extraction system prompt
 */
export function buildMetadataExtractionPrompt(persona?: Persona, purpose?: Purpose): string {
  const builder = new PromptBuilder()
    .withRole('metadataExpert');

  // Add persona/purpose if provided
  if (persona) builder.withPersona(persona);
  if (purpose) builder.withPurpose(purpose);

  return builder
    .withCustomInstruction('output', 'Extract structured information from academic papers and return it as valid JSON.')
    .withCustomInstruction('accuracy', 'Be accurate and only extract information that is clearly present in the text.')
    .buildString();
}

/**
 * Estimated token count for the metadata extraction prompt
 */
export const METADATA_EXTRACTION_TOKENS = 40;
