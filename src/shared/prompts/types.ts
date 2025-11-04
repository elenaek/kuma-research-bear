/**
 * Type definitions for the prompt system
 */

/**
 * Supported languages for prompts
 */
export type PromptLanguage = 'en' | 'es' | 'ja';

/**
 * Role types for system prompts
 */
export type RoleType =
  | 'researchAssistant'
  | 'expertResearchAssistant'
  | 'metadataExpert'
  | 'kumaAssistant'
  | 'simplifier'
  | 'explainer'
  | 'analyzer';

/**
 * Component that can be included in a prompt
 */
export interface PromptComponent {
  content: string;
  tokens?: number;
}

/**
 * Options for building a prompt
 */
export interface PromptBuilderOptions {
  role?: RoleType;
  task?: string;
  includeLatexSupport?: boolean;
  includeMarkdownFormatting?: boolean;
  language?: PromptLanguage;
  additionalInstructions?: string[];
  context?: Record<string, string>;
}

/**
 * Result of building a prompt
 */
export interface BuiltPrompt {
  content: string;
  estimatedTokens: number;
  components: string[];
}
