/**
 * Language support components for prompts
 * Handles multi-language output instructions
 */

import type { PromptLanguage, PromptComponent } from '../types';

/**
 * Map language codes to display names
 */
export const LANGUAGE_NAMES: Record<PromptLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
};

/**
 * Get the display name for a language code
 */
export function getLanguageName(language: PromptLanguage): string {
  return LANGUAGE_NAMES[language] || 'English';
}

/**
 * Generate language instruction for prompts
 * @param language - Target output language
 * @param variant - Instruction variant ('standard', 'entire', 'analysis', 'keep-terms')
 */
export function getLanguageInstruction(
  language: PromptLanguage,
  variant: 'standard' | 'entire' | 'analysis' | 'keep-terms' = 'standard'
): PromptComponent {
  const languageName = getLanguageName(language);

  const instructions: Record<string, string> = {
    standard: `Respond in ${languageName}.`,
    entire: `IMPORTANT: Respond in ${languageName}. Your entire explanation must be in ${languageName}.`,
    analysis: `IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`,
    'keep-terms': `IMPORTANT: Respond in ${languageName} but keep technical terms and acronyms in their original form.`,
  };

  return {
    content: instructions[variant],
    tokens: variant === 'standard' ? 5 : 15,
  };
}

/**
 * Generate language instruction for glossary/terminology tasks
 * These tasks need special handling to keep terms in original form
 */
export function getGlossaryLanguageInstruction(language: PromptLanguage): PromptComponent {
  const languageName = getLanguageName(language);

  return {
    content: `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.`,
    tokens: 25,
  };
}

/**
 * Generate context ID suffix for language-specific sessions
 * Used to ensure separate AI sessions per language
 */
export function getLanguageContextSuffix(language: PromptLanguage): string {
  return `-${language}`;
}

/**
 * Create expectedOutputs parameter for AI session
 * Used with Chrome's Prompt API
 */
export function getExpectedOutputs(language: PromptLanguage): Array<{ type: string; languages: string[] }> {
  return [{ type: 'text', languages: [language] }];
}

/**
 * Standard expectedInputs parameter (always English)
 * Used with Chrome's Prompt API
 */
export const EXPECTED_INPUTS_EN: Array<{ type: string; languages: string[] }> = [
  { type: 'text', languages: ['en'] },
];
