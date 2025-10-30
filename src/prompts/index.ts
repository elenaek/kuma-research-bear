/**
 * Centralized Prompt System
 *
 * This module provides a unified interface for creating and managing
 * system prompts across the application.
 *
 * ## Usage
 *
 * ### Basic Builder Pattern:
 * ```typescript
 * import { PromptBuilder } from './prompts';
 *
 * const prompt = new PromptBuilder()
 *   .withRole('researchAssistant')
 *   .withTask('Explain complex papers')
 *   .withLatexSupport()
 *   .withLanguage('en')
 *   .buildString();
 * ```
 *
 * ### Using Components Directly:
 * ```typescript
 * import { LATEX_RULES, ROLES } from './prompts';
 *
 * const prompt = `${ROLES.kumaAssistant.content}\n${LATEX_RULES.content}`;
 * ```
 */

// Main builder
export { PromptBuilder } from './PromptBuilder';

// Types
export type {
  PromptLanguage,
  RoleType,
  PromptComponent,
  PromptBuilderOptions,
  BuiltPrompt,
} from './types';

// Role components
export { ROLES, ANALYZER_ROLES, UTILITY_ROLES, getRole, getRoleTokens } from './components/roles';

// Formatting components
export {
  LATEX_RULES,
  MARKDOWN_FORMATTING,
  MARKDOWN_FORMATTING_DETAILED,
  JSON_FORMAT_REMINDER,
} from './components/formatting';

// Language utilities
export {
  LANGUAGE_NAMES,
  getLanguageName,
  getLanguageInstruction,
  getGlossaryLanguageInstruction,
  getLanguageContextSuffix,
  getExpectedOutputs,
  EXPECTED_INPUTS_EN,
} from './components/language';

// Template builders
export { buildChatPrompt, buildImageChatPrompt, CHAT_TOKENS, IMAGE_CHAT_TOKENS } from './templates/chat';
export { buildQAPrompt, QA_TOKENS } from './templates/qa';
export { buildJSONRepairPrompt, buildJSONRepairInput, JSON_REPAIR_TOKENS } from './templates/utility';
export { buildExtractTermsPrompt, buildExtractChunkTermsPrompt, buildDefinitionPrompt, buildDeduplicateTermsPrompt, EXTRACT_TERMS_TOKENS, EXTRACT_CHUNK_TERMS_TOKENS, DEFINITION_TOKENS, DEDUPLICATE_TERMS_TOKENS } from './templates/glossary';
